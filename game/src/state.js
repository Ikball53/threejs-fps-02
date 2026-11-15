// state.js — the one place that holds all mutable match state.
// Nothing else in the game keeps its own copy of match facts: modules read
// and write this store, and the fixed-step loop in sim.js is the only writer
// of per-tick changes.

export const CFG = {
  roundsToWin: 7,
  roundTime: 100, // seconds of live play per round
  buyTime: 12, // seconds of buy phase before each round
  freezeTime: 2, // seconds of freeze at round start after buy
  plantTime: 3, // seconds to plant the Igniter
  defuseTime: 5, // seconds to defuse it
  fuseTime: 35, // seconds from plant to detonation
  startMoney: 800,
  killMoney: 300,
  winMoney: 3250,
  lossMoney: 1900,
  lossStreakBonus: 500, // extra per consecutive loss, capped at 2
  playerSpeed: 5.4,
  walkSpeed: 2.6,
  crouchSpeed: 2.8,
  botSpeed: 4.4,
  eyeHeight: 1.62,
  crouchEye: 1.12,
  gravity: 18,
  jumpSpeed: 6.2,
};

export const WEAPONS = {
  pistol: {
    name: "P9 SIDEARM", price: 0, damage: 26, headMult: 2.0, mag: 12, reserve: 120,
    rate: 0.16, reload: 1.1, spread: 0.011, moveSpread: 0.030, recoil: 0.011, auto: false,
    range: 60, zoom: 1.0, kick: 0.35,
  },
  scatter: {
    name: "SG-12 SCATTERGUN", price: 900, damage: 9, headMult: 1.6, mag: 6, reserve: 36,
    rate: 0.85, reload: 2.4, spread: 0.055, moveSpread: 0.075, recoil: 0.05, auto: false,
    range: 26, pellets: 8, zoom: 1.0, kick: 1.6,
  },
  smg: {
    name: "VK-9 SMG", price: 1200, damage: 22, headMult: 1.8, mag: 30, reserve: 120,
    rate: 0.085, reload: 1.6, spread: 0.016, moveSpread: 0.042, recoil: 0.009, auto: true,
    range: 45, zoom: 1.0, kick: 0.3,
  },
  carbine: {
    name: "AR-77 CARBINE", price: 2500, damage: 30, headMult: 2.0, mag: 30, reserve: 90,
    rate: 0.11, reload: 2.0, spread: 0.009, moveSpread: 0.036, recoil: 0.013, auto: true,
    range: 70, zoom: 1.15, kick: 0.5,
  },
  marksman: {
    name: "DMR-50 MARKSMAN", price: 4000, damage: 85, headMult: 2.2, mag: 5, reserve: 25,
    rate: 1.0, reload: 2.6, spread: 0.002, moveSpread: 0.05, recoil: 0.06, auto: false,
    range: 120, zoom: 2.4, kick: 2.2,
  },
};

export const GRENADES = {
  flash: { name: "FLASH", price: 200, radius: 14, fuse: 1.4 },
  smoke: { name: "SMOKE", price: 300, radius: 6, fuse: 1.2, life: 14 },
  he: { name: "HE CHARGE", price: 300, radius: 7, fuse: 1.6, damage: 90 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_ABSORB = 0.5; // half of a hit goes to armor while it lasts

export function freshMatch() {
  return {
    phase: "menu", // menu | buy | freeze | live | roundEnd | matchEnd
    phaseT: 0,
    round: 1,
    score: { ember: 0, slate: 0 },
    lossStreak: 0,
    money: CFG.startMoney,
    roundWinner: null,
    roundReason: "",
    matchWinner: null,
    core: { state: "carried", x: 0, z: 0, progress: 0, fuse: 0, carrier: "player" },
    time: 0,
    roundClock: CFG.buyTime,
    kills: { ember: 0, slate: 0 },
  };
}

export function freshFighter(id, team, x, z, yaw) {
  return {
    id, team, x, z, yaw, pitch: 0,
    vx: 0, vz: 0, vy: 0, grounded: true,
    hp: 100, armor: 0, alive: true,
    weapon: "pistol",
    ammo: { pistol: { mag: 12, reserve: 120 } },
    nades: { flash: 0, smoke: 0, he: 0 },
    spread: 0, recoil: 0, lastShot: -9, reloadUntil: 0, reloading: false,
    crouched: false, moving: false, aiming: false,
    flashUntil: 0, flashPower: 0,
    // bot-only fields, ignored for the player
    bot: null,
  };
}

export function aliveOf(fighters, team) {
  let n = 0;
  for (const f of fighters) if (f.team === team && f.alive) n += 1;
  return n;
}

export function teamOf(fighters, team) {
  return fighters.filter((f) => f.team === team);
}
