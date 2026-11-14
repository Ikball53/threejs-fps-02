// bots.js — Warden bot AI: patrol waypoints, hold angles, investigate sounds,
// engage on sight, and rush the site to defuse once the charge is planted.
// Bots are plain data; their three.js meshes live in main.js (bot.mesh).

import { losBlocked, collide } from './world.js';

const BOT_SPEED = 3.1;
const BOT_NAMES = ['Vex', 'Marrow', 'Quill', 'Sable'];
const HOLD_SPOTS = [
  { x: 14, z: -4 }, { x: 8, z: -12 }, { x: -4, z: -2 }, { x: 13, z: -15 },
];
const BOT_HP = 100;

export function spawnBots(S) {
  S.bots = [];
  for (let i = 0; i < 4; i++) {
    const spot = HOLD_SPOTS[i];
    S.bots.push({
      id: i, name: BOT_NAMES[i], alive: true, hp: BOT_HP,
      pos: { x: spot.x + (Math.random() - 0.5), z: spot.z + (Math.random() - 0.5) },
      vel: { x: 0, z: 0 },
      yaw: Math.random() * Math.PI * 2,
      state: 'hold', // hold | patrol | investigate | engage | defuse | plant-guard
      wp: i % S.waypoints.length,
      holdUntil: S.time + 4 + i * 2,
      target: null,
      burstLeft: 0,
      fireTimer: 0.5 + i * 0.3,
      aimError: 0,
      heard: null,
      seenAt: -99,
      lastPos: { x: spot.x, z: spot.z },
      stuckAt: 0,
      mesh: null,
    });
  }
}

function canSee(S, b) {
  const p = S.player;
  if (!p.alive) return false;
  const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 42) return false;
  // Crouching behind low cover is harder to spot at range.
  if (p.crouch && d > 18) return false;
  if (losBlocked(S.solids, b.pos.x, b.pos.z, p.pos.x, p.pos.z, 1.5)) return false;
  // Field of view: bots notice movement in front of them, or anything close.
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  const dot = (dx * fx + dz * fz) / Math.max(d, 0.001);
  if (d > 6 && dot < 0.35 && p.speed2d < 1) return false;
  return true;
}

function moveToward(S, b, tx, tz, dt, speed) {
  const dx = tx - b.pos.x, dz = tz - b.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  const vx = dx / d * speed, vz = dz / d * speed;
  b.vel.x += (vx - b.vel.x) * Math.min(1, 8 * dt);
  b.vel.z += (vz - b.vel.z) * Math.min(1, 8 * dt);
  const hit = collide(S.solids, b.pos.x + b.vel.x * dt, b.pos.z + b.vel.z * dt, 0.38, 1.5);
  b.pos.x = hit.x; b.pos.z = hit.z;
  b.yaw = Math.atan2(b.vel.x, b.vel.z);
  return d < 0.6;
}

function nearestWp(S, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < S.waypoints.length; i++) {
    const w = S.waypoints[i];
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function routeStep(S, b, tx, tz, dt) {
  // Walk the waypoint graph toward the target, then straight to it.
  const goal = nearestWp(S, tx, tz);
  const cur = nearestWp(S, b.pos.x, b.pos.z);
  let next = null;
  if (cur === goal) next = { x: tx, z: tz };
  else {
    // Greedy: pick the linked waypoint closest to the goal.
    let best = null, bd = Infinity;
    for (const li of S.waypoints[cur].links) {
      const w = S.waypoints[li];
      const d = (w.x - tx) ** 2 + (w.z - tz) ** 2;
      if (d < bd) { bd = d; best = w; }
    }
    next = best || { x: tx, z: tz };
  }
  return moveToward(S, b, next.x, next.z, dt, BOT_SPEED);
}

export function stepBots(S, dt, events) {
  const p = S.player;
  for (const b of S.bots) {
    if (!b.alive) continue;
    const seen = canSee(S, b);
    if (seen) { b.seenAt = S.time; b.target = { x: p.pos.x, z: p.pos.z }; }

    // State picks: defuse beats everything once the charge is live.
    if (S.bombPlanted) b.state = 'defuse';
    else if (seen) b.state = 'engage';
    else if (b.state === 'engage' && S.time - b.seenAt > 3) b.state = 'investigate';
    else if (b.state === 'investigate' && b.target && Math.hypot(b.target.x - b.pos.x, b.target.z - b.pos.z) < 1.2) b.state = 'patrol';
    else if (b.heard && S.time - b.heard.at < 6 && b.state !== 'engage') b.state = 'investigate';
    else if (b.state === 'hold' && S.time > b.holdUntil) b.state = 'patrol';

    if (b.state === 'hold') {
      b.vel.x *= 0.9; b.vel.z *= 0.9;
      // Slow scan: sweep the yaw across the lane.
      b.yaw += Math.sin(S.time * 0.5 + b.id * 1.7) * 0.35 * dt;
    } else if (b.state === 'patrol') {
      const wp = S.waypoints[b.wp];
      if (moveToward(S, b, wp.x, wp.z, dt, BOT_SPEED * 0.8)) {
        const links = S.waypoints[b.wp].links;
        b.wp = links[Math.floor(Math.random() * links.length)];
        b.state = 'hold';
        b.holdUntil = S.time + 3 + Math.random() * 4;
      }
    } else if (b.state === 'investigate') {
      const t = b.heard && S.time - b.heard.at < 6 ? b.heard : b.target;
      if (t) {
        if (routeStep(S, b, t.x, t.z, dt)) { b.heard = null; b.target = null; b.state = 'patrol'; }
      } else b.state = 'patrol';
    } else if (b.state === 'engage') {
      const d = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
      if (d > 9) routeStep(S, b, p.pos.x, p.pos.z, dt);
      else { b.vel.x *= 0.85; b.vel.z *= 0.85; }
      // Face the player and fire in bursts.
      b.yaw = Math.atan2(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
      b.fireTimer -= dt;
      if (b.fireTimer <= 0 && seen) {
        if (b.burstLeft <= 0) { b.burstLeft = 3 + Math.floor(Math.random() * 3); b.fireTimer = 0.55 + Math.random() * 0.5; }
        else {
          b.burstLeft -= 1;
          b.fireTimer = 0.13;
          events.botShot(b, p, d);
        }
      }
    } else if (b.state === 'defuse') {
      // Rush the site; on arrival, channel the defuse.
      const dSite = Math.hypot(S.bombPos.x - b.pos.x, S.bombPos.z - b.pos.z);
      if (dSite > 1.2) routeStep(S, b, S.bombPos.x, S.bombPos.z, dt);
      else events.botDefusing(b, dt);
    }

    // Stuck detection: if barely moved while trying to walk, pick a new waypoint.
    const moved = Math.hypot(b.pos.x - b.lastPos.x, b.pos.z - b.lastPos.z);
    if (moved < 0.02 && (b.state === 'patrol' || b.state === 'investigate' || b.state === 'defuse')) {
      b.stuckAt += dt;
      if (b.stuckAt > 1.2) { b.wp = (b.wp + 3) % S.waypoints.length; b.stuckAt = 0; b.state = 'patrol'; }
    } else b.stuckAt = 0;
    b.lastPos.x = b.pos.x; b.lastPos.z = b.pos.z;
  }
}
