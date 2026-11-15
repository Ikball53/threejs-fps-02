// mover.js — movement physics: acceleration, friction, crouch, jump and
// collision against the map's solid boxes. One job: turn a fighter's intent
// (forward/strafe keys, yaw) into a new position without ever clipping a wall.

import { BLOCKS, MAP } from "./map.js";
import { CFG } from "./state.js";

const RADIUS = 0.42; // fighter capsule half-width on the ground plane
const HEIGHT = 1.78;

function blockedAt(x, z) {
  if (x < MAP.minX + RADIUS || x > MAP.maxX - RADIUS) return true;
  if (z < MAP.minZ + RADIUS || z > MAP.maxZ - RADIUS) return true;
  for (const b of BLOCKS) {
    if (b[4] < 0.9) continue; // low crates do not block a standing fighter
    if (x > b[0] - RADIUS && x < b[2] + RADIUS && z > b[1] - RADIUS && z < b[3] + RADIUS) return true;
  }
  return false;
}

// Move a fighter by (dx, dz) with per-axis resolution so it slides along walls.
export function slideMove(f, dx, dz) {
  const nx = f.x + dx;
  if (!blockedAt(nx, f.z)) f.x = nx;
  const nz = f.z + dz;
  if (!blockedAt(f.x, nz)) f.z = nz;
}

export function stepFighter(f, input, dt) {
  // input: { fwd, strafe, jump, crouch, walk } in -1..1 / booleans.
  const speed = input.crouch
    ? CFG.crouchSpeed
    : input.walk
      ? CFG.walkSpeed
      : CFG.playerSpeed;
  const sin = Math.sin(f.yaw);
  const cos = Math.cos(f.yaw);
  // Forward is -Z rotated by yaw; strafe is perpendicular.
  const wishX = (-sin * input.fwd + cos * input.strafe) * speed;
  const wishZ = (-cos * input.fwd - sin * input.strafe) * speed;
  const accel = f.grounded ? 14 : 5;
  f.vx += (wishX - f.vx) * Math.min(1, accel * dt);
  f.vz += (wishZ - f.vz) * Math.min(1, accel * dt);
  slideMove(f, f.vx * dt, f.vz * dt);
  f.moving = Math.abs(f.vx) + Math.abs(f.vz) > 0.6;
  f.crouched = !!input.crouch;
  // Vertical: jump + gravity, ground is y = 0.
  if (input.jump && f.grounded) {
    f.vy = CFG.jumpSpeed;
    f.grounded = false;
  }
  f.vy -= CFG.gravity * dt;
  f.y = (f.y ?? 0) + f.vy * dt;
  if (f.y <= 0) {
    f.y = 0;
    f.vy = 0;
    f.grounded = true;
  }
}

export function eyeHeight(f) {
  const base = f.crouched ? CFG.crouchEye : CFG.eyeHeight;
  return base + (f.y ?? 0);
}

export function bodyRadius() {
  return RADIUS;
}

export function bodyHeight() {
  return HEIGHT;
}
