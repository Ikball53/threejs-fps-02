// bots.js — the bots: routes, holds, reactions to sight and sound, planting
// and defusing. One job: decide what each bot does this tick. The bots walk
// the waypoint graph, hold angles, and only shoot what they can actually see.

import { NODES, findRoute, nearestNode, segmentBlocked, MAP } from "./map.js";
import { CFG } from "./state.js";
import { fireShot } from "./arms.js";
import { stepFighter, eyeHeight } from "./mover.js";

export const CALLSIGNS = {
  ember: ["ASH", "FLINT", "COAL", "SPARK"],
  slate: ["RUST", "IRON", "STEEL", "SLAG", "GRIT"],
};

export function makeBot(fighter, skill) {
  return {
    skill, // 0..1, higher is faster and steadier
    node: nearestNode(fighter.x, fighter.z),
    route: [],
    holdUntil: 0,
    target: null,
    lastSeen: null,
    investigate: null,
    nextShot: 0,
    burstLeft: 0,
    burstPauseUntil: 0,
    strafeDir: Math.random() < 0.5 ? 1 : -1,
    strafeUntil: 0,
    plantAt: 0,
    holdNode: null,
  };
}

function eyePos(f) {
  return { x: f.x, y: (f.y ?? 0) + eyeHeight(f), z: f.z };
}

function canSee(a, b, smokes) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 42) return false;
  // Facing cone: bots see ~200 degrees in front.
  const fx = -Math.sin(a.yaw);
  const fz = -Math.cos(a.yaw);
  const dot = (dx * fx + dz * fz) / (dist || 1);
  if (dot < -0.35) return false;
  if (segmentBlocked(a.x, a.z, b.x, b.z)) return false;
  // Smoke clouds block sight along the segment.
  for (const s of smokes ?? []) {
    const t = Math.max(0, Math.min(1, ((s.x - a.x) * dx + (s.z - a.z) * dz) / (dist * dist || 1)));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    if (Math.hypot(px - s.x, pz - s.z) < 5) return false;
  }
  return true;
}

function aimDir(from, to, err) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return {
    x: dx / len + (Math.random() - 0.5) * 2 * err,
    y: dy / len + (Math.random() - 0.5) * 2 * err,
    z: dz / len + (Math.random() - 0.5) * 2 * err,
  };
}

function moveToward(f, tx, tz, dt, speed) {
  const dx = tx - f.x;
  const dz = tz - f.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.4) return true;
  const yaw = Math.atan2(-dx, -dz);
  f.yaw = yaw;
  const input = { fwd: 1, strafe: 0, jump: false, crouch: false, walk: false };
  // Steer by temporarily rotating the fighter toward the target.
  const ox = f.yaw;
  f.yaw = yaw;
  stepFighter(f, input, dt);
  f.yaw = ox + (yaw - ox) * 0.2;
  void speed;
  return false;
}

// Assign each defender a hold node near the site or a lane.
export function assignHolds(fighters) {
  const holds = ["wSite", "eSite", "site", "midN", "dWest"];
  let i = 0;
  for (const f of fighters) {
    if (f.team !== "slate" || !f.bot) continue;
    f.bot.holdNode = holds[i % holds.length];
    i += 1;
  }
}

export function hearShot(fighters, x, z, radius, shooter) {
  for (const f of fighters) {
    if (!f.alive || !f.bot || f === shooter) continue;
    const d = Math.hypot(f.x - x, f.z - z);
    if (d < radius && !f.bot.target) {
      f.bot.investigate = { x, z };
    }
  }
}

// One fixed-step tick for one bot. Returns an array of events for the sim:
// { type: 'shot', ... } | { type: 'planted' } | { type: 'defused' }.
export function stepBot(f, fighters, match, dt, time, blocks) {
  const events = [];
  const bot = f.bot;
  if (!f.alive) return events;
  f.recoil = Math.max(0, f.recoil - dt * 1.4);

  // Flashed bots stand still and see nothing.
  if (time < f.flashUntil) {
    return events;
  }

  // --- Perception: nearest visible enemy.
  let seen = null;
  let seenD = Infinity;
  for (const other of fighters) {
    if (other.team === f.team || !other.alive) continue;
    const d = Math.hypot(other.x - f.x, other.z - f.z);
    if (d < seenD && canSee(f, other, match.smokes)) {
      seen = other;
      seenD = d;
    }
  }
  if (seen) {
    if (bot.target !== seen) {
      bot.target = seen;
      // Reaction delay: better bots answer faster.
      bot.nextShot = time + (0.55 - bot.skill * 0.3) + Math.random() * 0.15;
      bot.burstLeft = 0;
    }
    bot.lastSeen = { x: seen.x, z: seen.z, t: time };
    bot.investigate = null;
  } else if (bot.target && time - (bot.lastSeen?.t ?? 0) > 1.2) {
    bot.investigate = { x: bot.lastSeen.x, z: bot.lastSeen.z };
    bot.target = null;
  }

  // --- Combat: face the target and fire in bursts.
  if (bot.target && bot.target.alive) {
    const t = bot.target;
    const dx = t.x - f.x;
    const dz = t.z - f.z;
    f.yaw = Math.atan2(-dx, -dz);
    const dist = Math.hypot(dx, dz);
    // Strafe a little so fights move.
    if (time > bot.strafeUntil) {
      bot.strafeDir = Math.random() < 0.5 ? 1 : -1;
      bot.strafeUntil = time + 0.7 + Math.random() * 0.8;
    }
    stepFighter(f, { fwd: 0, strafe: bot.strafeDir * 0.4, jump: false, crouch: dist > 18, walk: false }, dt);
    if (time >= bot.nextShot && time >= bot.burstPauseUntil) {
      if (bot.burstLeft <= 0) {
        bot.burstLeft = 2 + Math.floor(Math.random() * 3);
      }
      const err = 0.045 - bot.skill * 0.025 + (f.moving ? 0.02 : 0);
      const origin = eyePos(f);
      const aim = aimDir(origin, { x: t.x, y: (t.y ?? 0) + 1.25, z: t.z }, err);
      const shot = fireShot(f, aim, origin, fighters, blocks, time);
      if (shot) {
        bot.burstLeft -= 1;
        events.push({ type: "shot", shooter: f, shot });
        if (bot.burstLeft <= 0) bot.burstPauseUntil = time + 0.45 + Math.random() * 0.5;
      } else if (f.ammo[f.weapon] && f.ammo[f.weapon].mag <= 0) {
        events.push({ type: "reload", fighter: f });
      }
    }
    return events;
  }

  // --- Objective work.
  const core = match.core;
  if (f.team === "ember" && core.carrier === f.id && match.phase === "live") {
    // Carrier heads for the site and plants when inside it.
    const inSite = f.x > MAP.site.x0 && f.x < MAP.site.x1 && f.z > MAP.site.z0 && f.z < MAP.site.z1;
    if (inSite) {
      core.progress += dt;
      if (core.progress >= CFG.plantTime) {
        core.state = "planted";
        core.fuse = CFG.fuseTime;
        core.x = f.x;
        core.z = f.z;
        events.push({ type: "planted", fighter: f });
      }
      return events;
    }
    return routeStep(f, "site", dt, time);
  }
  if (f.team === "slate" && core.state === "planted" && match.phase === "live") {
    const d = Math.hypot(core.x - f.x, core.z - f.z);
    if (d < 2.2) {
      core.progress += dt;
      if (core.progress >= CFG.defuseTime) {
        core.state = "defused";
        events.push({ type: "defused", fighter: f });
      }
      return events;
    }
    return routeStep(f, "site", dt, time);
  }

  // --- Movement: investigate, then role routes, then hold.
  if (bot.investigate) {
    const done = moveToward(f, bot.investigate.x, bot.investigate.z, dt, CFG.botSpeed);
    if (done) bot.investigate = null;
    return events;
  }
  if (f.team === "ember") {
    const target = core.state === "planted" ? "site" : "site";
    return routeStep(f, target, dt, time);
  }
  // Defenders: hold their angle; drift back to it when pushed off.
  const hold = NODES[bot.holdNode ?? "site"];
  const d = Math.hypot(hold.x - f.x, hold.z - f.z);
  if (d > 2.5) {
    return routeStep(f, bot.holdNode, dt, time);
  }
  // Hold: face the lane the node watches.
  const face = bot.holdNode === "wSite" ? -0.6 : bot.holdNode === "eSite" ? 0.6 : 0;
  f.yaw += (face - f.yaw) * Math.min(1, dt * 2);
  f.crouched = Math.random() < 0.002;
  return events;
}

function routeStep(f, targetNode, dt, time) {
  const bot = f.bot;
  const cur = nearestNode(f.x, f.z);
  if (!bot.route || bot.route.length === 0 || bot.route[bot.route.length - 1] !== targetNode) {
    bot.route = findRoute(cur, targetNode);
    bot.route.shift(); // drop the node we stand on
  }
  const nextId = bot.route[0];
  if (!nextId) return [];
  const node = NODES[nextId];
  const arrived = moveToward(f, node.x, node.z, dt, CFG.botSpeed);
  if (arrived) bot.route.shift();
  void time;
  return [];
}
