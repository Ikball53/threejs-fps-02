// main.js — bootstrap + render loop. Owns the renderer, the camera, the bot
// meshes, the view-model gun, tracers and sparks. Simulation runs on a fixed
// 1/60 step (see SIM_DT) and rendering reads the same state object `S`.

import * as THREE from 'three';
import { makeState, SIM_DT, WEAPONS, PLANT_TIME, DEFUSE_TIME } from './state.js';
import { buildWorld, SITE, eyePos } from './world.js';
import { applyLook, stepPlayer } from './player.js';
import { tryFire, startReload, stepReload, switchWeapon, stepGrenades, blastDamage } from './weapons.js';
import { stepBots } from './bots.js';
import { startMatch, startBuyPhase, startRound, stepRounds, advanceAfterRound, buyItem, damagePlayer, damageBot } from './rounds.js';
import { buildHud, showMenu, showBuy, updateHud, banner, addFeed, hitmarker } from './hud.js';
import { ensureAudio, sfx } from './audio.js';

const S = makeState();
const params = new URLSearchParams(location.search);
S.demo = params.get('demo') || null;

let renderer, scene, camera, gunGroup, gunBarrel, muzzleFlash;
let botMeshes = new Map();
let tracerPool = [];
let sparkPool = [];
let bombMesh = null;
let buyOpen = false;
let roundOverAt = 0;
let mouseDown = false;
let lastTime = 0;
let acc = 0;

// Reused temporaries — no allocations inside the frame loop.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.getElementById('app').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x51607e);
  scene.fog = new THREE.Fog(0x51607e, 34, 90);

  camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 200);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xffe0b0, 0x4a5160, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.4);
  sun.position.set(18, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9db4ff, 0.7);
  fill.position.set(-14, 18, -16);
  scene.add(fill);
  const siteLight = new THREE.PointLight(0xff7a1f, 12, 16, 1.6);
  siteLight.position.set(SITE.x, 3.5, SITE.z);
  scene.add(siteLight);

  const built = buildWorld(scene);
  S.solids = built.solids;
  S.waypoints = built.waypoints;

  buildGun();
  buildBombMesh();
  buildTracers();
  buildSparks();

  buildHud(onBuyPressed, onPlayPressed);
  wireInput();
  addEventListener('resize', onResize);

  if (S.demo) startDemo(S.demo);
  else showMenu(true);

  lastTime = performance.now();
  requestAnimationFrame(frame);
}

function buildGun() {
  gunGroup = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.45, metalness: 0.7 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.8 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd98a1f, roughness: 0.5, metalness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.5), dark);
  body.position.set(0, 0, -0.1);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 10), dark);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.45);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
  sight.position.set(0, 0.09, -0.05);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), grip);
  mag.position.set(0, -0.13, -0.05); mag.rotation.x = 0.15;
  gunBarrel = barrel;
  gunGroup.add(body, barrel, sight, mag);
  muzzleFlash = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.22, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0 }));
  muzzleFlash.rotation.x = -Math.PI / 2;
  muzzleFlash.position.set(0, 0.02, -0.62);
  gunGroup.add(muzzleFlash);
  gunGroup.position.set(0.28, -0.24, -0.45);
  camera.add(gunGroup);
}

function buildBombMesh() {
  bombMesh = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 }));
  box.castShadow = true;
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xff3b1f, emissive: 0xff2200, emissiveIntensity: 2 }));
  light.position.set(0, 0.1, 0.19);
  bombMesh.add(box, light);
  bombMesh.visible = false;
  scene.add(bombMesh);
}

function buildTracers() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo.clone(), mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push(line);
  }
}

function buildSparks() {
  const geo = new THREE.SphereGeometry(0.09, 6, 6);
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0 }));
    m.visible = false;
    scene.add(m);
    sparkPool.push(m);
  }
}

function makeBotMesh(bot) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0x8a3b2e, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.7 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x67e0ff, emissive: 0x1a5a70, emissiveIntensity: 0.8 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.05, 10), suit);
  body.position.y = 0.75; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), dark);
  head.position.y = 1.5; head.castShadow = true;
  const visorM = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.05), visor);
  visorM.position.set(0, 1.52, 0.18);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.6), dark);
  gun.position.set(0.28, 1.05, 0.25);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.06), dark);
  plate.position.set(0, 1.0, 0.36);
  g.add(body, head, visorM, gun, plate);
  // Name tag sprite drawn on a canvas (no asset files).
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 32;
  const c2 = cv.getContext('2d');
  c2.fillStyle = '#ff6a4d'; c2.font = 'bold 20px sans-serif';
  c2.textAlign = 'center'; c2.fillText(bot.name.toUpperCase(), 64, 22);
  const tex = new THREE.CanvasTexture(cv);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  tag.scale.set(1.1, 0.28, 1); tag.position.y = 2.0;
  g.add(tag);
  g.position.set(bot.pos.x, 0, bot.pos.z);
  scene.add(g);
  return g;
}

function syncBots() {
  for (const b of S.bots) {
    let m = botMeshes.get(b.id);
    if (!m) { m = makeBotMesh(b); botMeshes.set(b.id, m); b.mesh = m; }
    m.visible = b.alive;
    if (!b.alive) continue;
    m.position.set(b.pos.x, 0, b.pos.z);
    m.rotation.y = b.yaw;
    // Walk bob.
    const spd = Math.hypot(b.vel.x, b.vel.z);
    m.position.y = spd > 0.5 ? Math.abs(Math.sin(S.time * 9 + b.id)) * 0.05 : 0;
  }
}

function syncTracers(dt) {
  let ti = 0;
  for (const t of S.tracers) {
    t.life -= dt;
    if (t.life <= 0) continue;
    const line = tracerPool[ti % tracerPool.length];
    ti++;
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, t.x0, t.y0, t.z0);
    pos.setXYZ(1, t.x1, t.y1, t.z1);
    pos.needsUpdate = true;
    line.material.color.setHex(t.color);
    line.material.opacity = Math.max(0, t.life / t.max);
    line.visible = true;
  }
  for (let i = ti; i < tracerPool.length; i++) tracerPool[i].visible = false;
  S.tracers = S.tracers.filter((t) => t.life > 0);
}

function syncSparks(dt) {
  let si = 0;
  for (const f of S.flashes) {
    f.life -= dt;
    if (f.life <= 0) continue;
    const m = sparkPool[si % sparkPool.length];
    si++;
    const s = f.big ? 3.2 : 1;
    m.position.set(f.x, f.y, f.z);
    m.scale.setScalar(s * (0.5 + f.life / f.max));
    m.material.opacity = Math.max(0, f.life / f.max);
    m.visible = true;
  }
  for (let i = si; i < sparkPool.length; i++) sparkPool[i].visible = false;
  S.flashes = S.flashes.filter((f) => f.life > 0);
}

function syncGun(dt) {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  // Recoil kick + reload dip, all from state (no new objects).
  const kick = Math.min(0.09, p.spreadBloom * 1.4);
  gunGroup.position.z = -0.45 + kick;
  gunGroup.position.y = -0.24 + (p.reloading > 0 ? -0.08 + Math.sin(S.time * 6) * 0.015 : 0) + (p.crouch ? 0.03 : 0);
  gunGroup.rotation.x = kick * 1.2;
  gunGroup.visible = p.alive && (S.phase === 'live' || S.phase === 'planted' || S.phase === 'buy');
  const flash = S.time - p.lastShotAt < 0.05;
  muzzleFlash.material.opacity = flash ? 0.9 : 0;
  // Swap barrel length per weapon (visual only).
  gunBarrel.scale.z = w.id === 'rifle' ? 1.5 : w.id === 'grenade' ? 0.4 : 1;
  void dt;
}

function syncBomb() {
  if (S.bombPlanted && S.bombPos) {
    bombMesh.visible = true;
    bombMesh.position.set(S.bombPos.x, 0.18, S.bombPos.z);
    const blink = Math.sin(S.time * 10) > 0;
    bombMesh.children[1].material.emissiveIntensity = blink ? 2.5 : 0.4;
  } else bombMesh.visible = false;
}

function syncCamera() {
  const p = S.player;
  const eye = eyePos(p);
  camera.position.set(eye.x, eye.y, eye.z);
  _e.set(p.pitch, p.yaw, 0);
  camera.quaternion.setFromEuler(_e);
}

// ---- UI callbacks (hud.js calls these) ----
const ui = {
  onBuyOpened() { showBuy(true, S); buyOpen = true; },
  onBuyClosed() { showBuy(false, S); buyOpen = false; },
  onPlanted() { banner('CHARGE PLANTED — HOLD THE SITE', 'good', 3000); addFeed('Charge planted at Furnace A'); },
  onBombExploded() {
    _v1.set(S.bombPos.x, 0.6, S.bombPos.z);
    S.flashes.push({ x: _v1.x, y: 0.6, z: _v1.z, life: 0.6, max: 0.6, big: true });
    sfx.grenade();
  },
  onDefused() { banner('CHARGE DEFUSED', 'bad', 3000); },
  onKill(bot, head) {
    hitmarker(true);
    addFeed(`You dropped ${bot.name}${head ? ' — HEADSHOT' : ''}  +$300`);
    banner(`WARDEN DOWN — ${bot.name}`, 'good', 1400);
  },
  onHit(bot, head) { hitmarker(false); void bot; void head; },
  onHurt() { document.getElementById('app').classList.add('hurt'); setTimeout(() => document.getElementById('app').classList.remove('hurt'), 180); },
  onPlayerDied() { banner('YOU ARE DOWN', 'bad', 3000); document.exitPointerLock?.(); },
  onBought(id) { showBuy(true, S); addFeed(`Bought ${id}`); },
  onBuyDenied(msg) { banner(msg, 'bad', 1600); },
};

function onBuyPressed(id) { buyItem(S, id, ui); }

function onPlayPressed() {
  ensureAudio();
  showMenu(false);
  document.getElementById('app').requestPointerLock?.();
  if (S.phase === 'menu') startMatch(S);
  ui.onBuyOpened();
}

// ---- Input ----
function wireInput() {
  addEventListener('keydown', (e) => {
    S.keys[e.code] = true;
    if (e.code === 'KeyR') startReload(S);
    if (e.code === 'Digit1') switchWeapon(S, 'pistol');
    if (e.code === 'Digit2') switchWeapon(S, 'rifle');
    if (e.code === 'Digit3') switchWeapon(S, 'grenade');
    if (e.code === 'KeyB' && S.phase === 'buy') {
      if (buyOpen) { showBuy(false, S); buyOpen = false; } else { showBuy(true, S); buyOpen = true; }
    }
    if (e.code === 'KeyB' && S.phase === 'live') banner('Buy phase is between rounds', 'bad', 1200);
    if (S.phase === 'buy' && /^Digit[1-5]$/.test(e.code)) {
      const item = ['rifle', 'grenade', 'ammo', 'armor', 'pistol_ammo'][Number(e.code.slice(5)) - 1];
      if (item) onBuyPressed(item);
    }
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => { S.keys[e.code] = false; });
  addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    mouseDown = true;
    if (S.phase === 'live' || S.phase === 'planted') tryFire(S, scene, onPlayerHit);
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
  document.addEventListener('pointerlockchange', () => {
    S.pointerLocked = document.pointerLockElement != null;
  });
  document.addEventListener('mousemove', (e) => {
    if (!S.pointerLocked) return;
    applyLook(S.player, e.movementX, e.movementY);
  });
  document.addEventListener('pointerlockerror', () => { S.pointerLocked = false; });
}

function onPlayerHit(bot, dmg, head, x, y, z) {
  damageBot(S, bot, dmg, head, ui);
  S.flashes.push({ x, y, z, life: 0.2, max: 0.2 });
}

const botEvents = {
  botShot(b, p, d) {
    // Accuracy: worse at range, worse while the player sprints, better up close.
    const base = 0.55 - d * 0.009 - (p.speed2d > 3.5 ? 0.18 : 0) + (p.crouch ? -0.1 : 0);
    const hitChance = Math.max(0.08, Math.min(0.7, base));
    const eye = eyePos(p);
    _v1.set(b.pos.x, 1.35, b.pos.z);
    _v2.set(eye.x - _v1.x, eye.y - _v1.y, eye.z - _v1.z).normalize();
    const len = Math.hypot(eye.x - _v1.x, eye.y - _v1.y, eye.z - _v1.z);
    S.tracers.push({
      x0: _v1.x, y0: _v1.y, z0: _v1.z,
      x1: _v1.x + _v2.x * len, y1: _v1.y + _v2.y * len, z1: _v1.z + _v2.z * len,
      life: 0.06, max: 0.06, color: 0xff7a5a,
    });
    sfx.enemyShot(d);
    if (Math.random() < hitChance) damagePlayer(S, 11 + Math.random() * 9, ui);
  },
  botDefusing(b, dt) {
    S.defuseProgress += dt / DEFUSE_TIME;
    if (Math.random() < dt * 2) sfx.plantBeep();
    void b;
  },
};

// ---- Fixed-step simulation ----
function simulate(dt) {
  S.time += dt;
  const p = S.player;
  if (p.fireCooldown > 0) p.fireCooldown -= dt;
  if (mouseDown && S.player.weapons[S.player.weapon]?.auto && (S.phase === 'live' || S.phase === 'planted')) {
    tryFire(S, scene, onPlayerHit);
  }
  if (S.phase === 'buy' || S.phase === 'live' || S.phase === 'planted') {
    stepPlayer(S, dt);
    stepReload(S, dt);
    stepBots(S, dt, botEvents);
    stepGrenades(S, dt, (g) => blastDamage(S, g, (bot, dmg, head, x, y, z, self) => {
      if (bot) damageBot(S, bot, dmg, head, ui);
      else damagePlayer(S, dmg, ui);
      void x; void y; void z; void self;
    }));
    stepRounds(S, dt, ui);
  }
  if (S.phase === 'over' && roundOverAt === 0) roundOverAt = S.time;
  if (S.phase === 'over' && S.time - roundOverAt > 3.5) {
    roundOverAt = 0;
    banner(S.roundMsg, S.scoreYou > S.scoreFoe ? 'good' : 'bad', 3000);
    advanceAfterRound(S, ui);
  }
  if (S.phase === 'matchover') {
    banner(S.matchWinner === 'you' ? 'MATCH WON — EMBER YARD IS YOURS' : 'MATCH LOST — THE WARDENS HOLD THE YARD', S.matchWinner === 'you' ? 'good' : 'bad', 60000);
  }
  if (S.phase === 'over' || S.phase === 'matchover') updateHud(S, dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  acc += dtReal;
  let steps = 0;
  while (acc >= SIM_DT && steps < 5) { simulate(SIM_DT); acc -= SIM_DT; steps++; }
  if (steps === 5) acc = 0;
  syncCamera();
  syncBots();
  syncTracers(dtReal);
  syncSparks(dtReal);
  syncGun(dtReal);
  syncBomb();
  updateHud(S, dtReal);
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

// ---- Demo modes for screenshots (real gameplay states, no pointer lock) ----
function startDemo(kind) {
  showMenu(false);
  startMatch(S);
  const p = S.player;
  // Give the demo player a rifle and a grenade so the HUD shows a full loadout.
  p.weapons.rifle.owned = true; p.weapons.rifle.mag = 25; p.weapons.rifle.reserve = 75;
  p.weapons.grenade.owned = true; p.weapons.grenade.mag = 1; p.weapons.grenade.reserve = 1;
  p.weapon = 'rifle';
  S.money = 3450;
  startRound(S);
  if (kind === 'cover') {
    p.pos.x = 0; p.pos.z = 14; p.yaw = 0; p.pitch = 0.01;
    // One warden visible down mid lane.
    S.bots[3].pos.x = -4; S.bots[3].pos.z = -2; S.bots[3].state = 'hold';
  } else if (kind === 'fight') {
    p.pos.x = 2; p.pos.z = 6; p.yaw = 0.5; p.pitch = 0.02;
    S.bots[0].pos.x = -3; S.bots[0].pos.z = -3; S.bots[0].state = 'engage';
    S.bots[1].pos.x = 6; S.bots[1].pos.z = -6; S.bots[1].state = 'engage';
    S.bots[2].pos.x = -8; S.bots[2].pos.z = 2; S.bots[2].state = 'hold';
    // A fresh tracer downrange so the shot reads in the still.
    S.tracers.push({ x0: 2.2, y0: 1.5, z0: 5.6, x1: -3, y1: 1.4, z1: -3, life: 5, max: 5, color: 0xffe9a8 });
    p.hp = 82;
    addFeed('You dropped Quill — HEADSHOT  +$300');
  } else if (kind === 'site') {
    p.pos.x = 13; p.pos.z = -2; p.yaw = -0.38; p.pitch = -0.02;
    S.bombPlanted = true; S.phase = 'planted';
    S.bombTimer = 27.4; S.bombPos = { x: 17, z: -12 };
    S.bots[0].pos.x = 20; S.bots[0].pos.z = -4; S.bots[0].state = 'defuse';
    S.bots[1].pos.x = 8; S.bots[1].pos.z = -12; S.bots[1].state = 'defuse';
    addFeed('Charge planted at Furnace A');
  } else if (kind === 'buy') {
    startBuyPhase(S);
    p.weapons.rifle.owned = true; p.weapons.rifle.mag = 25; p.weapons.rifle.reserve = 75;
    p.weapon = 'rifle';
    S.money = 3450;
    showBuy(true, S); buyOpen = true;
    p.pos.x = 0; p.pos.z = 14; p.yaw = 0; p.pitch = 0;
  }
}

init();
