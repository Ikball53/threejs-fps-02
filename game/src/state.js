// state.js — the single game state object and every tuning constant.
// Nothing here touches the renderer; every other module reads/writes `S`.

export const SIM_DT = 1 / 60;
export const ROUND_TIME = 100;
export const BUY_TIME = 18;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5.0;
export const BOMB_TIME = 35;
export const MAX_ROUNDS = 9; // first to 5 wins the match
export const WIN_ROUNDS = 5;

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Falcon P9', slot: 1, price: 0, auto: false,
    damage: 26, headMult: 2.6, fireMs: 260, mag: 12, reserveMax: 48,
    reloadMs: 1400, spread: 0.006, moveSpread: 0.030, recoil: 0.011,
    range: 60, tracer: 0xffd27a,
  },
  rifle: {
    id: 'rifle', name: 'Kestrel VK-7', slot: 2, price: 2700, auto: true,
    damage: 33, headMult: 4.0, fireMs: 108, mag: 25, reserveMax: 75,
    reloadMs: 2200, spread: 0.010, moveSpread: 0.042, recoil: 0.021,
    range: 90, tracer: 0xffe9a8,
  },
  grenade: {
    id: 'grenade', name: 'Spark Grenade', slot: 3, price: 300, auto: false,
    damage: 95, headMult: 1, fireMs: 700, mag: 1, reserveMax: 2,
    reloadMs: 0, spread: 0, moveSpread: 0, recoil: 0.004,
    range: 0, tracer: 0xff9a3c, blastRadius: 5.5, fuse: 1.4,
  },
};

export const BUY_ITEMS = [
  { key: '1', id: 'rifle', label: 'Kestrel VK-7 rifle', price: 2700 },
  { key: '2', id: 'grenade', label: 'Spark Grenade', price: 300 },
  { key: '3', id: 'ammo', label: 'Refill rifle ammo', price: 400 },
  { key: '4', id: 'armor', label: 'Plated vest (+50 armor)', price: 650 },
  { key: '5', id: 'pistol_ammo', label: 'Refill pistol ammo', price: 150 },
];

export function makeState() {
  return {
    phase: 'menu', // menu | buy | live | planted | over | matchover
    time: 0,
    round: 1,
    roundClock: ROUND_TIME,
    buyClock: BUY_TIME,
    scoreYou: 0,
    scoreFoe: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    bombPlanted: false,
    bombTimer: 0,
    bombPos: null,
    plantProgress: 0,
    defuseProgress: 0,
    plantedBy: null,
    roundMsg: '',
    roundMsgUntil: 0,
    winner: null,
    matchWinner: null,
    // player
    player: {
      pos: { x: 0, y: 0, z: 14 },
      vel: { x: 0, z: 0 },
      yaw: 0, pitch: 0,
      hp: 100, armor: 0,
      alive: true,
      crouch: false,
      moving: false,
      speed2d: 0,
      weapon: 'pistol',
      weapons: {
        pistol: { mag: 12, reserve: 48, owned: true },
        rifle: { mag: 0, reserve: 0, owned: false },
        grenade: { mag: 0, reserve: 0, owned: false },
      },
      reloading: 0,
      fireCooldown: 0,
      spreadBloom: 0,
      recoilPitch: 0,
      lastShotAt: -99,
      heardAt: 0,
    },
    bots: [],
    grenades: [],
    tracers: [],
    flashes: [],
    feed: [],
    keys: {},
    pointerLocked: false,
    demo: null,
  };
}
