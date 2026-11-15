// fx.js — visual effects: tracers, muzzle flash, impact sparks, smoke puffs,
// the Igniter blast. One job: show what the simulation did. Everything here
// is pooled and reused: no new objects are made in the hot loop.

import * as THREE from "three";

const TRACERS = 24;
const SPARKS = 240;

function puffTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, "rgba(200,200,200,0.85)");
  grad.addColorStop(0.6, "rgba(170,170,170,0.45)");
  grad.addColorStop(1, "rgba(160,160,160,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createFx(scene) {
  const fx = { scene, tracers: [], sparks: null, sparkData: [], smokes: [], flash: null, blast: null };
  // Tracer pool: one Line per tracer, reused.
  for (let i = 0; i < TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    fx.tracers.push({ line, until: 0 });
  }
  // Spark pool: one Points cloud, positions updated in place.
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
  const sm = new THREE.PointsMaterial({ color: 0xffb454, size: 0.09, transparent: true, opacity: 0.95 });
  const points = new THREE.Points(sg, sm);
  points.frustumCulled = false;
  scene.add(points);
  fx.sparks = points;
  for (let i = 0; i < SPARKS; i++) {
    fx.sparkData.push({ life: 0, vx: 0, vy: 0, vz: 0 });
  }
  // Muzzle flash: a small additive plane at the gun tip.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  scene.add(flash);
  fx.flash = flash;
  // Blast sphere for the Igniter detonation.
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  scene.add(blast);
  fx.blast = blast;
  fx.blastLife = 0;
  fx.puffTex = puffTexture();
  return fx;
}

export function spawnTracer(fx, from, to, until) {
  const slot = fx.tracers.find((t) => t.until <= 0) ?? fx.tracers[0];
  const pos = slot.line.geometry.attributes.position.array;
  pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
  pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
  slot.line.geometry.attributes.position.needsUpdate = true;
  slot.line.material.opacity = 0.9;
  slot.until = until;
}

export function spawnSparks(fx, x, y, z, n) {
  let placed = 0;
  for (let i = 0; i < SPARKS && placed < n; i++) {
    const s = fx.sparkData[i];
    if (s.life > 0) continue;
    s.life = 0.35 + Math.random() * 0.3;
    s.vx = (Math.random() - 0.5) * 7;
    s.vy = Math.random() * 5 + 1;
    s.vz = (Math.random() - 0.5) * 7;
    const pos = fx.sparks.geometry.attributes.position.array;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    placed += 1;
  }
  fx.sparks.geometry.attributes.position.needsUpdate = true;
}

export function showFlash(fx, x, y, z) {
  fx.flash.position.set(x, y, z);
  fx.flash.material.opacity = 0.95;
  fx.flashLife = 0.06;
}

export function spawnSmoke(fx, x, y, z) {
  const mat = new THREE.SpriteMaterial({ map: fx.puffTex, transparent: true, opacity: 0.8, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  sprite.scale.set(3, 3, 1);
  fx.scene.add(sprite);
  fx.smokes.push({ sprite, life: 14, grow: 0 });
}

export function spawnBlast(fx, x, y, z) {
  fx.blast.position.set(x, y, z);
  fx.blastLife = 0.9;
}

export function updateFx(fx, dt, time) {
  for (const t of fx.tracers) {
    if (t.until > 0 && time > t.until) {
      t.until = 0;
      t.line.material.opacity = 0;
    }
  }
  const pos = fx.sparks.geometry.attributes.position.array;
  for (let i = 0; i < SPARKS; i++) {
    const s = fx.sparkData[i];
    if (s.life <= 0) continue;
    s.life -= dt;
    s.vy -= 12 * dt;
    pos[i * 3] += s.vx * dt;
    pos[i * 3 + 1] += s.vy * dt;
    pos[i * 3 + 2] += s.vz * dt;
    if (pos[i * 3 + 1] < 0.03) pos[i * 3 + 1] = 0.03;
  }
  fx.sparks.geometry.attributes.position.needsUpdate = true;
  if (fx.flashLife > 0) {
    fx.flashLife -= dt;
    fx.flash.material.opacity = Math.max(0, fx.flashLife / 0.06) * 0.95;
  }
  for (let i = fx.smokes.length - 1; i >= 0; i--) {
    const s = fx.smokes[i];
    s.life -= dt;
    s.grow += dt;
    const sc = 3 + s.grow * 0.9;
    s.sprite.scale.set(sc, sc, 1);
    s.sprite.material.opacity = Math.max(0, Math.min(0.8, s.life / 4));
    if (s.life <= 0) {
      fx.scene.remove(s.sprite);
      s.sprite.material.dispose();
      fx.smokes.splice(i, 1);
    }
  }
  if (fx.blastLife > 0) {
    fx.blastLife -= dt;
    const k = 1 - fx.blastLife / 0.9;
    const r = 1 + k * 16;
    fx.blast.scale.set(r, r, r);
    fx.blast.material.opacity = Math.max(0, 0.85 * (1 - k));
  }
}
