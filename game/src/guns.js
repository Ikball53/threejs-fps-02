// The arsenal: weapons, grenades and gear for IRONVEIL.
//
// Every weapon is a distinct tool, not a reskin. Each one carries:
//   - damage and the ranges over which it falls off with distance
//   - a fire rate, a magazine, and a reserve pool
//   - a spread model: a base cone that widens while moving, while airborne,
//     and with every shot fired in a burst (bloom), then recovers
//   - a recoil pattern: a fixed list of pitch/yaw kicks, one per shot in a
//     spray, so a spray can be learned and controlled like a real one
//   - an aim-down-sights zoom and a movement penalty while aiming
//   - a price in the buy menu
//
// Headshots multiply damage. Armour absorbs part of every hit until it
// breaks. All numbers are tuned so a rifle kills an unarmoured fighter in
// four body shots at mid range, and a headshot changes the fight.

export const WEAPONS = {
  // The default sidearm every fighter carries. Weak, but free and fast.
  pistol: {
    id: 'pistol',
    name: 'P9 Sidearm',
    kind: 'pistol',
    price: 0,
    damage: 26,
    headMul: 3.0,
    falloff: { near: 12, far: 30, farMul: 0.55 },
    fireInterval: 0.16,
    auto: false,
    mag: 12,
    reserve: 36,
    reloadSeconds: 1.4,
    spreadBase: 0.011,
    spreadMove: 0.016,
    spreadAir: 0.05,
    bloomPerShot: 0.0028,
    bloomMax: 0.05,
    bloomRecover: 0.09,
    recoilKick: 0.012,
    // A short, forgiving pattern: mostly straight up, slight drift.
    recoilPattern: [
      [0.011, 0.0], [0.012, 0.004], [0.012, -0.004], [0.013, 0.003],
      [0.013, -0.003], [0.014, 0.002], [0.014, -0.002], [0.015, 0.004],
      [0.015, -0.004], [0.016, 0.0], [0.016, 0.003], [0.017, -0.003],
    ],
    adsZoom: 1.15,
    adsSpreadMul: 0.55,
    moveSpeed: 5.6,
    tracer: 0xffd27a,
  },

  // The workhorse rifle: accurate, controllable, the default buy.
  rifle: {
    id: 'rifle',
    name: 'VK-47 Longshot',
    kind: 'rifle',
    price: 2700,
    damage: 34,
    headMul: 3.4,
    falloff: { near: 18, far: 45, farMul: 0.6 },
    fireInterval: 0.11,
    auto: true,
    mag: 30,
    reserve: 90,
    reloadSeconds: 2.3,
    spreadBase: 0.008,
    spreadMove: 0.014,
    spreadAir: 0.045,
    bloomPerShot: 0.0022,
    bloomMax: 0.055,
    bloomRecover: 0.075,
    recoilKick: 0.011,
    // The classic: climbs, then pulls left, then right, then settles.
    recoilPattern: [
      [0.010, 0.0], [0.011, 0.002], [0.011, -0.001], [0.012, -0.004],
      [0.012, -0.007], [0.013, -0.008], [0.013, -0.006], [0.013, -0.002],
      [0.014, 0.003], [0.014, 0.007], [0.014, 0.008], [0.014, 0.006],
      [0.015, 0.002], [0.015, -0.002], [0.015, -0.005], [0.015, -0.007],
      [0.015, -0.004], [0.016, 0.001], [0.016, 0.004], [0.016, 0.006],
      [0.016, 0.003], [0.016, 0.0], [0.016, -0.003], [0.016, -0.005],
      [0.017, -0.002], [0.017, 0.002], [0.017, 0.004], [0.017, 0.002],
      [0.017, 0.0], [0.017, -0.002],
    ],
    adsZoom: 1.25,
    adsSpreadMul: 0.45,
    moveSpeed: 5.0,
    tracer: 0xffe08a,
  },

  // Fast carbine: weaker per shot, but a tighter spray and quicker handling.
  carbine: {
    id: 'carbine',
    name: 'KX-9 Carbine',
    kind: 'rifle',
    price: 2300,
    damage: 28,
    headMul: 3.2,
    falloff: { near: 14, far: 38, farMul: 0.55 },
    fireInterval: 0.095,
    auto: true,
    mag: 25,
    reserve: 100,
    reloadSeconds: 2.0,
    spreadBase: 0.009,
    spreadMove: 0.012,
    spreadAir: 0.04,
    bloomPerShot: 0.0018,
    bloomMax: 0.045,
    bloomRecover: 0.085,
    recoilKick: 0.009,
    recoilPattern: [
      [0.009, 0.0], [0.010, 0.001], [0.010, -0.002], [0.011, -0.004],
      [0.011, -0.005], [0.012, -0.003], [0.012, 0.0], [0.012, 0.003],
      [0.013, 0.005], [0.013, 0.004], [0.013, 0.001], [0.013, -0.002],
      [0.014, -0.004], [0.014, -0.003], [0.014, 0.0], [0.014, 0.003],
      [0.014, 0.004], [0.015, 0.002], [0.015, 0.0], [0.015, -0.002],
      [0.015, -0.003], [0.015, -0.001], [0.015, 0.002], [0.015, 0.003],
      [0.015, 0.001],
    ],
    adsZoom: 1.3,
    adsSpreadMul: 0.5,
    moveSpeed: 5.2,
    tracer: 0x9fd8ff,
  },

  // Close-quarters SMG: a hose at short range, harmless past mid range.
  smg: {
    id: 'smg',
    name: 'Raptor SMG',
    kind: 'smg',
    price: 1600,
    damage: 22,
    headMul: 3.0,
    falloff: { near: 8, far: 22, farMul: 0.45 },
    fireInterval: 0.075,
    auto: true,
    mag: 32,
    reserve: 96,
    reloadSeconds: 1.8,
    spreadBase: 0.013,
    spreadMove: 0.01,
    spreadAir: 0.04,
    bloomPerShot: 0.0016,
    bloomMax: 0.05,
    bloomRecover: 0.1,
    recoilKick: 0.007,
    recoilPattern: [
      [0.008, 0.0], [0.008, 0.003], [0.009, -0.003], [0.009, 0.004],
      [0.009, -0.004], [0.010, 0.003], [0.010, -0.003], [0.010, 0.002],
      [0.011, -0.002], [0.011, 0.003], [0.011, -0.003], [0.011, 0.0],
      [0.012, 0.002], [0.012, -0.002], [0.012, 0.003], [0.012, -0.003],
      [0.012, 0.0], [0.013, 0.002], [0.013, -0.002], [0.013, 0.001],
      [0.013, -0.001], [0.013, 0.002], [0.013, -0.002], [0.013, 0.0],
      [0.014, 0.001], [0.014, -0.001], [0.014, 0.0], [0.014, 0.001],
      [0.014, -0.001], [0.014, 0.0], [0.014, 0.001], [0.014, -0.001],
    ],
    adsZoom: 1.2,
    adsSpreadMul: 0.55,
    moveSpeed: 5.5,
    tracer: 0xa8ff9e,
  },

  // The long gun: one shot, one kill to the body at any range, but slow,
  // loud, and it punishes a miss. Aiming down sights is nearly a scope.
  sniper: {
    id: 'sniper',
    name: 'Longbow .50',
    kind: 'sniper',
    price: 4200,
    damage: 110,
    headMul: 2.2,
    falloff: { near: 30, far: 60, farMul: 0.9 },
    fireInterval: 1.25,
    auto: false,
    mag: 5,
    reserve: 15,
    reloadSeconds: 3.2,
    spreadBase: 0.001,
    spreadMove: 0.05,
    spreadAir: 0.12,
    bloomPerShot: 0.02,
    bloomMax: 0.06,
    bloomRecover: 0.05,
    recoilKick: 0.055,
    recoilPattern: [
      [0.05, 0.0], [0.052, 0.004], [0.052, -0.004], [0.054, 0.002], [0.054, -0.002],
    ],
    adsZoom: 2.4,
    adsSpreadMul: 0.2,
    moveSpeed: 4.4,
    tracer: 0xff9a6a,
  },

  // The room-clearer: eight pellets per shell, devastating up close.
  shotgun: {
    id: 'shotgun',
    name: 'Breacher 12G',
    kind: 'shotgun',
    price: 1900,
    damage: 13,
    headMul: 2.0,
    pellets: 8,
    falloff: { near: 6, far: 16, farMul: 0.3 },
    fireInterval: 0.8,
    auto: false,
    mag: 6,
    reserve: 24,
    reloadSeconds: 2.6,
    spreadBase: 0.045,
    spreadMove: 0.02,
    spreadAir: 0.05,
    bloomPerShot: 0.01,
    bloomMax: 0.06,
    bloomRecover: 0.07,
    recoilKick: 0.04,
    recoilPattern: [
      [0.035, 0.0], [0.037, 0.005], [0.037, -0.005], [0.038, 0.003],
      [0.038, -0.003], [0.04, 0.0],
    ],
    adsZoom: 1.15,
    adsSpreadMul: 0.7,
    moveSpeed: 5.1,
    tracer: 0xffc46a,
  },
};

// ---------------------------------------------------------------------------
// Grenades and gear.
// ---------------------------------------------------------------------------
export const GRENADES = {
  flash: {
    id: 'flash',
    name: 'Flashbang',
    price: 250,
    blurb: 'Blinds anyone looking at the burst for up to 2.5 seconds.',
  },
  smoke: {
    id: 'smoke',
    name: 'Smoke Grenade',
    price: 300,
    blurb: 'A wall of smoke that blocks vision for 14 seconds.',
  },
  he: {
    id: 'he',
    name: 'HE Grenade',
    price: 350,
    blurb: 'Explodes for up to 95 damage, less with distance and cover.',
  },
};

export const GEAR = {
  kevlar: { id: 'kevlar', name: 'Kevlar Vest', price: 650, armor: 50 },
  helmet: { id: 'helmet', name: 'Helmet', price: 400, armorHead: 50 },
  defuseKit: { id: 'defuseKit', name: 'Defuse Kit', price: 400, defuseTime: 5 },
};

/** Damage of a weapon at a given range, before armour and headshot. */
export function damageAt(weapon, dist) {
  const f = weapon.falloff;
  if (dist <= f.near) return weapon.damage;
  if (dist >= f.far) return weapon.damage * f.farMul;
  const t = (dist - f.near) / (f.far - f.near);
  return weapon.damage * (1 - (1 - f.farMul) * t);
}

/** The recoil kick of the n-th shot in a spray (pattern loops). */
export function recoilAt(weapon, shotIndex) {
  const pattern = weapon.recoilPattern;
  return pattern[shotIndex % pattern.length];
}
