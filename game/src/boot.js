// boot.js — bootstrap and the render loop: renderer, camera, input, the
// fighter meshes, and the per-frame wiring between the simulation, the
// effects, the sound and the HUD. The simulation itself lives in sim.js;
// this file only shows it.

import * as THREE from "three";
import { buildMap, MAP } from "./map.js";
import { CFG, WEAPONS, GRENADES, ARMOR_PRICE } from "./state.js";
import { createSim, startMatch, stepFixed } from "./sim.js";
import { eyeHeight } from "./mover.js";
import { buyWeapon } from "./arms.js";
import { createFx, spawnTracer, spawnSparks, showFlash, spawnSmoke, spawnBlast, updateFx } from "./fx.js";
import { createSfx, playShot, playHit, playReload, playDry, playBeep, playPlant, playBlast, playRound, playStep } from "./sfx.js";
import { bindHud, updateHud, feedKill, feedLine, showBanner, hideBanner, showPlant, hidePlant, showPrompt, hidePrompt, hitmark, damageFlash, flashWhite, toast, openBuy, closeBuy, buyOpen } from "./hud.js";
import { applyShot, shotKind } from "./shots.js";

const sim = createSim();
const sfx = createSfx();
const shot = shotKind();
const staged = shot !== null;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById("view").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x2e2419, 0.011);
scene.background = new THREE.Color(0x2e2419);
const hemi = new THREE.HemisphereLight(0x8a7a66, 0x1a1410, 1.8);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xbfd0ff, 2.0);
moon.position.set(30, 42, 18);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -40;
moon.shadow.camera.right = 40;
moon.shadow.camera.top = 40;
moon.shadow.camera.bottom = -40;
scene.add(moon);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 260);
camera.rotation.order = "YXZ";
scene.add(camera);

buildMap(scene);
const fx = createFx(scene);

// --- Fighter meshes.
const bodyGeo = new THREE.CylinderGeometry(0.34, 0.42, 1.15, 10);
const headGeo = new THREE.SphereGeometry(0.22, 12, 10);
const gunGeo = new THREE.BoxGeometry(0.09, 0.14, 0.62);
const visorGeo = new THREE.BoxGeometry(0.3, 0.08, 0.06);
const mats = {
  ember: new THREE.MeshStandardMaterial({ color: 0xc96a1e, roughness: 0.7 }),
  slate: new THREE.MeshStandardMaterial({ color: 0x7a2e28, roughness: 0.7 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xc8a586, roughness: 0.8 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.6, metalness: 0.4 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.2, metalness: 0.6 }),
};
function fighterMesh(team) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, mats[team]);
  body.position.y = 0.85;
  body.castShadow = true;
  const head = new THREE.Mesh(headGeo, mats.skin);
  head.position.y = 1.56;
  head.castShadow = true;
  const visor = new THREE.Mesh(visorGeo, mats.visor);
  visor.position.set(0, 1.56, -0.2);
  const gun = new THREE.Mesh(gunGeo, mats.dark);
  gun.position.set(0.22, 1.05, -0.3);
  g.add(body, head, visor, gun);
  scene.add(g);
  return g;
}
const meshes = new Map();
for (const f of sim.fighters) {
  if (f === sim.player) continue;
  meshes.set(f.id, fighterMesh(f.team));
}
// Player viewmodel gun.
const vm = new THREE.Group();
const vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.42), mats.dark);
const vmBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.24), mats.dark);
vmBarrel.position.set(0, 0.03, -0.32);
const vmSight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.08), mats.visor);
vmSight.position.set(0, 0.09, -0.08);
vm.add(vmBody, vmBarrel, vmSight);
vm.position.set(0.28, -0.3, -0.6);
vm.scale.setScalar(0.8);
camera.add(vm);
// Igniter core mesh.
const coreMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.35, 0.5),
  new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb400, emissiveIntensity: 1.4 }),
);
coreMesh.visible = false;
scene.add(coreMesh);
const coreLight = new THREE.PointLight(0xffb400, 12, 10, 1.8);
coreLight.visible = false;
scene.add(coreLight);

// --- Input.
const keys = new Set();
let fireHeld = false;
let fireEdge = false;
let reloadEdge = false;
let grenadeEdge = null;
let aiming = false;
let locked = false;
let stepAcc = 0;

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") e.preventDefault();
  keys.add(e.code);
  if (e.code === "KeyR") reloadEdge = true;
  if (e.code === "KeyB" && sim.match.phase === "buy") {
    if (buyOpen(hud)) { closeBuy(hud); lockPointer(); } else { openBuy(hud); document.exitPointerLock(); }
  }
  if (e.code === "Digit1") switchWeapon("pistol");
  if (e.code === "Digit2") switchWeapon("scatter");
  if (e.code === "Digit3") switchWeapon("smg");
  if (e.code === "Digit4") switchWeapon("carbine");
  if (e.code === "Digit5") switchWeapon("marksman");
  if (e.code === "Digit6") grenadeEdge = "flash";
  if (e.code === "Digit7") grenadeEdge = "smoke";
  if (e.code === "Digit8") grenadeEdge = "he";
  if (e.code === "KeyG") grenadeEdge = "flash";
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
renderer.domElement.addEventListener("mousedown", (e) => {
  if (e.button === 0) { fireHeld = true; fireEdge = true; }
  if (e.button === 2) aiming = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) fireHeld = false;
  if (e.button === 2) aiming = false;
});
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
renderer.domElement.addEventListener("click", () => {
  if (!staged && sim.match.phase !== "menu" && !buyOpen(hud)) lockPointer();
});
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
});
document.addEventListener("mousemove", (e) => {
  if (!locked || staged) return;
  const p = sim.player;
  p.yaw -= e.movementX * 0.0023;
  p.pitch -= e.movementY * 0.0023;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
});
function lockPointer() {
  if (!staged) renderer.domElement.requestPointerLock();
}
function switchWeapon(key) {
  const p = sim.player;
  if (p.ammo[key] && p.weapon !== key) {
    p.weapon = key;
    p.reloading = false;
    playBeep(sfx, true);
  }
}
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- HUD wiring.
const hud = bindHud((key) => {
  const p = sim.player;
  if (sim.match.phase !== "buy") { toast(hud, "The buy phase is over."); return; }
  if (key === "armor") {
    if (p.armor >= 100) { toast(hud, "Armor already full."); return; }
    if (p.money < ARMOR_PRICE) { toast(hud, "Not enough cash."); return; }
    p.money -= ARMOR_PRICE;
    p.armor = 100;
    playBeep(sfx, true);
    return;
  }
  if (key === "flash" || key === "smoke" || key === "he") {
    const price = GRENADES[key].price;
    if (p.money < price) { toast(hud, "Not enough cash."); return; }
    if ((p.nades[key] ?? 0) >= 2) { toast(hud, "Carrying the max of those."); return; }
    p.money -= price;
    p.nades[key] = (p.nades[key] ?? 0) + 1;
    playBeep(sfx, true);
    return;
  }
  const before = p.money;
  p.money = buyWeapon(p, key, p.money);
  if (p.money !== before) playBeep(sfx, true);
  else toast(hud, "Not enough cash.");
});
document.getElementById("play").addEventListener("click", () => {
  document.getElementById("menu").style.display = "none";
  startMatch(sim);
  lockPointer();
});

// --- Event drain: sim events -> sound, feed, banners, effects.
function drainEvents() {
  const p = sim.player;
  for (const e of sim.events) {
    if (e.type === "shot") {
      playShot(sfx, e.shooter.weapon);
      const from = { x: e.shooter.x, y: (e.shooter.y ?? 0) + eyeHeight(e.shooter), z: e.shooter.z };
      spawnTracer(fx, from, e.shot.point, sim.time + 0.08);
      if (e.shot.fighter) spawnSparks(fx, e.shot.point.x, e.shot.point.y, e.shot.point.z, 6);
      if (e.shooter === p) {
        showFlash(fx, 0.3, -0.2, -0.9);
        p.pitch += WEAPONS[p.weapon].kick * 0.006;
      }
    } else if (e.type === "hit") {
      if (e.victim !== p) hitmark(hud, e.headshot);
      playHit(sfx, e.headshot);
    } else if (e.type === "kill") {
      feedKill(hud, e.killer, e.victim, e.headshot);
      if (e.victim === p) damageFlash(hud);
    } else if (e.type === "dryfire") {
      playDry(sfx);
    } else if (e.type === "reload") {
      if (e.fighter === p) playReload(sfx);
    } else if (e.type === "planted") {
      showBanner(hud, "IGNITER PLANTED", `${e.fighter.name} planted the Igniter — defend it.`, "#ffb454");
      playPlant(sfx);
      setTimeout(() => hideBanner(hud), 2600);
    } else if (e.type === "defused") {
      showBanner(hud, "IGNITER DEFUSED", "Slate saved the Reactor.", "#8fd0ff");
    } else if (e.type === "detonated") {
      spawnBlast(fx, sim.match.core.x, 1, sim.match.core.z);
      playBlast(sfx);
      showBanner(hud, "REACTOR DOWN", "The Igniter detonated.", "#ff7a3a");
    } else if (e.type === "round") {
      const won = e.winner === "ember";
      showBanner(hud, won ? "ROUND WON" : "ROUND LOST", e.reason, won ? "#a8e6a1" : "#ff7a6e");
      playRound(sfx, won);
      setTimeout(() => hideBanner(hud), 3200);
    } else if (e.type === "match") {
      const won = e.winner === "ember";
      showBanner(hud, won ? "MATCH WON" : "MATCH LOST", won ? "Ember takes the Foundry Yard." : "Slate holds the Foundry Yard.", won ? "#a8e6a1" : "#ff7a6e");
      playRound(sfx, won);
    } else if (e.type === "flash") {
      spawnSparks(fx, e.x, e.y, e.z, 10);
    } else if (e.type === "smoke") {
      spawnSmoke(fx, e.x, 1.2, e.z);
    } else if (e.type === "he") {
      spawnSparks(fx, e.x, e.y, e.z, 22);
      playBlast(sfx);
    } else if (e.type === "throw") {
      playBeep(sfx, false);
    } else if (e.type === "pickup") {
      feedLine(hud, `${e.fighter.name} picked up the Igniter.`, "pal");
    } else if (e.type === "carrier") {
      feedLine(hud, `${e.fighter.name} carries the Igniter now.`, "pal");
    } else if (e.type === "buyphase") {
      toast(hud, `Round ${e.round} — buy phase (B to shop).`);
    } else if (e.type === "live") {
      toast(hud, "Round live — plant the Igniter at the Reactor.");
    }
  }
  sim.events.length = 0;
}

// --- Per-frame state -> scene.
function syncScene() {
  const p = sim.player;
  camera.position.set(p.x, (p.y ?? 0) + eyeHeight(p), p.z);
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;
  const targetFov = aiming ? 74 / WEAPONS[p.weapon].zoom : 74;
  camera.fov += (targetFov - camera.fov) * 0.2;
  camera.updateProjectionMatrix();
  vm.visible = p.alive;
  vm.position.z = -0.5 + p.recoil * 0.06;
  vm.rotation.x = p.recoil * 0.12;
  for (const f of sim.fighters) {
    if (f === p) continue;
    const g = meshes.get(f.id);
    if (!g) continue;
    g.position.set(f.x, f.y ?? 0, f.z);
    if (!f.alive) {
      g.rotation.set(Math.PI / 2, f.yaw, 0);
      g.position.y = 0.25;
    } else {
      g.rotation.set(0, f.yaw, 0);
    }
  }
  const core = sim.match.core;
  if (core.state === "planted" || core.state === "dropped") {
    coreMesh.visible = true;
    coreMesh.position.set(core.x, 0.35, core.z);
    coreLight.visible = true;
    coreLight.position.set(core.x, 1.5, core.z);
    coreLight.intensity = core.state === "planted" ? 10 + Math.sin(sim.time * 8) * 6 : 6;
  } else {
    coreMesh.visible = false;
    coreLight.visible = false;
  }
  // Plant prompt and progress.
  const inSite = p.x > MAP.site.x0 && p.x < MAP.site.x1 && p.z > MAP.site.z0 && p.z < MAP.site.z1;
  if (sim.match.phase === "live" && p.alive && core.state === "carried" && core.carrier === "player") {
    if (inSite) {
      showPrompt(hud, "Hold E to plant the Igniter");
      if (core.progress > 0) showPlant(hud, "PLANTING IGNITER", core.progress / CFG.plantTime);
      else hidePlant(hud);
    } else {
      showPrompt(hud, "Carry the Igniter to the Reactor site (north)");
      hidePlant(hud);
    }
  } else if (core.state === "planted") {
    showPlant(hud, `IGNITER — ${Math.max(0, Math.ceil(core.fuse))}s TO DETONATION`, 1 - core.fuse / CFG.fuseTime);
    hidePrompt(hud);
  } else {
    hidePrompt(hud);
    hidePlant(hud);
  }
  // Flash overlay while the player is blinded.
  if (sim.time < p.flashUntil) {
    flashWhite(hud, 0.8);
  }
  // Footsteps.
  if (p.moving && p.alive) {
    stepAcc += 0.016;
    if (stepAcc > 0.42) {
      stepAcc = 0;
      playStep(sfx);
    }
  }
}

// --- Main loop.
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!staged && sim.match.phase !== "menu") {
    const p = sim.player;
    const def = WEAPONS[p.weapon];
    const input = {
      fwd: (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
      strafe: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
      jump: keys.has("Space"),
      crouch: keys.has("ControlLeft") || keys.has("KeyC"),
      walk: keys.has("ShiftLeft") || keys.has("ShiftRight"),
      fire: fireHeld && (def.auto ? true : fireEdge),
      reload: reloadEdge,
      grenade: grenadeEdge,
      plant: keys.has("KeyE"),
    };
    stepFixed(sim, input, dt);
    fireEdge = false;
    reloadEdge = false;
    grenadeEdge = null;
    drainEvents();
  }
  updateFx(fx, dt, sim.time);
  syncScene();
  updateHud(hud, sim);
  renderer.render(scene, camera);
}

// --- Start.
if (staged) {
  document.getElementById("menu").style.display = "none";
  startMatch(sim);
  const stagedFx = applyShot(sim, shot);
  if (stagedFx.tracer) {
    spawnTracer(fx, stagedFx.tracer.from, stagedFx.tracer.to, 1e9);
  }
  if (stagedFx.sparks) {
    spawnSparks(fx, stagedFx.sparks.x, stagedFx.sparks.y, stagedFx.sparks.z, 14);
  }
  if (stagedFx.smoke) {
    spawnSmoke(fx, stagedFx.smoke.x, stagedFx.smoke.y, stagedFx.smoke.z);
    fx.smokes[fx.smokes.length - 1].life = 1e9;
  }
  if (stagedFx.banner) {
    showBanner(hud, stagedFx.banner.big, stagedFx.banner.sub, stagedFx.banner.color);
  }
  if (stagedFx.buy) {
    openBuy(hud);
  }
  updateHud(hud, sim);
  syncScene();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
