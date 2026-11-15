// shots.js — screenshot staging: poses the match for the four screenshots
// the entry ships. A ?shot=<name> URL parameter picks the scene; the game
// then starts itself with no click and no pointer lock, and the frame stays
// frozen on the staged pose so the capture is deterministic.

import { MAP } from "./map.js";

function place(f, x, z, yaw) {
  f.x = x;
  f.z = z;
  f.yaw = yaw;
  f.alive = true;
  f.hp = 100;
  f.y = 0;
  if (f.bot) {
    f.bot.route = [];
    f.bot.target = null;
    f.bot.investigate = null;
  }
}

export function applyShot(sim, kind) {
  const { match, fighters, player } = sim;
  const embers = fighters.filter((f) => f.team === "ember" && f !== player);
  const slates = fighters.filter((f) => f.team === "slate");
  match.phase = "live";
  match.roundClock = 92;
  match.round = 3;
  match.score = { ember: 2, slate: 1 };
  player.money = 2350;
  player.weapon = "carbine";
  player.ammo.carbine = { mag: 30, reserve: 90 };
  player.hp = 100;
  player.armor = 50;

  if (kind === "cover") {
    place(player, 0, 12, 0);
    player.pitch = 0.02;
    place(slates[0], 7, -4, Math.PI * 0.75);
    place(slates[1], -5, -8, Math.PI * 0.9);
    place(slates[2], -14, -12, Math.PI);
    place(embers[0], -4, 7, 0.15);
    place(embers[1], 6, 9, -0.2);
    embers[2].alive = false;
    slates[3].alive = false;
    slates[4].alive = false;
    return { tracer: null, sparks: null, smoke: null, banner: null };
  }
  if (kind === "fight") {
    place(player, 0, 4, -0.27);
    player.pitch = 0.0;
    place(slates[0], 2.5, -5, Math.PI - 0.3);
    slates[0].hp = 45;
    place(slates[1], -9, -2, Math.PI * 0.8);
    place(embers[0], -5, 8, 0.3);
    slates[2].alive = false;
    slates[3].alive = false;
    slates[4].alive = false;
    return {
      tracer: { from: { x: 0.3, y: 1.5, z: 3.4 }, to: { x: 2.5, y: 1.3, z: -5 } },
      sparks: { x: 2.5, y: 1.3, z: -5 },
      smoke: null,
      banner: null,
    };
  }
  if (kind === "site") {
    place(player, 3, -13, 0.5);
    player.pitch = -0.05;
    player.weapon = "smg";
    player.ammo.smg = { mag: 30, reserve: 120 };
    match.core = { state: "planted", x: 0, z: -17, progress: 0, fuse: 12, carrier: "player" };
    place(slates[0], -6, -11, Math.PI * 0.6);
    place(slates[1], 8, -14, Math.PI * 1.2);
    place(embers[0], -2, -9, 0.4);
    slates[2].alive = false;
    slates[3].alive = false;
    slates[4].alive = false;
    // Fallen defenders at the site edges, out of the centre of frame.
    slates[2].x = -8; slates[2].z = -20; slates[2].yaw = 1.2;
    slates[3].x = 8; slates[3].z = -19; slates[3].yaw = -0.8;
    slates[4].x = -7; slates[4].z = -10; slates[4].yaw = 2.4;
    return {
      tracer: null,
      sparks: null,
      smoke: { x: 6, y: 1.2, z: -14 },
      banner: { big: "IGNITER PLANTED", sub: "Hold the Reactor — 12 seconds to detonation", color: "#ffb454" },
    };
  }
  // buy
  match.phase = "buy";
  match.roundClock = 12;
  player.money = 4200;
  place(player, 0, 18, Math.PI);
  place(embers[0], -4, 16, Math.PI * 0.9);
  place(embers[1], 4, 16, Math.PI * 1.1);
  for (const s of slates) s.alive = false;
  return { tracer: null, sparks: null, smoke: null, banner: null, buy: true };
}

export function shotKind() {
  const q = new URLSearchParams(window.location.search);
  return q.get("shot");
}
