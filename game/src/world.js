// world.js — builds the Ember Yard map: geometry, colliders, waypoints, site.
// Palette: dusk slate + amber hazard paint. All colliders are AABBs in `solids`.

import * as THREE from 'three';

export const MAP = { halfX: 24, halfZ: 18 };
export const SITE = { x: 17, z: -12, r: 4.5 }; // bombsite "Furnace A"
export const SPAWN = { x: 0, z: 14, yaw: 0 }; // yaw 0 faces -z (north, toward the site)

const _v = new THREE.Vector3();

// Every solid: {x0,z0,x1,z1,y0,y1} — y1 is the top; y0 is the base (0 for walls).
export function buildWorld(scene) {
  const solids = [];
  const addSolid = (x0, z0, x1, z1, y0, y1) => {
    solids.push({ x0, z0, x1, z1, y0, y1 });
    return solids[solids.length - 1];
  };

  const matGround = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.95 });
  const matWall = new THREE.MeshStandardMaterial({ color: 0x6b6f78, roughness: 0.9 });
  const matWallDark = new THREE.MeshStandardMaterial({ color: 0x3c3f47, roughness: 0.9 });
  const matCrate = new THREE.MeshStandardMaterial({ color: 0x8a6b3f, roughness: 0.85 });
  const matCrate2 = new THREE.MeshStandardMaterial({ color: 0x5d6e52, roughness: 0.85 });
  const matHazard = new THREE.MeshStandardMaterial({ color: 0xd98a1f, roughness: 0.7 });
  const matSite = new THREE.MeshStandardMaterial({ color: 0xc2502a, roughness: 0.8, emissive: 0x531505, emissiveIntensity: 0.6 });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0x2f333a, roughness: 0.55, metalness: 0.55 });
  const matGlass = new THREE.MeshStandardMaterial({ color: 0x9fd4e0, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.35 });

  const box = (mat, w, h, d, x, y, z, solid = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    if (solid) addSolid(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y - h / 2, y + h / 2);
    return m;
  };

  // Ground slab + painted lane strips
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(52, 40), matGround);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const strip = (x, z, w, d, mat) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    s.rotation.x = -Math.PI / 2; s.position.set(x, 0.02, z); s.receiveShadow = true;
    scene.add(s);
  };
  strip(0, 0, 3, 36, new THREE.MeshStandardMaterial({ color: 0x55565e, roughness: 1 })); // mid lane
  strip(-19, 0, 3, 36, new THREE.MeshStandardMaterial({ color: 0x505158, roughness: 1 })); // west lane
  strip(19, 0, 3, 36, new THREE.MeshStandardMaterial({ color: 0x505158, roughness: 1 })); // east lane

  // Perimeter walls (height 4)
  box(matWall, 50, 4, 1, 0, 2, -18.5);
  box(matWall, 50, 4, 1, 0, 2, 18.5);
  box(matWall, 1, 4, 38, -24.5, 2, 0);
  box(matWall, 1, 4, 38, 24.5, 2, 0);

  // Mid cross-wall with two gaps (the map's central fight)
  box(matWallDark, 14, 3.2, 1, -15, 1.6, 0);      // west block
  box(matWallDark, 10, 3.2, 1, 9, 1.6, 0);        // east block
  box(matWallDark, 1, 3.2, 12, 2, 1.6, -6);       // north spur, leaves mid gap
  box(matWallDark, 1, 3.2, 8, 2, 1.6, 10);        // south spur

  // Furnace hall around bombsite A (north-east): big furnace + pillars
  box(matMetal, 4, 5, 4, 21, 2.5, -15);
  box(matWallDark, 1.2, 4.5, 1.2, 13, 2.25, -15);
  box(matWallDark, 1.2, 4.5, 1.2, 13, 2.25, -8);
  box(matHazard, 2.2, 0.3, 0.6, 17, 1.5, -16.4); // hazard beam over site entry

  // Crates: cover on every lane (varied heights for sightline play)
  box(matCrate, 2, 1.2, 2, -10, 0.6, -8);
  box(matCrate, 2, 1.2, 2, -8, 0.6, -8, true);
  box(matCrate2, 1.6, 2.2, 1.6, -9, 1.1, -9.6);
  box(matCrate, 2.4, 1.2, 1.4, -19, 0.6, 4);
  box(matCrate2, 2, 1.2, 2, -19, 0.6, -6);
  box(matCrate, 2, 1.2, 2, 8, 0.6, 8);
  box(matCrate2, 2, 1.2, 2, 10, 0.6, 8);
  box(matCrate, 1.6, 2.4, 1.6, 9, 1.2, 6.4);
  box(matCrate, 2, 1.2, 2, 19, 0.6, 6);
  box(matCrate2, 2, 1.2, 2, 14, 0.6, -4);
  box(matCrate, 1.8, 1.0, 1.8, 5, 0.5, -12);
  box(matCrate2, 1.8, 1.0, 1.8, -14, 0.5, 12);
  // Stacked crates near site for plant cover
  box(matCrate, 2, 1.2, 2, 15, 0.6, -9);
  box(matCrate2, 1.6, 1.2, 1.6, 15.2, 1.8, -9);

  // Glass skylight frame over mid (visual only, no solid)
  const sky = new THREE.Mesh(new THREE.BoxGeometry(10, 0.15, 6), matGlass);
  sky.position.set(0, 4.6, -2); scene.add(sky);
  box(matMetal, 10.4, 0.4, 0.4, 0, 4.6, -5.2, false);
  box(matMetal, 10.4, 0.4, 0.4, 0, 4.6, 1.2, false);

  // Bombsite pad: glowing ring + letter marker
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(SITE.r, SITE.r, 0.08, 28), matSite);
  pad.position.set(SITE.x, 0.04, SITE.z); pad.receiveShadow = true;
  scene.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(SITE.r, 0.12, 8, 40),
    new THREE.MeshStandardMaterial({ color: 0xffa63d, emissive: 0x8a3c00, emissiveIntensity: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(SITE.x, 0.1, SITE.z);
  scene.add(ring);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 8),
    new THREE.MeshStandardMaterial({ color: 0xffa63d, emissive: 0xff7a00, emissiveIntensity: 1.4 }));
  beacon.position.set(SITE.x, 3, SITE.z); scene.add(beacon);

  // Scattered pipes / barrels for silhouette
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.7, metalness: 0.3 });
  for (const [bx, bz] of [[-21, -14], [-21, -12.8], [21, 12], [22.2, 12], [-4, -16]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12), barrelMat);
    b.position.set(bx, 0.65, bz); b.castShadow = true; scene.add(b);
    addSolid(bx - 0.55, bz - 0.55, bx + 0.55, bz + 0.55, 0, 1.3);
  }

  // Waypoint graph the bots patrol/hold on (lanes + site + mid)
  const waypoints = [
    { x: -19, z: -12, links: [1, 4] },
    { x: -19, z: 0, links: [0, 2, 5] },
    { x: -19, z: 12, links: [1, 3] },
    { x: -8, z: 12, links: [2, 6] },
    { x: -10, z: -12, links: [0, 5, 7] },
    { x: -4, z: -2, links: [1, 4, 6, 8] },   // mid crossroads
    { x: 0, z: 12, links: [3, 5, 9] },
    { x: -2, z: -13, links: [4, 8] },
    { x: 8, z: -12, links: [5, 7, 10] },
    { x: 8, z: 12, links: [6, 10] },
    { x: 17, z: -12, links: [8, 9, 11] },     // site A
    { x: 20, z: -4, links: [10] },
    { x: 0, z: 14, links: [6] },               // attacker spawn
  ];
  return { solids, waypoints };
}

// AABB collision: circle (px,pz,r) vs solids, only walls taller than eyeBase block.
// Returns corrected {x,z} after sliding along each solid.
export function collide(solids, px, pz, r, eyeY) {
  let x = px, z = pz;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    void eyeY; // body collision: any solid taller than the waist blocks, even if below eye level
    if (s.y1 < 0.9) continue; // low pad, walkable
    const cx = Math.max(s.x0, Math.min(x, s.x1));
    const cz = Math.max(s.z0, Math.min(z, s.z1));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      x = cx + (dx / d) * r;
      z = cz + (dz / d) * r;
    } else {
      // centre inside the box: push out along the smallest penetration axis
      const pl = x - s.x0, pr = s.x1 - x, pt = z - s.z0, pb = s.z1 - z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = s.x0 - r; else if (m === pr) x = s.x1 + r;
      else if (m === pt) z = s.z0 - r; else z = s.z1 + r;
    }
  }
  return { x, z };
}

// Segment vs solid AABBs (2D, for line-of-sight). Returns true when blocked.
export function losBlocked(solids, ax, az, bx, bz, eyeY = 1.5) {
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (s.y1 < eyeY - 0.05) continue; // below the sight line
    if (segmentHitsBox(ax, az, bx, bz, s)) return true;
  }
  return false;
}

function segmentHitsBox(ax, az, bx, bz, s) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  const axes = [
    [-dx, ax - s.x0], [dx, s.x1 - ax],
    [-dz, az - s.z0], [dz, s.z1 - az],
  ];
  for (let i = 0; i < 4; i++) {
    const p = axes[i][0], q = axes[i][1];
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; }
    else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

// Ray vs solids for bullets: returns distance to first wall hit (or Infinity).
export function rayHitWall(solids, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = Infinity;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    const t = rayBox(ox, oy, oz, dx, dy, dz, s);
    if (t !== null && t < best && t <= maxDist) best = t;
  }
  return best;
}

function rayBox(ox, oy, oz, dx, dy, dz, s) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [s.x0, s.y0, s.z0], mx = [s.x1, s.y1, s.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return null; }
    else {
      let a = (mn[i] - o[i]) / d[i], b = (mx[i] - o[i]) / d[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > tmin) tmin = a;
      if (b < tmax) tmax = b;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

export function eyePos(p) {
  _v.set(p.pos.x, p.crouch ? 1.05 : 1.62, p.pos.z);
  return _v;
}
