// The engine: rendering, the fixed-step simulation, and the player's hands.
//
// The simulation runs at a fixed 120 steps per second, independent of the
// frame rate, so a match plays identically on any machine and a staged
// screenshot is the same render every time. Movement is Quake-style:
// acceleration toward the wish direction, friction on the ground, air
// control while jumping, and a step-up that lets a fighter climb a low
// ledge without jumping. Shooting is a hitscan ray against fighter hit
// spheres and the arena's boxes, with damage falloff, headshots, armour,
// per-weapon recoil patterns and bloom.
//
// Grenades are real projectiles with gravity and bounces. A flash blinds
// anyone whose eyes face the burst; smoke blocks bot vision because the
// vision test reads the same clouds the renderer draws; a high-explosive
// grenade hurts through distance, softened by cover.

import * as THREE from 'three';
import {
  ARENA, SOLIDS, SITES, SPAWNS, circleHitsSolid, groundHeight,
  raySolids, hasLineOfSight,
} from './arena.js';
import { WEAPONS, GRENADES, GEAR, damageAt, recoilAt } from './guns.js';
import {
  Fighter, buildFigure, spawnFigure, animateFigure,
  makeBrain, brainThink, brainStep, TEAMS, EYE_HEIGHT,
} from './fighters.js';
import { createMatch, buyCatalog, buyItem, botBuy, endRound, startRound, matchTick, PHASES, PAYOUT } from './match.js';
import { Effects } from './fx.js';
import { Hud } from './hud.js';
import { makeStream, hashSeed, clamp, lerp } from './rng.js';

const STEP = 1 / 120;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;
const STEP_UP = 0.55;
const PLANT_SECONDS = 3.5;
const DEFUSE_SECONDS = 10;
const DEVICE_FUSE = 40;

// ---------------------------------------------------------------------------
// Sound: tiny procedural synth (WebAudio, no assets). A shot is a filtered
// noise burst with a pitch per weapon; a reload is two clicks; the device
// beeps faster as it nears detonation; an explosion is a low boom.
// ---------------------------------------------------------------------------
class Synth {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  blip(freq, dur, gain, type = 'square') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.4), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur, gain, filterFreq) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.ctx.destination);
    src.start(t);
  }

  shot(weaponId, dist) {
    const vol = clamp(1 - dist / 60, 0.15, 1);
    const pitch = { pistol: 900, rifle: 620, carbine: 760, smg: 980, sniper: 320, shotgun: 420 }[weaponId] || 600;
    this.noise(0.09, 0.5 * vol, 3200);
    this.blip(pitch, 0.07, 0.16 * vol);
  }

  reload() { this.blip(1200, 0.05, 0.1); setTimeout(() => this.blip(900, 0.05, 0.1), 180); }
  beep() { this.blip(1560, 0.09, 0.14, 'sine'); }
  boom() { this.noise(0.7, 0.9, 420); this.blip(70, 0.6, 0.5, 'sine'); }
  plantTick() { this.blip(1900, 0.05, 0.08, 'sine'); }
}

// ---------------------------------------------------------------------------
// The arena's visible geometry, built once from the arena data.
// ---------------------------------------------------------------------------
const SOLID_COLORS = {
  wall: 0x4a4f55, crate: 0x8a6b3a, container: 0x3f6b8a, furnace: 0x5c3a2a,
  pillar: 0x565d64, conveyor: 0x3a3f45, walkway: 0x6b7280, ramp: 0x6b7280,
};

function buildArenaMeshes(scene) {
  const group = new THREE.Group();
  // Floor: dark concrete with a subtle grid texture painted by canvas.
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const c = canvas.getContext('2d');
  c.fillStyle = '#2e3236';
  c.fillRect(0, 0, 256, 256);
  c.strokeStyle = '#3a3f44';
  c.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32, 256); c.stroke();
    c.beginPath(); c.moveTo(0, i * 32); c.lineTo(256, i * 32); c.stroke();
  }
  c.fillStyle = '#33383d';
  const speckle = makeStream(hashSeed('ironveil-floor'));
  for (let i = 0; i < 40; i++) {
    c.fillRect(speckle.next() * 256, speckle.next() * 256, 6, 3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 7);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(74, 49),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  for (const s of SOLIDS) {
    const mat = new THREE.MeshStandardMaterial({
      color: SOLID_COLORS[s.kind] || 0x555555, roughness: 0.85, metalness: 0.25,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), mat);
    mesh.position.set(s.x, s.y0 + s.h / 2, s.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // A hazard stripe on low cover, a rim on containers.
    if (s.kind === 'crate' || s.kind === 'container') {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(s.w + 0.02, 0.12, s.d + 0.02),
        new THREE.MeshStandardMaterial({ color: 0xd8a02a, roughness: 0.7 }),
      );
      stripe.position.set(s.x, s.y0 + s.h - 0.15, s.z);
      group.add(stripe);
    }
  }

  // The furnace glows: an emissive mouth on the west block.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2.4),
    new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff4a00, emissiveIntensity: 2.2 }),
  );
  glow.position.set(-28, 1.6, -9.9);
  group.add(glow);
  const glowLight = new THREE.PointLight(0xff5a1a, 30, 18, 1.6);
  glowLight.position.set(-28, 2.5, -8);
  group.add(glowLight);

  // Site markers: a glowing ring on the floor at each plant site.
  for (const site of [SITES.A, SITES.B]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 48),
      new THREE.MeshBasicMaterial({ color: 0xe07a2e, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.06, site.z);
    group.add(ring);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0xe07a2e, emissive: 0xe07a2e, emissiveIntensity: 0.8 }),
    );
    pole.position.set(site.x, 2.5, site.z);
    group.add(pole);
  }

  // Sky: a dusk gradient dome and a low sun.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x1c2733, side: THREE.BackSide, fog: false }),
  );
  group.add(sky);
  scene.add(group);
  return group;
}

// ---------------------------------------------------------------------------
// Grenade projectiles.
// ---------------------------------------------------------------------------
class Grenade {
  constructor(kind, pos, vel, owner) {
    this.kind = kind;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.owner = owner;
    this.bounces = 0;
    this.fuse = kind === 'he' ? 0.9 : kind === 'flash' ? 0.9 : 0;
    this.detonated = false;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: kind === 'smoke' ? 0x9aa0a6 : kind === 'flash' ? 0xd8d8d8 : 0x3a5a2a, roughness: 0.5 }),
    );
    this.mesh.position.copy(this.pos);
  }
}

// ---------------------------------------------------------------------------
// The game.
// ---------------------------------------------------------------------------
export function createGame(container, opts = {}) {
  const seed = opts.seed ?? hashSeed('ironveil-dockside');
  const stream = makeStream(seed);
  const demo = !!opts.demo; // attract mode: bots fight, camera is cinematic
  const shot = opts.shot || null; // 'cover' | 'fight' | 'site' | 'buy'

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(container.clientWidth || 1280, container.clientHeight || 720);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1c2733, 55, 160);
  const camera = new THREE.PerspectiveCamera(78, 1280 / 720, 0.08, 400);

  // Light: a low dusk sun plus a soft sky fill.
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.4);
  sun.position.set(30, 42, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 140;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8fa3b8, 0x2a2620, 0.85));

  buildArenaMeshes(scene);
  const fx = new Effects(scene);
  const synth = new Synth();

  // --- Fighters ------------------------------------------------------------
  const names = {
    attack: ['Rust', 'Ember', 'Slag', 'Forge', 'Cinder'],
    defend: ['Harbor', 'Anchor', 'Beacon', 'Tide', 'Quay'],
  };
  const roles = {
    attack: ['entry', 'entry', 'support', 'lurker', 'support'],
    defend: ['anchor', 'anchor', 'awper', 'anchor', 'support'],
  };
  const fighters = [];
  const brains = new Map();
  for (let i = 0; i < 5; i++) {
    const s = SPAWNS.attack[i];
    const f = new Fighter({ name: names.attack[i], team: 'attack', role: roles.attack[i], x: s.x, z: s.z, yaw: s.yaw, money: 800 });
    f.weaponId = i === 3 ? 'smg' : 'rifle';
    f.ammo = WEAPONS[f.weaponId].mag;
    f.reserve = WEAPONS[f.weaponId].reserve;
    fighters.push(f);
    brains.set(f.id, makeBrain(f, f.role, makeStream(seed + f.id * 7919)));
  }
  for (let i = 0; i < 5; i++) {
    const s = SPAWNS.defend[i];
    const f = new Fighter({ name: names.defend[i], team: 'defend', role: roles.defend[i], x: s.x, z: s.z, yaw: s.yaw, money: 800 });
    f.weaponId = i === 2 ? 'sniper' : 'rifle';
    f.ammo = WEAPONS[f.weaponId].mag;
    f.reserve = WEAPONS[f.weaponId].reserve;
    fighters.push(f);
    brains.set(f.id, makeBrain(f, f.role, makeStream(seed + f.id * 7919)));
  }

  // The player is the first attacker in interactive mode; in demo/shot mode
  // every fighter is a bot and the camera is staged.
  const player = fighters[0];
  player.isPlayer = !demo && !shot;
  const playerBrain = brains.get(player.id);

  for (const f of fighters) spawnFigure(scene, f);

  // The plant device: a small glowing case on the carrier's back.
  const deviceMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.22, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xe07a2e, emissive: 0xe07a2e, emissiveIntensity: 1.2 }),
  );
  scene.add(deviceMesh);
  const plantedMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.34, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xff3020, emissiveIntensity: 1.4, roughness: 0.4 }),
  );
  plantedMesh.visible = false;
  scene.add(plantedMesh);

  const match = createMatch();
  match.plant.targetSite = stream.next() < 0.5 ? SITES.A : SITES.B;
  fighters[0].hasDevice = true;

  const hud = new Hud(document.createElement('div'));
  hud.root.id = 'hud-root';
  container.appendChild(hud.root);

  const world = {
    fighters,
    smokes: [],
    sounds: [],
    plant: match.plant,
    time: 0,
  };

  const game = {
    renderer, scene, camera, fighters, player, match, hud, fx, synth,
    seed, stream, demo, shot,
    time: 0,
    accumulator: 0,
    grenades: [],
    killfeed: [],
    playerState: {
      vel: new THREE.Vector3(),
      onGround: true,
      bloom: 0,
      sprayIndex: 0,
      nextShotAt: 0,
      reloadingUntil: 0,
      grenadeIndex: 0,
      interactProgress: 0,
      firing: false,
      keys: {},
      yaw: player.yaw,
      pitch: 0,
    },
    staged: false,
    disposed: false,
  };
  game.brains = brains;
  game.deviceMesh = deviceMesh;
  game.plantedMesh = plantedMesh;

  // --- Input ---------------------------------------------------------------
  const ps = game.playerState;
  const keyMap = { KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r', ShiftLeft: 'walk', ControlLeft: 'crouch', KeyC: 'crouch', Space: 'jump' };
  window.addEventListener('keydown', (e) => {
    if (keyMap[e.code]) ps.keys[keyMap[e.code]] = true;
    if (e.code === 'KeyR') startReload(game);
    if (e.code === 'Digit1') switchWeapon(game, 'primary');
    if (e.code === 'Digit2') switchWeapon(game, 'pistol');
    if (e.code === 'KeyQ') cycleGrenade(game);
    if (e.code === 'KeyG') throwGrenade(game);
    if (e.code === 'KeyB') toggleBuy(game);
    if (e.code === 'Tab') { e.preventDefault(); hud.renderScoreboard(true, hudState(game)); }
    if (e.code.startsWith('Digit') && game.buyOpen) {
      const items = buyCatalog();
      const item = items[Number(e.code.slice(5)) - 1];
      if (item) buyItem(player, item.id, match);
    }
    if (e.code === 'KeyE') ps.interact = true;
  });
  window.addEventListener('keyup', (e) => {
    if (keyMap[e.code]) ps.keys[keyMap[e.code]] = false;
    if (e.code === 'KeyE') ps.interact = false;
    if (e.code === 'Tab') hud.renderScoreboard(false, hudState(game));
  });
  renderer.domElement.addEventListener('click', () => {
    synth.ensure();
    if (!demo && !shot && document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    game.locked = document.pointerLockElement === renderer.domElement;
  });
  document.addEventListener('mousemove', (e) => {
    if (!game.locked || player.isPlayer === false) return;
    const sens = 0.0021 * (ps.aiming ? 0.6 : 1);
    ps.yaw -= e.movementX * sens;
    ps.pitch = clamp(ps.pitch - e.movementY * sens, -1.5, 1.5);
    player.yaw = ps.yaw;
    player.pitch = ps.pitch;
  });
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !game.locked) return;
    ps.firing = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) ps.firing = false;
  });
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button === 2) ps.aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) ps.aiming = false;
  });

  // --- Staged shots ----------------------------------------------------------
  if (shot) stageShot(game, shot);

  // --- The loop --------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    if (game.disposed) return;
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    game.accumulator += dt;
    while (game.accumulator >= STEP) {
      step(game, STEP);
      game.accumulator -= STEP;
    }
    render(game, dt);
  }
  requestAnimationFrame(frame);
  return game;
}

// ---------------------------------------------------------------------------
// One fixed simulation step.
// ---------------------------------------------------------------------------
function step(game, dt) {
  const { match, fighters, player } = game;
  game.time += dt;
  const now = game.time;

  // Match clock and phase changes.
  const event = matchTick(match, dt);
  if (event === 'freeze') {
    game.hud.showBanner(`ROUND ${match.round}`, `${match.plant.targetSite.name} — the attack goes ${match.plant.targetSite.id}`, 2.5);
  }
  if (event === 'live') {
    game.hud.addNote('Round live — good hunting.');
  }
  if (event === 'nextRound') {
    nextRound(game);
    return;
  }
  if (event === 'matchOver') {
    game.hud.renderScoreboard(true, hudState(game));
    return;
  }

  // The planted device ticks down.
  if (match.plant.state === 'planted') {
    match.plant.timer -= dt;
    if (Math.floor(match.plant.timer * 2) !== Math.floor((match.plant.timer + dt) * 2)) {
      game.synth.beep();
    }
    if (match.plant.timer <= 0) {
      match.plant.state = 'exploded';
      game.fx.explosion(new THREE.Vector3(match.plant.x, 0.6, match.plant.z), now);
      game.synth.boom();
      for (const f of fighters) {
        if (!f.alive) continue;
        const d = Math.hypot(f.pos.x - match.plant.x, f.pos.z - match.plant.z);
        if (d < 14) {
          const dmg = Math.max(0, 110 * (1 - d / 14));
          killOrDamage(game, f, dmg, null, false);
        }
      }
      endRound(match, fighters, 'attack', 'Device detonated');
      game.hud.showBanner('DEVICE DETONATED', 'Rustjackets take the round', 4);
      return;
    }
  }

  // Bot brains think at 10 Hz; steering runs every step. During the buy
  // and freeze phases everybody holds at spawn; the fight starts live.
  const botsHold = match.phase === PHASES.BUY || match.phase === PHASES.FREEZE;
  for (const f of fighters) {
    if (f.isPlayer) continue;
    const brain = game.brains ? game.brains.get(f.id) : null;
    if (!brain) continue;
    if (botsHold) {
      animateFigure(f, dt);
      continue;
    }
    if (now >= brain.thinkAt) {
      brainThink(brain, gameWorld(game), now);
      brain.thinkAt = now + 0.1;
    }
    const intent = brainStep(brain, gameWorld(game), now, dt);
    moveFighter(game, f, intent.moveX, intent.moveZ, dt, false);
    if (intent.wantFire) botFire(game, f, brain, now);
    // Planting and defusing progress while the bot stands on the objective.
    if (brain.state === 'plant') {
      f.planting += dt / PLANT_SECONDS;
      if (f.planting >= 1) {
        f.planting = 0;
        plantDevice(game, f);
      }
    } else {
      f.planting = 0;
    }
    if (brain.state === 'defuse') {
      const rate = f.defuseKit ? 1 / GEAR.defuseKit.defuseTime : 1 / DEFUSE_SECONDS;
      f.defusing += dt * rate;
      if (f.defusing >= 1) {
        f.defusing = 0;
        defuseDevice(game, f);
      }
    } else {
      f.defusing = 0;
    }
    animateFigure(f, dt);
  }

  // The player (or the staged camera fighter in demo mode).
  if (player.isPlayer && match.phase === PHASES.LIVE) {
    stepPlayer(game, dt, now);
  } else if ((game.demo || game.shot) && match.phase === PHASES.LIVE) {
    // In demo/shot mode the first attacker is bot-driven too.
    const brain = game.brains ? game.brains.get(player.id) : null;
    if (brain) {
      if (now >= brain.thinkAt) {
        brainThink(brain, gameWorld(game), now);
        brain.thinkAt = now + 0.1;
      }
      const intent = brainStep(brain, gameWorld(game), now, dt);
      moveFighter(game, player, intent.moveX, intent.moveZ, dt, false);
      if (intent.wantFire) botFire(game, player, brain, now);
      animateFigure(player, dt);
    }
  }

  // Grenades fly, bounce and detonate.
  stepGrenades(game, dt, now);

  // Round end by elimination.
  if (match.phase === PHASES.LIVE) {
    const aliveA = fighters.filter((f) => f.team === 'attack' && f.alive).length;
    const aliveD = fighters.filter((f) => f.team === 'defend' && f.alive).length;
    if (aliveA === 0 && match.plant.state !== 'planted') {
      endRound(match, fighters, 'defend', 'Attackers eliminated');
      game.hud.showBanner('ROUND TO HARBOUR WATCH', 'Attackers eliminated', 3.5);
    } else if (aliveD === 0 && match.plant.state !== 'planted') {
      endRound(match, fighters, 'attack', 'Defenders eliminated');
      game.hud.showBanner('ROUND TO RUSTJACKETS', 'Defenders eliminated', 3.5);
    } else if (aliveD === 0 && match.plant.state === 'planted') {
      // No defenders left to defuse: the device will decide the round.
    }
    if (match.clock <= 0 && match.plant.state !== 'planted') {
      endRound(match, fighters, 'defend', 'Time expired — site held');
      game.hud.showBanner('TIME EXPIRED', 'Harbour Watch hold the yard', 3.5);
    }
  }

  // Sounds fade out of the hearing list.
  gameWorld(game).sounds = gameWorld(game).sounds.filter((s) => now - s.at < 2);
  game.world.sounds = gameWorld(game).sounds;

  // Figures follow their fighters.
  for (const f of fighters) {
    if (!f.figure) continue;
    f.figure.position.copy(f.pos);
    f.figure.rotation.y = f.yaw;
    if (!f.alive) animateFigure(f, dt);
  }

  // The device rides on the carrier's back until it is planted.
  const carrier = fighters.find((f) => f.hasDevice && f.alive);
  if (carrier && match.plant.state === 'none') {
    game.deviceMesh = game.deviceMesh || null;
  }
  game.fx.update(dt, now);
}

function gameWorld(game) {
  if (!game.world) {
    game.world = {
      fighters: game.fighters,
      smokes: [],
      sounds: [],
      plant: game.match.plant,
      time: game.time,
    };
  }
  game.world.smokes = game.fx.smokeVolumes();
  game.world.plant = game.match.plant;
  game.world.time = game.time;
  return game.world;
}

function nextRound(game) {
  const { match, fighters } = game;
  if (match.matchWinner) {
    game.hud.showBanner(
      match.matchWinner === 'attack' ? 'RUSTJACKETS WIN THE MATCH' : 'HARBOUR WATCH WIN THE MATCH',
      `${match.score.attack} — ${match.score.defend}`,
      8,
    );
    return;
  }
  startRound(match, fighters, game.stream);
  // Respawn everybody at their spawn, fresh health, pistol if broke.
  for (const f of fighters) {
    const spawns = f.team === 'attack' ? SPAWNS.attack : SPAWNS.defend;
    const s = spawns[fighters.filter((x) => x.team === f.team).indexOf(f) % spawns.length];
    f.respawn(s.x, s.z, s.yaw);
    f.armor = 0;
    f.helmet = false;
    f.defuseKit = false;
    f.figure.rotation.x = 0;
    f.figure.position.y = f.pos.y;
    if (!f.isPlayer) botBuy(f, game.stream);
    f.weaponId = f.weaponId || 'pistol';
    const w = WEAPONS[f.weaponId];
    f.ammo = w.mag;
    f.reserve = w.reserve;
    f.grenades = { flash: 0, smoke: 0, he: 0 };
    if (f.isPlayer) {
      game.playerState.yaw = s.yaw;
      game.playerState.pitch = 0;
    }
  }
  game.grenades.forEach((g) => game.scene.remove(g.mesh));
  game.grenades = [];
  game.fx.smokes.slice().forEach((c) => {
    c.sprites.forEach((s) => game.scene.remove(s));
  });
  game.fx.smokes = [];
  game.hud.showBanner(`ROUND ${match.round}`, `Site ${match.plant.targetSite.id} — ${match.plant.targetSite.name}`, 3);
}

// ---------------------------------------------------------------------------
// Movement: Quake-style acceleration, friction, step-up, gravity.
// ---------------------------------------------------------------------------
function moveFighter(game, f, inputX, inputZ, dt, isPlayer) {
  const ps = isPlayer ? game.playerState : null;
  const weapon = WEAPONS[f.weaponId] || WEAPONS.pistol;
  const speedBase = weapon.moveSpeed * (f.crouch ? 0.45 : 1) * (f.aiming ? 0.6 : 1);
  const wishX = Math.sin(f.yaw) * -inputZ + Math.cos(f.yaw) * inputX;
  const wishZ = Math.cos(f.yaw) * -inputZ + Math.sin(f.yaw) * -inputX;
  const wishLen = Math.hypot(wishX, wishZ);
  const speed = isPlayer && ps.keys.walk ? speedBase * 0.55 : speedBase;
  const vel = isPlayer ? ps.vel : (f.vel = f.vel || new THREE.Vector3());

  if (f.onGround) {
    // Friction: bleed speed when no input, Quake-style.
    const friction = 8;
    const curSpeed = Math.hypot(vel.x, vel.z);
    if (curSpeed > 0.01) {
      const drop = curSpeed * friction * dt;
      const scale = Math.max(0, curSpeed - drop) / curSpeed;
      vel.x *= scale;
      vel.z *= scale;
    }
    // Accelerate toward the wish direction, capped at the weapon's speed.
    if (wishLen > 0.01) {
      const accel = 42;
      const wishSpeed = speed * Math.min(1, wishLen);
      const curAlong = (vel.x * wishX + vel.z * wishZ) / wishLen;
      const addSpeed = wishSpeed - curAlong;
      if (addSpeed > 0) {
        const accelSpeed = Math.min(accel * wishSpeed * dt, addSpeed);
        vel.x += (wishX / wishLen) * accelSpeed;
        vel.z += (wishZ / wishLen) * accelSpeed;
      }
    }
  } else {
    // Air control: gentle steering, no friction.
    if (wishLen > 0.01) {
      vel.x += (wishX / wishLen) * 6 * dt;
      vel.z += (wishZ / wishLen) * 6 * dt;
      const hs = Math.hypot(vel.x, vel.z);
      if (hs > speed * 1.1) {
        vel.x *= (speed * 1.1) / hs;
        vel.z *= (speed * 1.1) / hs;
      }
    }
  }

  // Step the position, axis by axis, so a fighter slides along walls.
  const r = 0.42;
  let nx = f.pos.x + vel.x * dt;
  if (!circleHitsSolid(nx, f.pos.z, r)) {
    f.pos.x = nx;
  } else {
    vel.x = 0;
  }
  let nz = f.pos.z + vel.z * dt;
  if (!circleHitsSolid(f.pos.x, nz, r)) {
    f.pos.z = nz;
  } else {
    vel.z = 0;
  }

  // Vertical: step up low ledges, fall with gravity, land on the ground.
  const ground = groundHeight(f.pos.x, f.pos.z);
  if (f.onGround) {
    if (ground > f.pos.y && ground - f.pos.y <= STEP_UP) {
      f.pos.y = ground; // step up onto the ledge
    } else if (ground < f.pos.y - 0.01) {
      f.onGround = false;
      vel.y = 0;
    } else {
      f.pos.y = ground;
    }
  } else {
    vel.y -= GRAVITY * dt;
    f.pos.y += vel.y * dt;
    if (f.pos.y <= ground) {
      f.pos.y = ground;
      vel.y = 0;
      f.onGround = true;
    }
  }
  if (isPlayer && ps.keys.jump && f.onGround) {
    vel.y = JUMP_SPEED;
    f.onGround = false;
  }
  f.speed = Math.hypot(vel.x, vel.z);
  f.moving = f.speed > 0.5;
  f.crouch = isPlayer ? !!ps.keys.crouch : f.crouch;
  f.aiming = isPlayer ? !!ps.aiming : f.aiming;
}

// ---------------------------------------------------------------------------
// Shooting.
// ---------------------------------------------------------------------------
function muzzlePos(f) {
  const eye = f.eyePos(new THREE.Vector3());
  const forward = new THREE.Vector3(-Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), -Math.cos(f.yaw) * Math.cos(f.pitch));
  return { eye, muzzle: eye.clone().add(forward.clone().multiplyScalar(0.7)).add(new THREE.Vector3(0, -0.12, 0)) };
}

function shoot(game, shooter, aimYaw, aimPitch, spread) {
  const weapon = WEAPONS[shooter.weaponId] || WEAPONS.pistol;
  if (shooter.ammo <= 0) {
    return;
  }
  shooter.ammo--;
  const pellets = weapon.pellets || 1;
  const { eye, muzzle } = muzzlePos(shooter);
  const stream = game.stream;
  let hitAnything = false;
  for (let p = 0; p < pellets; p++) {
    const yawErr = (stream.next() - 0.5) * 2 * spread + (shooter.aimError || 0) * (stream.next() - 0.5);
    const pitchErr = (stream.next() - 0.5) * 2 * spread + (shooter.aimError || 0) * (stream.next() - 0.5);
    const yaw = aimYaw + yawErr;
    const pitch = aimPitch + pitchErr;
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const wallDist = raySolids(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 120);
    // Nearest fighter hit: ray against each enemy's head/body spheres.
    let bestT = wallDist;
    let bestVictim = null;
    let bestPart = null;
    for (const other of game.fighters) {
      if (other === shooter || other.team === shooter.team || !other.alive) continue;
      for (const s of other.hitSpheres()) {
        const t = raySphere(eye, dir, s);
        if (t !== null && t < bestT) {
          bestT = t;
          bestVictim = other;
          bestPart = s.part;
        }
      }
    }
    const end = eye.clone().add(dir.clone().multiplyScalar(Math.min(bestT, 120)));
    game.fx.tracer(muzzle, end, weapon.tracer);
    if (bestVictim) {
      const dmg = damageAt(weapon, bestT) * (bestPart === 'head' ? weapon.headMul : 1);
      killOrDamage(game, bestVictim, dmg, shooter, bestPart === 'head');
      game.fx.hitPuff(end);
      hitAnything = true;
      if (shooter.isPlayer) {
        game.hud.hitmarker(!bestVictim.alive);
      }
    } else if (bestT < 120) {
      game.fx.sparks(end, 3);
    }
  }
  game.fx.muzzle(muzzle, new THREE.Vector3(-Math.sin(aimYaw), 0, -Math.cos(aimYaw)));
  const dist = Math.hypot(shooter.pos.x - game.player.pos.x, shooter.pos.z - game.player.pos.z);
  game.synth.shot(shooter.weaponId, dist);
  gameWorld(game).sounds.push({ x: shooter.pos.x, z: shooter.pos.z, at: game.time });
  // Recoil: the next shot climbs the pattern, and bloom widens the cone.
  const ps = shooter.isPlayer ? game.playerState : null;
  if (ps) {
    ps.bloom = Math.min(weapon.bloomMax, ps.bloom + weapon.bloomPerShot);
    const [kickPitch, kickYaw] = recoilAt(weapon, ps.sprayIndex++);
    ps.pitch = clamp(ps.pitch + kickPitch, -1.5, 1.5);
    ps.yaw += kickYaw;
    shooter.pitch = ps.pitch;
    shooter.yaw = ps.yaw;
  }
  return hitAnything;
}

function raySphere(origin, dir, s) {
  const ox = s.x - origin.x;
  const oy = s.y - origin.y;
  const oz = s.z - origin.z;
  const tca = ox * dir.x + oy * dir.y + oz * dir.z;
  if (tca < 0) return null;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  const r2 = s.r * s.r;
  if (d2 > r2) return null;
  return tca - Math.sqrt(r2 - d2);
}

/** Damage a fighter; on death, credit the killer and feed the kill feed. */
function killOrDamage(game, victim, amount, attacker, headshot) {
  if (!victim.alive) return;
  const dealt = victim.takeDamage(amount, headshot, game.time);
  if (attacker && attacker !== victim) {
    victim.lastDamageFrom = attacker;
  }
  if (!victim.alive) {
    if (attacker) {
      attacker.kills++;
      attacker.money += PAYOUT.kill;
      const weapon = WEAPONS[attacker.weaponId] || WEAPONS.pistol;
      game.hud.addKill(attacker, victim, weapon.name, headshot);
    }
    if (victim.hasDevice) {
      // The device drops where its carrier fell; a teammate can pick it up.
      victim.hasDevice = false;
      game.droppedDevice = { x: victim.pos.x, z: victim.pos.z };
      game.hud.addNote(`${victim.name} dropped the device.`);
    }
    // A dead fighter's figure falls.
    if (victim.figure) victim.figure.rotation.x = 0;
  }
  return dealt;
}

/** A bot firing at its target with its own spread and burst discipline. */
function botFire(game, bot, brain, now) {
  const weapon = WEAPONS[bot.weaponId] || WEAPONS.pistol;
  if (bot.ammo <= 0) {
    bot.ammo = weapon.mag;
    bot.reserve = Math.max(0, bot.reserve - weapon.mag);
    return;
  }
  if (now < (bot.nextShotAt || 0)) return;
  bot.nextShotAt = now + weapon.fireInterval * (1.4 + (1 - brain.skill) * 0.8);
  const spread = weapon.spreadBase + weapon.spreadMove * 0.4 + (bot.aimError || 0.02);
  shoot(game, bot, bot.yaw, bot.pitch, spread);
}

// ---------------------------------------------------------------------------
// The player step: movement, firing, reload, interact.
// ---------------------------------------------------------------------------
function stepPlayer(game, dt, now) {
  const player = game.player;
  const ps = game.playerState;
  if (!player.alive) return;
  const weapon = WEAPONS[player.weaponId] || WEAPONS.pistol;

  // Bloom recovers when not firing.
  ps.bloom = Math.max(0, ps.bloom - weapon.bloomRecover * dt * 4);

  const ix = (ps.keys.r ? 1 : 0) - (ps.keys.l ? 1 : 0);
  const iz = (ps.keys.f ? 1 : 0) - (ps.keys.b ? 1 : 0);
  moveFighter(game, player, ix, iz, dt, true);
  animateFigure(player, dt);

  // Pick up a dropped device by walking over it.
  if (game.droppedDevice && player.team === 'attack') {
    const d = Math.hypot(player.pos.x - game.droppedDevice.x, player.pos.z - game.droppedDevice.z);
    if (d < 1.2) {
      player.hasDevice = true;
      game.droppedDevice = null;
      game.hud.addNote('You picked up the device.');
    }
  }

  // Firing.
  if (ps.firing && now >= ps.nextShotAt && now >= ps.reloadingUntil && game.match.phase === PHASES.LIVE) {
    const spread = currentSpread(game, weapon);
    shoot(game, player, ps.yaw, ps.pitch, spread);
    ps.nextShotAt = now + weapon.fireInterval;
    if (!weapon.auto) ps.firing = false;
    if (player.ammo <= 0) startReload(game);
  }
  if (!ps.firing) ps.sprayIndex = 0;

  // Plant / defuse: hold E on the objective.
  const plant = game.match.plant;
  if (ps.interact) {
    if (player.hasDevice && plant.state === 'none') {
      const site = plant.targetSite;
      if (Math.hypot(player.pos.x - site.x, player.pos.z - site.z) < site.r) {
        player.planting += dt / PLANT_SECONDS;
        if (player.planting >= 1) {
          player.planting = 0;
          plantDevice(game, player);
        }
      }
    }
    if (plant.state === 'planted' && player.team === 'defend') {
      if (Math.hypot(player.pos.x - plant.x, player.pos.z - plant.z) < 2.2) {
        const rate = player.defuseKit ? 1 / GEAR.defuseKit.defuseTime : 1 / DEFUSE_SECONDS;
        player.defusing += dt * rate;
        if (player.defusing >= 1) {
          player.defusing = 0;
          defuseDevice(game, player);
        }
      }
    }
  } else {
    player.planting = 0;
    player.defusing = 0;
  }
}

function currentSpread(game, weapon) {
  const ps = game.playerState;
  const player = game.player;
  let spread = weapon.spreadBase + ps.bloom;
  if (player.moving) spread += weapon.spreadMove;
  if (!player.onGround) spread += weapon.spreadAir;
  if (ps.aiming) spread *= weapon.adsSpreadMul;
  return spread;
}

function startReload(game) {
  const player = game.player;
  const ps = game.playerState;
  const weapon = WEAPONS[player.weaponId] || WEAPONS.pistol;
  if (player.ammo >= weapon.mag || player.reserve <= 0) return;
  if (game.time < ps.reloadingUntil) return;
  ps.reloadingUntil = game.time + weapon.reloadSeconds;
  game.synth.reload();
  const needed = weapon.mag - player.ammo;
  const take = Math.min(needed, player.reserve);
  setTimeout(() => {
    player.ammo += take;
    player.reserve -= take;
  }, weapon.reloadSeconds * 1000);
}

function switchWeapon(game, slot) {
  const player = game.player;
  if (slot === 'pistol') {
    player.weaponId = 'pistol';
    player.ammo = WEAPONS.pistol.mag;
    player.reserve = WEAPONS.pistol.reserve;
  } else {
    // Back to the bought primary, if one was bought.
    const primary = player.primaryWeapon || 'rifle';
    player.weaponId = primary;
  }
  game.playerState.sprayIndex = 0;
  game.playerState.bloom = 0;
}

function cycleGrenade(game) {
  const kinds = ['flash', 'smoke', 'he'];
  const ps = game.playerState;
  ps.grenadeIndex = (ps.grenadeIndex + 1) % kinds.length;
}

function throwGrenade(game) {
  const player = game.player;
  const ps = game.playerState;
  const kinds = ['flash', 'smoke', 'he'];
  const kind = kinds[ps.grenadeIndex];
  const g = player.grenades || { flash: 0, smoke: 0, he: 0 };
  if (!g[kind] || g[kind] <= 0) return;
  if (game.match.phase !== PHASES.LIVE) return;
  g[kind]--;
  const { eye } = muzzlePos(player);
  const dir = new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch) + 0.25, -Math.cos(player.yaw) * Math.cos(player.pitch)).normalize();
  const grenade = new Grenade(kind, eye, dir.multiplyScalar(13), player);
  game.scene.add(grenade.mesh);
  game.grenades.push(grenade);
}

function stepGrenades(game, dt, now) {
  for (let i = game.grenades.length - 1; i >= 0; i--) {
    const g = game.grenades[i];
    g.vel.y -= GRAVITY * 0.7 * dt;
    g.pos.addScaledVector(g.vel, dt);
    // Bounce off the floor and the walls, softly.
    const ground = groundHeight(g.pos.x, g.pos.z);
    if (g.pos.y < ground + 0.09) {
      g.pos.y = ground + 0.09;
      g.vel.y = Math.abs(g.vel.y) * 0.35;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
      g.bounces++;
    }
    if (circleHitsSolid(g.pos.x, g.pos.z, 0.1)) {
      g.vel.x *= -0.4;
      g.vel.z *= -0.4;
      g.pos.addScaledVector(g.vel, dt);
      g.bounces++;
    }
    g.mesh.position.copy(g.pos);
    g.fuse -= dt;
    const shouldBurst = g.kind === 'smoke' ? g.bounces > 0 : g.fuse <= 0;
    if (shouldBurst && !g.detonated) {
      g.detonated = true;
      detonateGrenade(game, g, now);
      game.scene.remove(g.mesh);
      game.grenades.splice(i, 1);
    }
  }
}

function detonateGrenade(game, g, now) {
  if (g.kind === 'smoke') {
    game.fx.smoke(g.pos.x, g.pos.y, g.pos.z, now);
    game.hud.addNote('Smoke is up.');
    return;
  }
  if (g.kind === 'flash') {
    game.fx.explosion(g.pos, now);
    // Anyone whose eyes face the burst, within range and line of sight,
    // is blinded: longer the closer and the more directly they look at it.
    for (const f of game.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.pos.x - g.pos.x, f.pos.z - g.pos.z);
      if (d > 26) continue;
      const eye = f.eyePos(new THREE.Vector3());
      if (!hasLineOfSight(eye.x, eye.y, eye.z, g.pos.x, g.pos.y + 0.2, g.pos.z)) continue;
      const toBurst = Math.atan2(-(g.pos.x - f.pos.x), -(g.pos.z - f.pos.z));
      let diff = toBurst - f.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const facing = Math.max(0, 1 - Math.abs(diff) / 1.6);
      const blind = (2.5 * facing * (1 - d / 30)) + 0.2;
      if (blind > 0.3) {
        f.flashUntil = now + blind;
        if (f.isPlayer) game.hud.flashScreen(blind);
      }
    }
    return;
  }
  // HE: damage falls with distance, and a wall between halves it.
  game.fx.explosion(g.pos, now);
  game.synth.boom();
  for (const f of game.fighters) {
    if (!f.alive) continue;
    const d = Math.hypot(f.pos.x - g.pos.x, f.pos.z - g.pos.z);
    if (d > 9) continue;
    const eye = f.eyePos(new THREE.Vector3());
    const covered = !hasLineOfSight(eye.x, eye.y, eye.z, g.pos.x, g.pos.y + 0.2, g.pos.z);
    const dmg = 95 * (1 - d / 9) * (covered ? 0.5 : 1);
    killOrDamage(game, f, dmg, g.owner, false);
  }
}

// ---------------------------------------------------------------------------
// The objective.
// ---------------------------------------------------------------------------
function plantDevice(game, carrier) {
  const plant = game.match.plant;
  const site = plant.targetSite;
  plant.state = 'planted';
  plant.site = site;
  plant.x = carrier.pos.x;
  plant.z = carrier.pos.z;
  plant.timer = DEVICE_FUSE;
  carrier.hasDevice = false;
  game.plantedMesh.visible = true;
  game.plantedMesh.position.set(plant.x, 0.25, plant.z);
  game.match.score.attack += 0; // the round is won by the explosion or a defuse
  for (const f of game.fighters) if (f.team === 'attack') f.money += PAYOUT.plantBonus;
  game.hud.showBanner('DEVICE PLANTED', `${site.name} — ${DEVICE_FUSE} seconds to detonation`, 4);
  game.hud.addNote(`${carrier.name} planted the device at ${site.name}.`);
  game.synth.beep();
}

function defuseDevice(game, defuser) {
  const plant = game.match.plant;
  plant.state = 'defused';
  game.plantedMesh.visible = false;
  defuser.money += PAYOUT.defuseBonus;
  endRound(game.match, game.fighters, 'defend', 'Device defused');
  game.hud.showBanner('DEVICE DEFUSED', 'Harbour Watch take the round', 4);
  game.hud.addNote(`${defuser.name} defused the device.`);
}

// ---------------------------------------------------------------------------
// Buy menu.
// ---------------------------------------------------------------------------
function toggleBuy(game) {
  if (game.match.phase !== PHASES.BUY) return;
  game.buyOpen = !game.buyOpen;
  game.hud.renderBuy(game.buyOpen, buyCatalog(), game.player.money, (id) => {
    if (buyItem(game.player, id, game.match)) {
      const w = WEAPONS[id];
      if (w) game.player.primaryWeapon = id;
      game.hud.renderBuy(true, buyCatalog(), game.player.money, () => {});
    }
  });
  if (game.buyOpen) {
    document.exitPointerLock?.();
  }
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------
function render(game, dt) {
  const { player, camera } = game;
  // Camera: first-person from the player's eyes, or the staged camera.
  if (game.shotCamera) {
    camera.position.copy(game.shotCamera.pos);
    camera.lookAt(game.shotCamera.look);
    camera.fov = game.shotCamera.fov || 70;
    camera.updateProjectionMatrix();
  } else if (player.isPlayer) {
    const eye = player.eyePos(new THREE.Vector3());
    camera.position.copy(eye);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = game.playerState.yaw;
    camera.rotation.x = game.playerState.pitch;
    const targetFov = game.playerState.aiming ? 78 / (WEAPONS[player.weaponId]?.adsZoom || 1.2) : 78;
    camera.fov = lerp(camera.fov, targetFov, dt * 10);
    camera.updateProjectionMatrix();
  } else {
    // Demo mode: a slow cinematic orbit around the action.
    const t = game.time * 0.08;
    const cx = Math.sin(t) * 22;
    const cz = Math.cos(t * 0.7) * 14;
    camera.position.set(cx, 12 + Math.sin(t * 0.5) * 3, cz);
    camera.lookAt(0, 1, -6);
    camera.fov = 62;
    camera.updateProjectionMatrix();
  }

  // The device on the carrier's back.
  const carrier = game.fighters.find((f) => f.hasDevice && f.alive);
  if (carrier && game.match.plant.state === 'none') {
    const m = game.deviceMesh;
    if (m) {
      m.visible = true;
      m.position.set(carrier.pos.x, carrier.pos.y + 1.15, carrier.pos.z);
      m.rotation.y = carrier.yaw;
    }
  } else if (game.deviceMesh) {
    game.deviceMesh.visible = false;
  }

  game.hud.update(hudState(game), game.time);
  game.renderer.render(game.scene, camera);
}

function hudState(game) {
  const player = game.player;
  const weapon = WEAPONS[player.weaponId] || WEAPONS.pistol;
  return {
    player,
    fighters: game.fighters,
    match: game.match,
    plant: game.match.plant,
    smokes: game.fx.smokeVolumes(),
    weaponName: weapon.name,
    spread: currentSpread(game, weapon),
    aiming: game.playerState.aiming,
  };
}

// ---------------------------------------------------------------------------
// Staged shots: deterministic scenes for the four screenshots. Each one
// sets the seed, runs the simulation a fixed number of steps so the bots
// are mid-fight, then parks the camera where the action is.
// ---------------------------------------------------------------------------
function stageShot(game, shot) {
  const { match, fighters } = game;
  // Start the round live, with fighters already spread across the yard.
  match.phase = PHASES.LIVE;
  match.clock = 82;
  const stream = makeStream(hashSeed(`ironveil-shot-${shot}`));
  const spots = {
    cover: [
      [-20, 4, 2.4], [-8, -2, -1.2], [4, 8, 0.6], [18, -6, 2.8], [-26, -12, 0.4],
      [-14, -14, -2.2], [8, -12, 1.8], [24, -10, -0.6], [-2, 2, 3.0], [12, 2, -2.6],
    ],
    fight: [
      [-6, 2, 1.1], [2, 6, 0.4], [-14, -4, 2.2], [10, -2, -1.4], [-2, -8, 0.9],
      [6, -10, 2.5], [-18, -8, -2.0], [16, -8, 1.2], [0, -4, 2.9], [-10, 8, -0.8],
    ],
    site: [
      [-26, -12, 0.2], [-22, -16, 2.6], [-30, -8, -1.0], [-18, -10, 1.5], [-24, -18, -2.8],
      [24, -12, 2.2], [-28, -14, 0.8], [28, -14, -1.6], [-20, -6, 2.4], [30, -6, 0.2],
    ],
    buy: [
      [-14, 20, 3.1], [-7, 21, 3.1], [0, 21, 3.1], [7, 21, 3.1], [14, 20, 3.1],
      [-16, -20, 0], [-6, -21, 0], [0, -21, 0], [6, -21, 0], [16, -20, 0],
    ],
  };
  const layout = spots[shot] || spots.cover;
  fighters.forEach((f, i) => {
    const [x, z, yaw] = layout[i % layout.length];
    f.pos.set(x, groundHeight(x, z), z);
    f.yaw = yaw;
    f.figure.position.copy(f.pos);
    f.figure.rotation.y = yaw;
  });
  // A planted device for the site shot; a smoke cloud for the fight shot.
  if (shot === 'site') {
    match.plant.state = 'planted';
    match.plant.site = SITES.A;
    match.plant.x = -26;
    match.plant.z = -12;
    match.plant.timer = 32;
    game.plantedMesh.visible = true;
    game.plantedMesh.position.set(-26, 0.25, -12);
    const carrier = fighters.find((f) => f.hasDevice);
    if (carrier) carrier.hasDevice = false;
  }
  if (shot === 'fight') {
    match.round = 3;
    game.fx.smoke(8, 0, -4, 0);
    game.fx.smoke(-2, 0, 8, 0);
  }
  // Camera per shot.
  const cameras = {
    cover: { pos: new THREE.Vector3(-6, 9, 20), look: new THREE.Vector3(-6, 1, -10), fov: 66 },
    fight: { pos: new THREE.Vector3(-13, 3.4, 13), look: new THREE.Vector3(6, 1.2, -6), fov: 74 },
    site: { pos: new THREE.Vector3(-14, 5, 0), look: new THREE.Vector3(-27, 0.8, -12), fov: 68 },
    buy: { pos: new THREE.Vector3(0, 2.2, 18), look: new THREE.Vector3(0, 1.2, -12), fov: 70 },
  };
  game.shotCamera = cameras[shot] || cameras.cover;
  if (shot === 'buy') {
    // The buy shot is taken in the buy phase, looking north into the yard.
    match.phase = PHASES.BUY;
    match.clock = 16;
    game.buyOpen = true;
    game.hud.renderBuy(true, buyCatalog(), 4300, () => {});
    game.hud.showBanner('BUY PHASE', 'Spend your money — round 1', 6);
  }
  if (shot === 'site') {
    game.hud.showBanner('DEVICE PLANTED', 'Furnace Hall — 32 seconds', 6);
  }
  if (shot === 'fight') {
    game.hud.showBanner('ROUND 3', 'Rustjackets push mid', 4);
  }
  // Run the sim a fixed number of steps so poses, tracers and smoke settle
  // into a real mid-fight moment before the screenshot is taken.
  for (let i = 0; i < 150; i++) {
    step(game, STEP);
  }
  // The screenshot's HUD belongs to the player fighter: make sure it is
  // alive and at full health for the shot, whatever the staging fight did.
  const hero = fighters[0];
  if (!hero.alive) {
    hero.alive = true;
    hero.hp = 100;
    hero.deaths = Math.max(0, hero.deaths - 1);
    if (hero.figure) {
      hero.figure.rotation.x = 0;
      hero.figure.position.y = hero.pos.y;
    }
    hero.deadTimer = 0;
  } else {
    hero.hp = 100;
  }
  // A fingerprint of the staged simulation, written to the document so a
  // headless run can prove determinism: the same seed must stage the same
  // fight, byte for byte, on every machine.
  const fingerprint = fighters
    .map((f) => `${f.pos.x.toFixed(3)},${f.pos.z.toFixed(3)},${f.hp},${f.alive ? 1 : 0},${f.ammo}`)
    .join('|') + `|${match.round}|${match.score.attack}-${match.score.defend}`;
  let hash = 2166136261;
  for (let i = 0; i < fingerprint.length; i++) {
    hash ^= fingerprint.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  document.documentElement.setAttribute('data-simhash', (hash >>> 0).toString(16));
  game.staged = true;
}
