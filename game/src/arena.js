// The arena: IRONVEIL's Dockside Foundry.
//
// A foundry yard on the docks, 70 by 46 metres, fought over by two teams of
// five. Attackers push in from the south gate; defenders hold the north.
// Two plant sites sit at opposite ends of the yard, so the attack can split
// and the defence has to guess:
//   Site A — the Furnace Hall, west, under a gantry crane and a catwalk.
//   Site B — the Crane Yard, east, between stacked shipping containers.
//
// The map is data, not code: solid boxes the fighters collide with, a
// navigation graph the bots walk, spawn points, and the two plant zones.
// Everything here is deterministic; nothing is generated at run time.
//
// Coordinate system: x runs west (-) to east (+), z runs north (-) to south
// (+), y is up. The yard floor is y = 0. Fighters are 1.8 tall, eye at 1.62.

import { clamp } from './rng.js';

export const ARENA = {
  name: 'Dockside Foundry',
  bounds: { minX: -35, maxX: 35, minZ: -23, maxZ: 23 },
  // First team to this many round wins takes the match.
  roundsToWin: 7,
  // A round that runs out of time without a plant goes to the defenders.
  roundSeconds: 100,
  buySeconds: 18,
  freezeSeconds: 4,
};

// ---------------------------------------------------------------------------
// Solids: axis-aligned boxes. { x, z } is the centre, w/d the footprint,
// h the height, y0 the base height (0 = floor). kind is used by the
// renderer for colour and by the bots for cover scoring.
// ---------------------------------------------------------------------------
export const SOLIDS = [
  // Outer walls (tall, so nothing leaves the yard).
  { x: 0, z: -24.5, w: 74, d: 3, h: 9, y0: 0, kind: 'wall' },
  { x: 0, z: 24.5, w: 74, d: 3, h: 9, y0: 0, kind: 'wall' },
  { x: -36.5, z: 0, w: 3, d: 49, h: 9, y0: 0, kind: 'wall' },
  { x: 36.5, z: 0, w: 3, d: 49, h: 9, y0: 0, kind: 'wall' },

  // Furnace Hall (site A), west: a big furnace block with a catwalk above.
  { x: -28, z: -14, w: 10, d: 8, h: 6, y0: 0, kind: 'furnace' },
  { x: -30, z: -4, w: 6, d: 6, h: 3.4, y0: 0, kind: 'crate' },
  { x: -22, z: -8, w: 4, d: 4, h: 2.2, y0: 0, kind: 'crate' },
  { x: -24, z: -18, w: 8, d: 2, h: 4.5, y0: 0, kind: 'wall' },
  // Catwalk platform over the west lane (walkable, reached by the ramp).
  { x: -27, z: -9, w: 12, d: 3, h: 0.5, y0: 4.2, kind: 'walkway' },
  { x: -20, z: -9, w: 3, d: 3, h: 0.5, y0: 4.2, kind: 'walkway' },
  // Ramp up to the catwalk.
  { x: -16, z: -9, w: 6, d: 3, h: 0.5, y0: 2.1, kind: 'ramp' },

  // Crane Yard (site B), east: stacked containers and a crane leg.
  { x: 28, z: -14, w: 12, d: 3, h: 3, y0: 0, kind: 'container' },
  { x: 28, z: -14, w: 12, d: 3, h: 3, y0: 3, kind: 'container' },
  { x: 24, z: -6, w: 4, d: 4, h: 2.6, y0: 0, kind: 'crate' },
  { x: 31, z: -6, w: 3, d: 3, h: 1.6, y0: 0, kind: 'crate' },
  { x: 30, z: -19, w: 2, d: 2, h: 8, y0: 0, kind: 'pillar' },
  { x: 22, z: -18, w: 6, d: 2, h: 4, y0: 0, kind: 'wall' },

  // Mid: the foundry floor. Pillars, a conveyor, and cover crates.
  { x: -8, z: 0, w: 3, d: 3, h: 7, y0: 0, kind: 'pillar' },
  { x: 8, z: 0, w: 3, d: 3, h: 7, y0: 0, kind: 'pillar' },
  { x: 0, z: -6, w: 10, d: 2, h: 1.2, y0: 0, kind: 'conveyor' },
  { x: -4, z: 6, w: 4, d: 3, h: 2, y0: 0, kind: 'crate' },
  { x: 6, z: 8, w: 4, d: 3, h: 2.4, y0: 0, kind: 'crate' },
  { x: -14, z: 8, w: 6, d: 2, h: 3, y0: 0, kind: 'container' },
  { x: 16, z: -2, w: 6, d: 2, h: 3, y0: 0, kind: 'container' },

  // South approach (attacker side): gatehouse and sandbag lines.
  { x: -12, z: 16, w: 8, d: 2, h: 2.6, y0: 0, kind: 'wall' },
  { x: 12, z: 16, w: 8, d: 2, h: 2.6, y0: 0, kind: 'wall' },
  { x: 0, z: 19, w: 5, d: 3, h: 3.2, y0: 0, kind: 'crate' },
  { x: -22, z: 14, w: 4, d: 4, h: 2.2, y0: 0, kind: 'crate' },
  { x: 22, z: 14, w: 4, d: 4, h: 2.2, y0: 0, kind: 'crate' },

  // North approach (defender side): offices and a low wall.
  { x: -10, z: -19, w: 8, d: 2, h: 3.4, y0: 0, kind: 'wall' },
  { x: 10, z: -19, w: 8, d: 2, h: 3.4, y0: 0, kind: 'wall' },
  { x: 0, z: -12, w: 4, d: 4, h: 2, y0: 0, kind: 'crate' },

  // Loading docks: low platforms (0.45 high) a fighter steps onto without
  // jumping — a step-up ledge with a sightline over the mid crates.
  { x: -4, z: -12, w: 6, d: 4, h: 0.45, y0: 0, kind: 'dock' },
  { x: 8, z: 12, w: 6, d: 4, h: 0.45, y0: 0, kind: 'dock' },
];

// ---------------------------------------------------------------------------
// Plant sites. The device is planted inside the circle; a planted device
// ticks down and then detonates for an attacker round win.
// ---------------------------------------------------------------------------
export const SITES = {
  A: { id: 'A', name: 'Furnace Hall', x: -27, z: -12, r: 5.5 },
  B: { id: 'B', name: 'Crane Yard', x: 27, z: -12, r: 5.5 },
};

// Attackers enter from the south gate, defenders from the north offices.
export const SPAWNS = {
  attack: [
    { x: -14, z: 20, yaw: Math.PI },
    { x: -7, z: 21, yaw: Math.PI },
    { x: 0, z: 21, yaw: Math.PI },
    { x: 7, z: 21, yaw: Math.PI },
    { x: 14, z: 20, yaw: Math.PI },
  ],
  defend: [
    { x: -16, z: -20, yaw: 0 },
    { x: -6, z: -21, yaw: 0 },
    { x: 0, z: -21, yaw: 0 },
    { x: 6, z: -21, yaw: 0 },
    { x: 16, z: -20, yaw: 0 },
  ],
};

// ---------------------------------------------------------------------------
// Navigation graph. Nodes sit in open lanes; edges join nodes a fighter can
// walk between without crossing a solid. Bots plan with A* over this graph,
// then smooth the path by cutting corners where the straight line is clear.
// ---------------------------------------------------------------------------
export const NAV = [
  // Attacker spawn / south.
  { x: -14, z: 20 }, { x: 0, z: 20 }, { x: 14, z: 20 },
  { x: -14, z: 13 }, { x: 0, z: 13 }, { x: 14, z: 13 },
  // Mid lanes.
  { x: -14, z: 5 }, { x: 0, z: 5 }, { x: 14, z: 5 },
  { x: -14, z: -3 }, { x: 0, z: -3 }, { x: 14, z: -3 },
  // West lane to site A.
  { x: -22, z: 6 }, { x: -26, z: -2 }, { x: -27, z: -12 },
  { x: -20, z: -14 }, { x: -27, z: -19 },
  // East lane to site B.
  { x: 22, z: 6 }, { x: 26, z: -2 }, { x: 27, z: -12 },
  { x: 20, z: -14 }, { x: 27, z: -19 },
  // North / defender side.
  { x: -14, z: -15 }, { x: 0, z: -15 }, { x: 14, z: -15 },
  { x: -8, z: -20 }, { x: 8, z: -20 },
];

const NAV_EDGES = [
  [0, 3], [1, 4], [2, 5], [3, 4], [4, 5],
  [3, 6], [4, 7], [5, 8], [6, 7], [7, 8],
  [6, 9], [7, 10], [8, 11], [9, 10], [10, 11],
  [6, 12], [12, 13], [13, 14], [13, 15], [14, 16],
  [9, 15], [15, 22], [16, 22], [10, 23], [11, 24],
  [8, 17], [17, 18], [18, 19], [18, 20], [19, 21],
  [22, 23], [23, 24], [22, 25], [24, 26], [23, 26],
  [9, 22], [11, 24], [14, 22], [19, 24],
];

const NAV_ADJ = NAV.map(() => []);
for (const [a, b] of NAV_EDGES) {
  NAV_ADJ[a].push(b);
  NAV_ADJ[b].push(a);
}

function navDistance(a, b) {
  const dx = NAV[a].x - NAV[b].x;
  const dz = NAV[a].z - NAV[b].z;
  return Math.hypot(dx, dz);
}

/** Nearest nav node to a point. */
export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NAV.length; i++) {
    const d = (NAV[i].x - x) ** 2 + (NAV[i].z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * A* over the nav graph. Returns a list of {x, z} waypoints from the
 * caller's position to the target, smoothed by line-of-sight cuts, or null
 * when no route exists. Pure and deterministic.
 */
export function findPath(fromX, fromZ, toX, toZ) {
  const start = nearestNode(fromX, fromZ);
  const goal = nearestNode(toX, toZ);
  if (start === goal) return [{ x: toX, z: toZ }];

  const open = [start];
  const came = new Map();
  const g = new Map([[start, 0]]);
  const f = new Map([[start, navDistance(start, goal)]]);
  const closed = new Set();

  while (open.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if ((f.get(open[i]) ?? Infinity) < (f.get(open[bestIdx]) ?? Infinity)) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    if (current === goal) {
      const nodes = [goal];
      let c = goal;
      while (came.has(c)) {
        c = came.get(c);
        nodes.unshift(c);
      }
      const points = nodes.map((n) => ({ x: NAV[n].x, z: NAV[n].z }));
      points[points.length - 1] = { x: toX, z: toZ };
      return smoothPath({ x: fromX, z: fromZ }, points);
    }
    closed.add(current);
    for (const next of NAV_ADJ[current]) {
      if (closed.has(next)) continue;
      const tentative = (g.get(current) ?? Infinity) + navDistance(current, next);
      if (tentative < (g.get(next) ?? Infinity)) {
        came.set(next, current);
        g.set(next, tentative);
        f.set(next, tentative + navDistance(next, goal));
        if (!open.includes(next)) open.push(next);
      }
    }
  }
  return null;
}

/** Cut corners: drop a waypoint when the straight line past it is clear. */
function smoothPath(from, points) {
  const out = [];
  let anchor = from;
  let i = 0;
  while (i < points.length) {
    let furthest = i;
    for (let j = points.length - 1; j > i; j--) {
      if (!segmentBlocked(anchor.x, anchor.z, points[j].x, points[j].z)) {
        furthest = j;
        break;
      }
    }
    out.push(points[furthest]);
    anchor = points[furthest];
    i = furthest + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collision and line of sight against the solids.
// ---------------------------------------------------------------------------

/** True when a circle of radius r at (x, z) overlaps any floor-level solid. */
export function circleHitsSolid(x, z, r) {
  const { minX, maxX, minZ, maxZ } = ARENA.bounds;
  if (x - r < minX || x + r > maxX || z - r < minZ || z + r > maxZ) return true;
  for (const s of SOLIDS) {
    if (s.y0 > 0.5) continue; // walkways and ramps are above the floor
    if (s.h <= 0.55) continue; // low docks are stepped onto, not collided with
    const hw = s.w / 2;
    const hd = s.d / 2;
    const cx = clamp(x, s.x - hw, s.x + hw);
    const cz = clamp(z, s.z - hd, s.z + hd);
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
  }
  return false;
}

/** Ground height under a point: 0 on the floor, 4.2 on the catwalk, ramp in between. */
export function groundHeight(x, z) {
  let height = 0;
  for (const s of SOLIDS) {
    if (s.kind === 'dock') {
      if (Math.abs(x - s.x) <= s.w / 2 && Math.abs(z - s.z) <= s.d / 2) {
        height = Math.max(height, 0.45);
      }
      continue;
    }
    if (s.kind !== 'walkway' && s.kind !== 'ramp') continue;
    if (Math.abs(x - s.x) <= s.w / 2 && Math.abs(z - s.z) <= s.d / 2) {
      if (s.kind === 'walkway') return 4.2;
      // The ramp rises from the floor at its east end to 4.2 at its west end.
      const t = clamp((s.x + s.w / 2 - x) / s.w, 0, 1);
      return 4.2 * t;
    }
  }
  return height;
}

/** True when the segment between two ground points crosses a solid. */
export function segmentBlocked(x0, z0, x1, z1) {
  for (const s of SOLIDS) {
    if (s.h < 1.5 || s.y0 > 0.5) continue;
    if (segmentHitsBox(x0, z0, x1, z1, s)) return true;
  }
  return false;
}

function segmentHitsBox(x0, z0, x1, z1, s) {
  const hw = s.w / 2 + 0.3;
  const hd = s.d / 2 + 0.3;
  const minX = s.x - hw;
  const maxX = s.x + hw;
  const minZ = s.z - hd;
  const maxZ = s.z + hd;
  // Slab test in 2D.
  let tmin = 0;
  let tmax = 1;
  const dx = x1 - x0;
  const dz = z1 - z0;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < minX || x0 > maxX) return false;
  } else {
    let t1 = (minX - x0) / dx;
    let t2 = (maxX - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z0 < minZ || z0 > maxZ) return false;
  } else {
    let t1 = (minZ - z0) / dz;
    let t2 = (maxZ - z0) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

/**
 * Ray against every solid box. Returns the distance to the nearest hit, or
 * Infinity when the ray escapes the yard. Used for bullets and for sight.
 */
export function raySolids(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const s of SOLIDS) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, s);
    if (t !== null && t < best) best = t;
  }
  return best;
}

function rayBox(ox, oy, oz, dx, dy, dz, s) {
  const minX = s.x - s.w / 2;
  const maxX = s.x + s.w / 2;
  const minY = s.y0;
  const maxY = s.y0 + s.h;
  const minZ = s.z - s.d / 2;
  const maxZ = s.z + s.d / 2;
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [ox, dx, minX, maxX],
    [oy, dy, minY, maxY],
    [oz, dz, minZ, maxZ],
  ];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return null;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

/** True when the straight line between two eye-level points is unobstructed. */
export function hasLineOfSight(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-6) return true;
  const hit = raySolids(ax, ay, az, dx / dist, dy / dist, dz / dist, dist);
  return hit >= dist - 0.05;
}
