// weapons.js — firing, reload, recoil/spread, raycast hits with headshots,
// grenade throws, tracers and impact sparks. Pure simulation; rendering
// of tracers lives in main.js, which reads S.tracers / S.flashes.

import * as THREE from 'three';
import { WEAPONS } from './state.js';
import { rayHitWall, eyePos } from './world.js';
import { sfx } from './audio.js';

const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();

function aimDir(p) {
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  _dir.set(-sy * cp, sp, -cy * cp);
  return _dir;
}

function spreadFor(S) {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  const move = p.moving ? w.moveSpread : 0;
  const air = p.crouch ? -0.002 : 0;
  return w.spread + move + p.spreadBloom + air;
}

// Ray vs a bot's body capsule (cylinder) + head sphere. Returns {bot, dist, head}.
function rayHitBot(ox, oy, oz, dx, dy, dz, maxDist, bots) {
  let best = null;
  for (let i = 0; i < bots.length; i++) {
    const b = bots[i];
    if (!b.alive) continue;
    // Head sphere at y 1.55, radius 0.22
    const hx = b.pos.x - ox, hy = 1.55 - oy, hz = b.pos.z - oz;
    const th = hx * dx + hy * dy + hz * dz;
    if (th > 0 && th < maxDist) {
      const cx = ox + dx * th, cy = oy + dy * th, cz = oz + dz * th;
      const dd = (cx - b.pos.x) ** 2 + (cy - 1.55) ** 2 + (cz - b.pos.z) ** 2;
      if (dd < 0.22 * 0.22 && (!best || th < best.dist)) best = { bot: b, dist: th, head: true };
    }
    // Body: vertical segment y 0..1.35, radius 0.42
    const px = b.pos.x - ox, pz = b.pos.z - oz;
    const denom = dx * dx + dz * dz;
    if (denom < 1e-9) continue;
    const t = (px * dx + pz * dz) / denom;
    if (t <= 0 || t >= maxDist) continue;
    const cx = ox + dx * t - b.pos.x, cz = oz + dz * t - b.pos.z;
    if (cx * cx + cz * cz > 0.42 * 0.42) continue;
    const yAt = oy + dy * t;
    if (yAt < 0 || yAt > 1.35) continue;
    if (!best || t < best.dist) best = { bot: b, dist: t, head: false };
  }
  return best;
}

export function tryFire(S, scene, onHit) {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  const st = p.weapons[p.weapon];
  if (!p.alive || p.reloading > 0 || p.fireCooldown > 0) return;
  if (S.phase !== 'live' && S.phase !== 'planted') return;
  if (st.mag <= 0) { sfx.dryFire(); p.fireCooldown = 0.25; return; }

  if (p.weapon === 'grenade') { throwGrenade(S); return; }

  st.mag -= 1;
  p.fireCooldown = w.fireMs / 1000;
  p.lastShotAt = S.time;
  p.spreadBloom = Math.min(0.05, p.spreadBloom + (p.weapon === 'rifle' ? 0.008 : 0.005));
  p.recoilPitch += w.recoil * (p.moving ? 1.6 : 1);

  const eye = eyePos(p);
  _eye.copy(eye);
  const dir = aimDir(p);
  const sp = spreadFor(S);
  const dx = dir.x + (Math.random() - 0.5) * 2 * sp;
  const dy = dir.y + (Math.random() - 0.5) * 2 * sp;
  const dz = dir.z + (Math.random() - 0.5) * 2 * sp;
  const dl = Math.hypot(dx, dy, dz);
  const ndx = dx / dl, ndy = dy / dl, ndz = dz / dl;

  const wallDist = rayHitWall(S.solids, _eye.x, _eye.y, _eye.z, ndx, ndy, ndz, w.range);
  const hit = rayHitBot(_eye.x, _eye.y, _eye.z, ndx, ndy, ndz, Math.min(wallDist, w.range), S.bots);
  const endDist = hit ? hit.dist : Math.min(wallDist, w.range);
  S.tracers.push({
    x0: _eye.x, y0: _eye.y - 0.12, z0: _eye.z,
    x1: _eye.x + ndx * endDist, y1: _eye.y + ndy * endDist, z1: _eye.z + ndz * endDist,
    life: 0.07, max: 0.07, color: w.tracer,
  });
  sfx.shot(p.weapon);
  // Every shot is a sound bots can hear.
  for (const b of S.bots) if (b.alive) b.heard = { x: p.pos.x, z: p.pos.z, at: S.time };

  if (hit) {
    const dmg = w.damage * (hit.head ? w.headMult : 1);
    onHit(hit.bot, dmg, hit.head, _eye.x + ndx * hit.dist, 1.55, _eye.z + ndz * hit.dist);
  } else if (wallDist < w.range) {
    S.flashes.push({ x: _eye.x + ndx * wallDist, y: _eye.y + ndy * wallDist, z: _eye.z + ndz * wallDist, life: 0.25, max: 0.25 });
  }
}

export function startReload(S) {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  const st = p.weapons[p.weapon];
  if (p.reloading > 0 || st.mag >= w.mag || st.reserve <= 0 || p.weapon === 'grenade') return;
  p.reloading = w.reloadMs / 1000;
  sfx.reload();
}

export function stepReload(S, dt) {
  const p = S.player;
  if (p.reloading <= 0) return;
  p.reloading -= dt;
  if (p.reloading > 0) return;
  const w = WEAPONS[p.weapon];
  const st = p.weapons[p.weapon];
  const need = w.mag - st.mag;
  const take = Math.min(need, st.reserve);
  st.mag += take; st.reserve -= take;
  p.reloading = 0;
}

export function switchWeapon(S, id) {
  const p = S.player;
  if (!p.weapons[id] || !p.weapons[id].owned) return;
  if (p.weapon === id || p.reloading > 0) return;
  p.weapon = id;
  p.fireCooldown = Math.max(p.fireCooldown, 0.15);
  sfx.click();
}

function throwGrenade(S) {
  const p = S.player;
  const st = p.weapons.grenade;
  st.mag -= 1;
  if (st.mag <= 0 && st.reserve > 0) { st.reserve -= 1; st.mag = 1; }
  p.fireCooldown = WEAPONS.grenade.fireMs / 1000;
  p.lastShotAt = S.time;
  const eye = eyePos(p);
  const dir = aimDir(p);
  S.grenades.push({
    x: eye.x, y: eye.y - 0.1, z: eye.z,
    vx: dir.x * 16 + p.vel.x, vy: dir.y * 16 + 3.2, vz: dir.z * 16 + p.vel.z,
    fuse: WEAPONS.grenade.fuse, alive: true,
  });
  sfx.click();
  for (const b of S.bots) if (b.alive) b.heard = { x: p.pos.x, z: p.pos.z, at: S.time };
}

export function stepGrenades(S, dt, onBlast) {
  for (const g of S.grenades) {
    if (!g.alive) continue;
    g.vy -= 12 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.15) { g.y = 0.15; g.vy *= -0.35; g.vx *= 0.7; g.vz *= 0.7; }
    if (g.x < -23.5 || g.x > 23.5) g.vx *= -0.4;
    if (g.z < -17.5 || g.z > 17.5) g.vz *= -0.4;
    g.fuse -= dt;
    if (g.fuse <= 0) { g.alive = false; onBlast(g); }
  }
  S.grenades = S.grenades.filter((g) => g.alive);
}

export function blastDamage(S, g, onHitBot) {
  const R = WEAPONS.grenade.blastRadius;
  sfx.grenade();
  S.flashes.push({ x: g.x, y: 0.6, z: g.z, life: 0.5, max: 0.5, big: true });
  const p = S.player;
  const pd = Math.hypot(p.pos.x - g.x, p.pos.z - g.z);
  if (pd < R && p.alive) {
    const dmg = WEAPONS.grenade.damage * (1 - pd / R * 0.6);
    onHitBot(null, dmg, false, p.pos.x, 1.2, p.pos.z, true);
  }
  for (const b of S.bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - g.x, b.pos.z - g.z);
    if (d < R) onHitBot(b, WEAPONS.grenade.damage * (1 - d / R * 0.6), false, b.pos.x, 1.0, b.pos.z, true);
  }
}
