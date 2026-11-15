// map.js — the Foundry Yard: one original map, its geometry, its colliders,
// its spawns, its site and the waypoint graph the bots walk.
// Everything visual here is built from plain geometry and flat materials in
// a chosen dusk palette; no textures are loaded from anywhere.

import * as THREE from "three";

export const MAP = {
  minX: -32, maxX: 32, minZ: -22, maxZ: 22,
  site: { x0: -7, x1: 7, z0: -21, z1: -13 }, // Reactor site, north end
  attackerSpawn: { x: 0, z: 18, yaw: Math.PI },
  defenderSpawn: { x: -14, z: -18, yaw: 0 },
  roundSpawnJitter: 2.4,
};

// Solid boxes the player and bots collide with: [x0, z0, x1, z1, height].
export const BLOCKS = [
  // perimeter
  [-34, -24, 34, -22, 5], [-34, 22, 34, 24, 5],
  [-34, -24, -32, 24, 5], [32, -24, 34, 24, 5],
  // furnace block, west centre
  [-26, -8, -18, 2, 6],
  // silo, east centre (approximated as a square block for collision)
  [18, -6, 26, 2, 7],
  // big containers
  [-12, -16, -4, -12, 3], [8, 10, 16, 14, 3],
  // crate clusters
  [-30, 8, -26, 12, 2], [-10, 4, -6, 8, 2], [2, -10, 6, -6, 2],
  [12, -4, 16, 0, 2], [-2, 12, 2, 16, 2], [24, 12, 28, 16, 2],
  [-16, 12, -12, 15, 2], [20, -16, 24, -12, 2],
  // mid pillars
  [-4, -3, -2, 3, 5], [10, -3, 12, 3, 5],
  // site barricades
  [-10, -13, -8, -11, 2], [8, -13, 10, -11, 2],
];

// Waypoint graph the bots route over: node id -> {x, z, links:[ids]}.
export const NODES = {
  aSpawn: { x: 0, z: 18, links: ["aWest", "aMid", "aEast"] },
  aWest: { x: -24, z: 14, links: ["aSpawn", "wLane", "aMid"] },
  aEast: { x: 24, z: 14, links: ["aSpawn", "eLane", "aMid"] },
  aMid: { x: 0, z: 8, links: ["aSpawn", "aWest", "aEast", "mid"] },
  wLane: { x: -28, z: 2, links: ["aWest", "wMid", "wSite"] },
  eLane: { x: 28, z: 2, links: ["aEast", "eMid", "eSite"] },
  mid: { x: 0, z: 0, links: ["aMid", "wMid", "eMid", "midN"] },
  wMid: { x: -14, z: 0, links: ["wLane", "mid", "wSite"] },
  eMid: { x: 14, z: 0, links: ["eLane", "mid", "eSite"] },
  midN: { x: 0, z: -8, links: ["mid", "wSite", "eSite", "site"] },
  wSite: { x: -12, z: -10, links: ["wMid", "midN", "site", "dWest"] },
  eSite: { x: 12, z: -10, links: ["eMid", "midN", "site", "dEast"] },
  site: { x: 0, z: -16, links: ["midN", "wSite", "eSite", "dWest", "dEast"] },
  dWest: { x: -20, z: -18, links: ["wSite", "site", "dSpawn"] },
  dEast: { x: 20, z: -18, links: ["eSite", "site", "dSpawn"] },
  dSpawn: { x: -14, z: -18, links: ["dWest", "dEast"] },
};

export function nearestNode(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const [id, n] of Object.entries(NODES)) {
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// Breadth-first route over the waypoint graph; returns node ids.
export function findRoute(fromId, toId) {
  if (fromId === toId) return [fromId];
  const prev = { [fromId]: null };
  const queue = [fromId];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const next of NODES[cur].links) {
      if (prev[next] !== undefined) continue;
      prev[next] = cur;
      if (next === toId) {
        const path = [toId];
        let p = cur;
        while (p !== null) { path.unshift(p); p = prev[p]; }
        return path;
      }
      queue.push(next);
    }
  }
  return [fromId, toId];
}

// 2D segment vs solid boxes: true when the line of sight is blocked.
export function segmentBlocked(x0, z0, x1, z1) {
  for (const b of BLOCKS) {
    if (segHitsBox(x0, z0, x1, z1, b[0], b[1], b[2], b[3])) return true;
  }
  return false;
}

function segHitsBox(x0, z0, x1, z1, bx0, bz0, bx1, bz1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  // Slab test on both axes.
  let tmin = 0;
  let tmax = 1;
  const axes = [
    [dx, x0, bx0, bx1],
    [dz, z0, bz0, bz1],
  ];
  for (const [d, o, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
    } else {
      let a = (lo - o) / d;
      let b = (hi - o) / d;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > tmin) tmin = a;
      if (b < tmax) tmax = b;
      if (tmin > tmax) return false;
    }
  }
  return tmax >= 0 && tmin <= 1;
}

function concreteTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#565a63";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 78 + Math.floor(Math.random() * 26);
    g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    g.fillRect(Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), 2, 2);
  }
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 7);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildMap(scene) {
  const group = new THREE.Group();
  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x5a5e68, roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.85 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x7a4a28, roughness: 0.8, metalness: 0.25 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x2e5d5a, roughness: 0.75, metalness: 0.3 }),
    furnace: new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.6, emissive: 0xff5a00, emissiveIntensity: 0.55 }),
    silo: new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.5, metalness: 0.55 }),
    site: new THREE.MeshStandardMaterial({ color: 0x6b5518, roughness: 0.7, emissive: 0xffb400, emissiveIntensity: 0.12 }),
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(68, 48), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const box = (x0, z0, x1, z1, h, mat, y0 = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // Perimeter walls.
  box(-34, -24, 34, -22, 5, mats.wall);
  box(-34, 22, 34, 24, 5, mats.wall);
  box(-34, -24, -32, 24, 5, mats.wall);
  box(32, -24, 34, 24, 5, mats.wall);
  // Furnace block + glowing mouth.
  box(-26, -8, -18, 2, 6, mats.furnace);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshBasicMaterial({ color: 0xe86a12 }));
  mouth.position.set(-22, 1.4, 2.05);
  group.add(mouth);
  const glow = new THREE.PointLight(0xff6a00, 60, 26, 1.6);
  glow.position.set(-22, 2.5, 4);
  group.add(glow);
  // Silo cylinder.
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 7, 18), mats.silo);
  silo.position.set(22, 3.5, -2);
  silo.castShadow = true;
  group.add(silo);
  // Containers and crates.
  box(-12, -16, -4, -12, 3, mats.rust);
  box(8, 10, 16, 14, 3, mats.teal);
  box(-30, 8, -26, 12, 2, mats.rust);
  box(-10, 4, -6, 8, 2, mats.dark);
  box(2, -10, 6, -6, 2, mats.rust);
  box(12, -4, 16, 0, 2, mats.teal);
  box(-2, 12, 2, 16, 2, mats.dark);
  box(24, 12, 28, 16, 2, mats.rust);
  box(-16, 12, -12, 15, 2, mats.teal);
  box(20, -16, 24, -12, 2, mats.dark);
  // Mid pillars.
  box(-4, -3, -2, 3, 5, mats.wall);
  box(10, -3, 12, 3, 5, mats.wall);
  // Site barricades + site floor marker.
  box(-10, -13, -8, -11, 2, mats.rust);
  box(8, -13, 10, -11, 2, mats.rust);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), mats.site);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.02, -17);
  group.add(pad);
  // Pipes along the west wall.
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 40, 10), mats.dark);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(-31, 3.4, 0);
  group.add(pipe);
  // Sky glow: a big emissive dome tint.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(180, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x3a2c1c, side: THREE.BackSide, fog: false }),
  );
  group.add(sky);
  scene.add(group);
  return { group };
}
