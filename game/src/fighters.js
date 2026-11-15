// Fighters: the humanoid combatants and the bot brain.
//
// A fighter is a detailed humanoid figure built from simple parts — torso
// with a vest, a helmeted head with a glowing visor, arms that hold a
// weapon, legs that walk — coloured by team, never a cone or a sphere on
// its own. Bots are fighters with a brain: a role, a plan, senses, and a
// trigger finger.
//
// The brain runs at 10 Hz on top of the fixed-step simulation. It decides
// what to do (rush a site, hold an angle, plant, defuse, investigate a
// sound, fall back) and steers the fighter along A* paths with smoothed
// corners. It sees through a field of view, a distance limit, a line of
// sight, and smoke: a sight line that crosses a smoke cloud sees nothing,
// and a flashed bot sees nothing at all for a while.

import * as THREE from 'three';
import { findPath, hasLineOfSight, segmentBlocked, groundHeight, circleHitsSolid, SITES } from './arena.js';
import { clamp, lerp } from './rng.js';

export const TEAMS = {
  attack: { name: 'Rustjackets', color: 0xd86a2a, dark: 0x7a3a14, visor: 0xffb347 },
  defend: { name: 'Harbour Watch', color: 0x2a7a8c, dark: 0x143f4a, visor: 0x7fe3ff },
};

export const EYE_HEIGHT = 1.62;
const BODY_RADIUS = 0.42;

// ---------------------------------------------------------------------------
// The humanoid figure.
// ---------------------------------------------------------------------------

function box(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.15 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function buildWeaponMesh(weaponId) {
  const group = new THREE.Group();
  const dark = 0x1c1c20;
  const long = weaponId === 'rifle' || weaponId === 'sniper' || weaponId === 'carbine';
  const barrelLen = weaponId === 'sniper' ? 0.85 : long ? 0.6 : 0.34;
  group.add(box(0.09, 0.12, 0.5, dark, 0, 0, 0.05)); // receiver
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, barrelLen, 8),
    new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.4, metalness: 0.8 }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, 0.3 + barrelLen / 2);
  group.add(barrel);
  group.add(box(0.07, 0.16, 0.1, 0x3a2c1c, 0, -0.12, 0.08)); // grip
  group.add(box(0.08, 0.05, 0.22, dark, 0, -0.05, -0.12)); // stock
  if (weaponId === 'sniper') {
    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10),
      new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.3, metalness: 0.7 }),
    );
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, 0.05);
    group.add(scope);
  }
  if (weaponId === 'shotgun') {
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.6, metalness: 0.3 }),
    );
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, -0.06, 0.35);
    group.add(tube);
  }
  return group;
}

/** Build the visible figure for a fighter. Returns { group, parts }. */
export function buildFigure(teamId, weaponId) {
  const team = TEAMS[teamId];
  const group = new THREE.Group();
  const parts = {};

  // Legs: dark trousers, they swing when the fighter walks.
  parts.legL = box(0.16, 0.78, 0.2, 0x23242a, -0.12, 0.39, 0);
  parts.legR = box(0.16, 0.78, 0.2, 0x23242a, 0.12, 0.39, 0);
  group.add(parts.legL, parts.legR);

  // Torso: jacket in the team colour, with a darker vest plate.
  parts.torso = box(0.52, 0.62, 0.3, team.color, 0, 1.09, 0);
  group.add(parts.torso);
  group.add(box(0.54, 0.4, 0.08, team.dark, 0, 1.12, 0.16));
  group.add(box(0.54, 0.4, 0.08, team.dark, 0, 1.12, -0.16));

  // Shoulders: armoured pads in the team colour.
  group.add(box(0.16, 0.14, 0.32, team.dark, -0.32, 1.32, 0));
  group.add(box(0.16, 0.14, 0.32, team.dark, 0.32, 1.32, 0));

  // Head: a helmet with a glowing visor slit.
  parts.head = new THREE.Group();
  parts.head.position.set(0, 1.56, 0);
  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 16, 12),
    new THREE.MeshStandardMaterial({ color: team.dark, roughness: 0.6, metalness: 0.3 }),
  );
  skull.scale.set(1, 1.1, 1.05);
  skull.castShadow = true;
  parts.head.add(skull);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.07, 0.05),
    new THREE.MeshStandardMaterial({
      color: team.visor, emissive: team.visor, emissiveIntensity: 1.6, roughness: 0.2,
    }),
  );
  visor.position.set(0, 0.02, 0.17);
  parts.head.add(visor);
  group.add(parts.head);

  // Arms: held forward, carrying the weapon.
  parts.armL = box(0.13, 0.55, 0.15, team.color, -0.2, 1.15, 0.22);
  parts.armR = box(0.13, 0.55, 0.15, team.color, 0.2, 1.15, 0.22);
  parts.armL.rotation.x = -1.1;
  parts.armR.rotation.x = -1.1;
  group.add(parts.armL, parts.armR);

  // The weapon, held across the chest and pointing where the fighter looks.
  parts.gun = buildWeaponMesh(weaponId);
  parts.gun.position.set(0.08, 1.28, 0.35);
  group.add(parts.gun);

  // A small backpack, so the silhouette reads from behind too.
  group.add(box(0.4, 0.42, 0.14, team.dark, 0, 1.12, -0.22));

  return { group, parts };
}

// ---------------------------------------------------------------------------
// Fighter state.
// ---------------------------------------------------------------------------

let nextFighterId = 1;

export class Fighter {
  constructor(opts) {
    this.id = nextFighterId++;
    this.name = opts.name;
    this.team = opts.team; // 'attack' | 'defend'
    this.isPlayer = !!opts.isPlayer;
    this.role = opts.role || 'entry';
    this.pos = new THREE.Vector3(opts.x, 0, opts.z);
    this.yaw = opts.yaw || 0;
    this.pitch = 0;
    this.hp = 100;
    this.armor = 0;
    this.helmet = false;
    this.alive = true;
    this.weaponId = opts.weaponId || 'rifle';
    this.ammo = 0;
    this.reserve = 0;
    this.crouch = false;
    this.aiming = false;
    this.moving = false;
    this.speed = 0;
    this.walkPhase = 0;
    this.flashUntil = 0;
    this.hasDevice = false; // carries the plant device (attackers)
    this.planting = 0; // 0..1 progress
    this.defusing = 0;
    this.kills = 0;
    this.deaths = 0;
    this.money = opts.money ?? 800;
    this.figure = null;
    this.parts = null;
    this.deadTimer = 0;
    this.lastDamageFrom = null;
    this.lastDamageAt = 0;
  }

  eyePos(out) {
    out.set(this.pos.x, this.pos.y + (this.crouch ? 1.15 : EYE_HEIGHT), this.pos.z);
    return out;
  }

  chestPos(out) {
    out.set(this.pos.x, this.pos.y + 1.15, this.pos.z);
    return out;
  }

  /** Spheres the hit test uses: a small head sphere and a body sphere. */
  hitSpheres() {
    const crouchDrop = this.crouch ? 0.45 : 0;
    return [
      { x: this.pos.x, y: this.pos.y + 1.58 - crouchDrop, z: this.pos.z, r: 0.22, part: 'head' },
      { x: this.pos.x, y: this.pos.y + 1.05 - crouchDrop, z: this.pos.z, r: 0.48, part: 'body' },
    ];
  }

  /** Apply damage, armour first. Returns the damage actually taken. */
  takeDamage(amount, headshot, now) {
    let dealt = amount;
    if (headshot && !this.helmet) dealt *= 1.0; // headshot multiplier applied by caller
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, dealt * 0.5);
      this.armor -= absorbed;
      dealt -= absorbed;
    }
    this.hp -= dealt;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deaths++;
      this.deadTimer = 0;
    }
    this.lastDamageAt = now;
    return dealt;
  }

  respawn(x, z, yaw) {
    this.pos.set(x, groundHeight(x, z), z);
    this.yaw = yaw;
    this.hp = 100;
    this.alive = true;
    this.planting = 0;
    this.defusing = 0;
    this.flashUntil = 0;
  }
}

// ---------------------------------------------------------------------------
// The bot brain.
// ---------------------------------------------------------------------------

const SIGHT_RANGE = 46;
const SIGHT_FOV = 2.1; // ~120 degrees

/** Does the segment between two points cross any smoke cloud? */
function crossesSmoke(ax, ay, az, bx, by, bz, smokes) {
  for (const s of smokes) {
    // Segment-sphere test.
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const fx = ax - s.x;
    const fy = ay - s.y;
    const fz = az - s.z;
    const a = dx * dx + dy * dy + dz * dz;
    const b = 2 * (fx * dx + fy * dy + fz * dz);
    const c = fx * fx + fy * fy + fz * fz - s.r * s.r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t >= 0 && t <= 1) return true;
  }
  return false;
}

export function makeBrain(fighter, role, stream) {
  const brain = {
    fighter,
    role,
    stream,
    state: 'toSite', // toSite | hold | plant | defuse | investigate | fallback
    path: null,
    pathIdx: 0,
    target: null, // current visible enemy
    aimError: 0,
    reactionAt: 0,
    burstLeft: 0,
    nextShotAt: 0,
    holdSpot: null,
    holdUntil: 0,
    investigateAt: null,
    repathAt: 0,
    skill: 0.55 + stream.next() * 0.35, // per-bot skill: reaction + accuracy
    thinkAt: 0,
  };
  return brain;
}

/** Where this bot wants to go right now: a site, a hold spot, or a sound. */
function pickDestination(brain, world) {
  const f = brain.fighter;
  const planted = world.plant.state === 'planted';
  if (f.team === 'attack') {
    if (planted) {
      // Device is down: guard it from a hold spot near the site.
      return holdSpotNear(world.plant.site, brain);
    }
    if (f.hasDevice) {
      const site = world.plant.targetSite;
      return { x: site.x, z: site.z, kind: 'plant' };
    }
    if (brain.role === 'lurker') {
      const other = world.plant.targetSite.id === 'A' ? SITES.B : SITES.A;
      return { x: other.x, z: other.z, kind: 'lurk' };
    }
    const site = world.plant.targetSite;
    return { x: site.x, z: site.z, kind: 'site' };
  }
  // Defenders.
  if (planted) {
    return { x: world.plant.x, z: world.plant.z, kind: 'defuse' };
  }
  if (brain.role === 'anchor' || brain.role === 'awper') {
    if (!brain.holdSpot) brain.holdSpot = pickHoldSpot(f, world);
    return { x: brain.holdSpot.x, z: brain.holdSpot.z, kind: 'hold' };
  }
  const site = world.plant.targetSite;
  return { x: site.x + (brain.stream.next() - 0.5) * 6, z: site.z + (brain.stream.next() - 0.5) * 6, kind: 'site' };
}

const HOLD_SPOTS = [
  { x: -20, z: -16 }, { x: -30, z: -6 }, { x: 20, z: -16 }, { x: 30, z: -6 },
  { x: -6, z: -10 }, { x: 6, z: -10 }, { x: -14, z: 2 }, { x: 14, z: 2 },
  { x: -26, z: -19 }, { x: 26, z: -19 }, { x: 0, z: -12 }, { x: -8, z: -3 },
];

function pickHoldSpot(fighter, world) {
  const site = world.plant.targetSite;
  let best = HOLD_SPOTS[0];
  let bestScore = -Infinity;
  for (const spot of HOLD_SPOTS) {
    const dSite = Math.hypot(spot.x - site.x, spot.z - site.z);
    const dSelf = Math.hypot(spot.x - fighter.pos.x, spot.z - fighter.pos.z);
    // Prefer a spot near the site the attack is expected at, but not too
    // far from where the bot already is, and with a wall at its back.
    const score = -dSite * 0.7 - dSelf * 0.3 + (segmentBlocked(spot.x, spot.z, site.x, site.z) ? -2 : 3);
    if (score > bestScore) {
      bestScore = score;
      best = spot;
    }
  }
  return best;
}

function holdSpotNear(site, brain) {
  const spots = HOLD_SPOTS.filter((s) => Math.hypot(s.x - site.x, s.z - site.z) < 14);
  return brain.stream.pick(spots.length ? spots : HOLD_SPOTS);
}

/** Can this bot see that enemy right now? */
function canSee(bot, enemy, world, now) {
  if (!enemy.alive) return false;
  if (now < bot.flashUntil) return false;
  const dx = enemy.pos.x - bot.pos.x;
  const dz = enemy.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > SIGHT_RANGE) return false;
  // Field of view.
  const facing = Math.atan2(-Math.sin(bot.yaw), -Math.cos(bot.yaw));
  const toEnemy = Math.atan2(dx, dz);
  let diff = toEnemy - facing;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) > SIGHT_FOV / 2 && dist > 4) return false;
  // Line of sight at eye level, and smoke genuinely blocks vision.
  const eyeY = bot.pos.y + (bot.crouch ? 1.15 : EYE_HEIGHT);
  const enemyEyeY = enemy.pos.y + (enemy.crouch ? 1.15 : EYE_HEIGHT);
  if (!hasLineOfSight(bot.pos.x, eyeY, bot.pos.z, enemy.pos.x, enemyEyeY, enemy.pos.z)) return false;
  if (crossesSmoke(bot.pos.x, eyeY, bot.pos.z, enemy.pos.x, enemyEyeY, enemy.pos.z, world.smokes)) return false;
  return true;
}

/** The bot's 10 Hz think: pick a target, a destination, and a state. */
export function brainThink(brain, world, now) {
  const f = brain.fighter;
  if (!f.alive) return;

  // --- Senses: the nearest enemy this bot can actually see.
  let target = null;
  let targetDist = Infinity;
  for (const other of world.fighters) {
    if (other.team === f.team || !other.alive) continue;
    const d = Math.hypot(other.pos.x - f.pos.x, other.pos.z - f.pos.z);
    if (d < targetDist && canSee(f, other, world, now)) {
      target = other;
      targetDist = d;
    }
  }
  brain.target = target;

  // --- Hearing: a loud sound pulls the bot to investigate.
  if (world.sounds.length > 0 && !target) {
    const s = world.sounds[world.sounds.length - 1];
    if (now - s.at < 1.5 && Math.hypot(s.x - f.pos.x, s.z - f.pos.z) < 26) {
      brain.investigateAt = { x: s.x, z: s.z };
      brain.state = 'investigate';
    }
  }

  // --- Planting: the carrier plants when it reaches its site and is safe.
  if (f.hasDevice && !target && world.plant.state === 'none') {
    const site = world.plant.targetSite;
    if (Math.hypot(f.pos.x - site.x, f.pos.z - site.z) < site.r - 0.5) {
      brain.state = 'plant';
      return;
    }
  }

  // --- Defusing: a defender on the planted device defuses it.
  if (f.team === 'defend' && world.plant.state === 'planted') {
    if (Math.hypot(f.pos.x - world.plant.x, f.pos.z - world.plant.z) < 2.2 && !target) {
      brain.state = 'defuse';
      return;
    }
  }

  // --- Movement: re-path when the destination changed or the path ran out.
  if (brain.state === 'investigate' && brain.investigateAt) {
    if (!brain.path || now > brain.repathAt) {
      brain.path = findPath(f.pos.x, f.pos.z, brain.investigateAt.x, brain.investigateAt.z);
      brain.pathIdx = 0;
      brain.repathAt = now + 2;
    }
    if (!brain.path || brain.pathIdx >= brain.path.length) {
      brain.state = 'toSite';
      brain.investigateAt = null;
      brain.path = null;
    }
    return;
  }

  if (brain.state === 'hold') {
    if (now > brain.holdUntil) brain.state = 'toSite';
    return;
  }

  if (!brain.path || brain.pathIdx >= brain.path.length || now > brain.repathAt) {
    const dest = pickDestination(brain, world);
    brain.dest = dest;
    brain.path = findPath(f.pos.x, f.pos.z, dest.x, dest.z);
    brain.pathIdx = 0;
    brain.repathAt = now + 4;
    if (dest.kind === 'hold') {
      brain.state = 'hold';
      brain.holdUntil = now + 6 + brain.stream.next() * 6;
    } else {
      brain.state = 'toSite';
    }
  }
}

/**
 * The bot's per-step steering and firing. Called every fixed step with the
 * world's shared state. Returns a movement intent the engine applies.
 */
export function brainStep(brain, world, now, dt) {
  const f = brain.fighter;
  if (!f.alive) return { moveX: 0, moveZ: 0, wantFire: false, wantCrouch: false };

  // --- Aiming at a visible enemy.
  let wantFire = false;
  if (brain.target && brain.target.alive) {
    const t = brain.target;
    const dx = t.pos.x - f.pos.x;
    const dz = t.pos.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    let dyaw = wantYaw - f.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    // Turn speed scales with skill: good bots snap on, weak bots lag.
    const turn = clamp(dyaw, -3.2 * dt, 3.2 * dt) * (0.5 + brain.skill);
    f.yaw += turn;
    // Aim at the chest, with an error that shrinks as the bot settles.
    const settle = clamp(1 - Math.abs(dyaw) * 2, 0.2, 1);
    const err = (1 - brain.skill * 0.6) * (0.06 + dist * 0.0016) * (2 - settle);
    f.aimError = err;
    // Fire in bursts: 3-5 shots, then a pause to re-aim.
    if (Math.abs(dyaw) < 0.12 + err && now >= brain.nextShotAt) {
      if (brain.burstLeft <= 0) {
        brain.burstLeft = 3 + Math.floor(brain.stream.next() * 3);
        brain.nextShotAt = now + 0.25 + brain.stream.next() * 0.35;
      } else {
        wantFire = true;
        brain.burstLeft--;
        brain.nextShotAt = now + 0.12;
      }
    }
    // Hold still while engaging at range: a planted bot is a deadly bot.
    if (dist > 8) return { moveX: 0, moveZ: 0, wantFire, wantCrouch: brain.stream.next() < 0.3 };
  }

  // --- Planting / defusing: stand still and work the device.
  if (brain.state === 'plant' || brain.state === 'defuse') {
    return { moveX: 0, moveZ: 0, wantFire: false, wantCrouch: true };
  }

  // --- Holding an angle: stay put, watch the lane.
  if (brain.state === 'hold') {
    const site = world.plant.targetSite;
    const wantYaw = Math.atan2(-(site.x - f.pos.x), -(site.z - f.pos.z));
    let dyaw = wantYaw - f.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    f.yaw += clamp(dyaw, -1.5 * dt, 1.5 * dt);
    return { moveX: 0, moveZ: 0, wantFire: false, wantCrouch: false };
  }

  // --- Walking the path.
  if (brain.path && brain.pathIdx < brain.path.length) {
    const wp = brain.path[brain.pathIdx];
    const dx = wp.x - f.pos.x;
    const dz = wp.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.9) {
      brain.pathIdx++;
      return { moveX: 0, moveZ: 0, wantFire, wantCrouch: false };
    }
    const wantYaw = Math.atan2(-dx, -dz);
    let dyaw = wantYaw - f.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    f.yaw += clamp(dyaw, -4 * dt, 4 * dt);
    // Walk forward in the direction faced; strafe a little while turning.
    const forward = Math.cos(dyaw);
    return { moveX: Math.sin(dyaw) * 0.6, moveZ: Math.max(0.3, forward), wantFire, wantCrouch: false };
  }

  return { moveX: 0, moveZ: 0, wantFire, wantCrouch: false };
}

/** A fighter's walk animation: legs swing, body bobs, gun follows the aim. */
export function animateFigure(fighter, dt) {
  if (!fighter.figure || !fighter.parts) return;
  const p = fighter.parts;
  const speed = fighter.speed;
  if (fighter.alive) {
    fighter.walkPhase += dt * (4 + speed * 2.2);
    const swing = Math.sin(fighter.walkPhase) * clamp(speed / 5, 0, 1) * 0.55;
    p.legL.rotation.x = swing;
    p.legR.rotation.x = -swing;
    p.torso.position.y = 1.09 + Math.abs(Math.sin(fighter.walkPhase)) * 0.03 * clamp(speed / 5, 0, 1);
    p.head.rotation.x = fighter.pitch * 0.4;
    p.gun.rotation.x = fighter.pitch;
  } else {
    // Fallen: lie on the ground, fading out of the fight.
    fighter.deadTimer += dt;
    fighter.figure.rotation.x = lerp(fighter.figure.rotation.x, -Math.PI / 2, dt * 4);
    fighter.figure.position.y = lerp(fighter.figure.position.y, 0.15, dt * 4);
  }
}

/** Attach a fresh figure to a fighter and add it to the scene. */
export function spawnFigure(scene, fighter) {
  const { group, parts } = buildFigure(fighter.team, fighter.weaponId);
  group.position.copy(fighter.pos);
  group.rotation.y = fighter.yaw;
  scene.add(group);
  fighter.figure = group;
  fighter.parts = parts;
}
