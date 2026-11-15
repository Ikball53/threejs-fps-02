// arms.js — weapons and grenades: firing, spread, recoil, reload, damage
// falloff, headshots, and thrown grenades. One job: resolve a trigger pull
// (or a bot's shot) into hits, without knowing anything about the HUD or
// the round flow.

import { WEAPONS, GRENADES } from "./state.js";
import { bodyRadius } from "./mover.js";

// Ray vs a vertical body capsule: chest segment plus a head sphere.
// Returns { dist, part } or null. All positions are world space.
function rayFighter(ox, oy, oz, dx, dy, dz, f) {
  const baseY = (f.y ?? 0);
  let best = null;
  // Head sphere at eye level minus a touch.
  const hx = f.x;
  const hy = baseY + 1.52;
  const hz = f.z;
  const hr = 0.24;
  const toH = [hx - ox, hy - oy, hz - oz];
  const tH = toH[0] * dx + toH[1] * dy + toH[2] * dz;
  if (tH > 0) {
    const px = ox + dx * tH;
    const py = oy + dy * tH;
    const pz = oz + dz * tH;
    const d2 = (px - hx) * (px - hx) + (py - hy) * (py - hy) + (pz - hz) * (pz - hz);
    if (d2 < hr * hr) {
      const t = tH - Math.sqrt(hr * hr - d2);
      if (t > 0) best = { dist: t, part: "head" };
    }
  }
  // Body: closest approach of the ray to the chest segment.
  const ax = f.x;
  const az = f.z;
  const ay0 = baseY + 0.25;
  const ay1 = baseY + 1.32;
  const r = bodyRadius();
  const ux = dx;
  const uz = dz;
  const wx = ax - ox;
  const wz = az - oz;
  const denom = ux * ux + uz * uz;
  let t = denom > 1e-9 ? (wx * ux + wz * uz) / denom : 0;
  t = Math.max(0, t);
  const cx = ox + ux * t;
  const cz = oz + uz * t;
  const cy = oy + dy * t;
  const rr = (cx - ax) * (cx - ax) + (cz - az) * (cz - az);
  if (rr < r * r && cy > ay0 - 0.15 && cy < ay1 + 0.15) {
    const hit = t - Math.sqrt(Math.max(0, r * r - rr));
    if (hit > 0 && (!best || hit < best.dist)) best = { dist: hit, part: "body" };
  }
  return best;
}

function rayWall(ox, oy, oz, dx, dy, dz, blocks) {
  // Walls are vertical boxes; a shot stops at the first box face it enters.
  let best = Infinity;
  for (const b of blocks) {
    if (b[4] < 0.9) continue;
    const [x0, z0, x1, z1, h] = b;
    let tmin = 0;
    let tmax = Infinity;
    const axes = [
      [dx, ox, x0, x1],
      [dz, oz, z0, z1],
    ];
    let ok = true;
    for (const [d, o, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { ok = false; break; }
      } else {
        let a = (lo - o) / d;
        let bb = (hi - o) / d;
        if (a > bb) { const t = a; a = bb; bb = t; }
        if (a > tmin) tmin = a;
        if (bb < tmax) tmax = bb;
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (!ok) continue;
    const yAt = oy + dy * tmin;
    if (yAt < 0 || yAt > h) continue;
    if (tmin > 0 && tmin < best) best = tmin;
  }
  return best;
}

// Fire one trigger pull from shooter toward (dx,dy,dz) (already normalized).
// Returns a shot record { hit, part, dist, point, pellets } or null when the
// magazine is empty or the weapon is still cycling.
export function fireShot(shooter, dir, origin, fighters, blocks, time) {
  const def = WEAPONS[shooter.weapon];
  const bag = shooter.ammo[shooter.weapon];
  if (!bag || bag.mag <= 0) return null;
  if (time - shooter.lastShot < def.rate) return null;
  if (shooter.reloading) return null;
  shooter.lastShot = time;
  bag.mag -= 1;
  shooter.recoil = Math.min(1, shooter.recoil + def.recoil);
  const pellets = def.pellets ?? 1;
  const spread = def.spread + (shooter.moving ? def.moveSpread : 0) + shooter.recoil * 0.03;
  let bestHit = null;
  for (let p = 0; p < pellets; p++) {
    const sx = dir.x + (Math.random() - 0.5) * 2 * spread;
    const sy = dir.y + (Math.random() - 0.5) * 2 * spread;
    const sz = dir.z + (Math.random() - 0.5) * 2 * spread;
    const len = Math.hypot(sx, sy, sz) || 1;
    const d = { x: sx / len, y: sy / len, z: sz / len };
    const wallDist = rayWall(origin.x, origin.y, origin.z, d.x, d.y, d.z, blocks);
    let hit = null;
    for (const f of fighters) {
      if (f === shooter || !f.alive) continue;
      const r = rayFighter(origin.x, origin.y, origin.z, d.x, d.y, d.z, f);
      if (r && r.dist < wallDist && (!hit || r.dist < hit.dist)) {
        hit = { fighter: f, part: r.part, dist: r.dist };
      }
    }
    if (hit && (!bestHit || hit.dist < bestHit.dist)) bestHit = hit;
    // Record the wall point for tracers even on a miss.
    if (!bestHit) {
      bestHit = { fighter: null, part: "wall", dist: Math.min(wallDist, def.range), wall: true };
    }
  }
  if (bestHit) {
    const falloff = Math.max(0.45, 1 - (bestHit.dist / def.range) * 0.55);
    const base = def.damage * falloff * (bestHit.part === "head" ? def.headMult : 1);
    bestHit.damage = Math.round(base);
    bestHit.point = {
      x: origin.x + dir.x * bestHit.dist,
      y: origin.y + dir.y * bestHit.dist,
      z: origin.z + dir.z * bestHit.dist,
    };
  }
  return bestHit;
}

export function startReload(shooter, time) {
  const def = WEAPONS[shooter.weapon];
  const bag = shooter.ammo[shooter.weapon];
  if (!bag || shooter.reloading || bag.mag >= def.mag || bag.reserve <= 0) return false;
  shooter.reloading = true;
  shooter.reloadUntil = time + def.reload;
  return true;
}

export function finishReload(shooter) {
  const def = WEAPONS[shooter.weapon];
  const bag = shooter.ammo[shooter.weapon];
  if (!bag) return;
  const need = def.mag - bag.mag;
  const take = Math.min(need, bag.reserve);
  bag.mag += take;
  bag.reserve -= take;
  shooter.reloading = false;
}

export function buyWeapon(shooter, key, money) {
  const def = WEAPONS[key];
  if (!def || money < def.price) return money;
  if (shooter.weapon === key) return money; // already held
  shooter.weapon = key;
  shooter.ammo[key] = { mag: def.mag, reserve: def.reserve };
  shooter.reloading = false;
  return money - def.price;
}

export function throwGrenade(shooter, kind, origin, dir) {
  const def = GRENADES[kind];
  if (!def || (shooter.nades[kind] ?? 0) <= 0) return null;
  shooter.nades[kind] -= 1;
  return {
    kind,
    x: origin.x, y: origin.y, z: origin.z,
    vx: dir.x * 14, vy: dir.y * 14 + 3.5, vz: dir.z * 14,
    fuse: def.fuse, owner: shooter,
  };
}

// Step thrown grenades: gravity, ground and wall bounces, fuse expiry.
// Calls onBurst(proj) when one goes off; returns nothing.
export function stepGrenades(list, dt, blocks, onBurst) {
  for (let i = list.length - 1; i >= 0; i--) {
    const g = list[i];
    g.vy -= 16 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.15) {
      g.y = 0.15;
      g.vy = Math.abs(g.vy) * 0.35;
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    for (const b of blocks) {
      if (b[4] < 0.9) continue;
      if (g.x > b[0] && g.x < b[2] && g.z > b[1] && g.z < b[3] && g.y < b[4]) {
        // Simple bounce: push out along the smallest penetration axis.
        const dxl = Math.min(g.x - b[0], b[2] - g.x);
        const dzl = Math.min(g.z - b[1], b[3] - g.z);
        if (dxl < dzl) g.vx = -g.vx * 0.5;
        else g.vz = -g.vz * 0.5;
        g.x += g.vx * dt * 2;
        g.z += g.vz * dt * 2;
      }
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      list.splice(i, 1);
      onBurst(g);
    }
  }
}
