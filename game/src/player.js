// player.js — first-person movement: acceleration, friction, crouch, AABB
// collision, and pointer-lock mouse look. One job: turn input into a pose.

import { collide, MAP } from './world.js';

const WALK_SPEED = 4.4;
const CROUCH_SPEED = 2.1;
const SLOW_SPEED = 2.3; // Shift: slow-walk, the accurate stance
const ACCEL = 9;
const FRICTION = 11;
const RADIUS = 0.38;

export function applyLook(p, dx, dy) {
  p.yaw -= dx * 0.0021;
  p.pitch -= dy * 0.0021;
  const lim = Math.PI / 2 - 0.02;
  if (p.pitch > lim) p.pitch = lim;
  if (p.pitch < -lim) p.pitch = -lim;
  // Recoil recovery: the pitch kick eases back toward the aim point.
  p.pitch += p.recoilPitch;
  p.recoilPitch *= 0.86;
}

export function stepPlayer(S, dt) {
  const p = S.player;
  if (!p.alive) return;
  const k = S.keys;
  p.crouch = !!(k['KeyC'] || k['ControlLeft']);
  const slow = !!k['ShiftLeft'] || !!k['ShiftRight'];

  let ix = 0, iz = 0;
  if (k['KeyW'] || k['ArrowUp']) iz -= 1;
  if (k['KeyS'] || k['ArrowDown']) iz += 1;
  if (k['KeyA'] || k['ArrowLeft']) ix -= 1;
  if (k['KeyD'] || k['ArrowRight']) ix += 1;
  const len = Math.hypot(ix, iz);
  if (len > 0) { ix /= len; iz /= len; }

  const top = p.crouch ? CROUCH_SPEED : slow ? SLOW_SPEED : WALK_SPEED;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // Forward is -z rotated by yaw; strafe is perpendicular.
  const fwdX = -sin, fwdZ = -cos;
  const rightX = cos, rightZ = -sin;
  const tx = (fwdX * -iz + rightX * ix) * top;
  const tz = (fwdZ * -iz + rightZ * ix) * top;

  // Acceleration toward the target velocity; friction when no input.
  const rate = len > 0 ? ACCEL : FRICTION;
  const blend = Math.min(1, rate * dt);
  p.vel.x += (tx - p.vel.x) * blend;
  p.vel.z += (tz - p.vel.z) * blend;

  const nx = p.pos.x + p.vel.x * dt;
  const nz = p.pos.z + p.vel.z * dt;
  const eyeY = p.crouch ? 1.05 : 1.62;
  const hit = collide(S.solids, nx, nz, RADIUS, eyeY);
  p.pos.x = Math.max(-MAP.halfX + 0.6, Math.min(MAP.halfX - 0.6, hit.x));
  p.pos.z = Math.max(-MAP.halfZ + 0.6, Math.min(MAP.halfZ - 0.6, hit.z));
  p.speed2d = Math.hypot(p.vel.x, p.vel.z);
  p.moving = p.speed2d > 0.6;
  p.spreadBloom = Math.max(0, p.spreadBloom - dt * 1.8);
}
