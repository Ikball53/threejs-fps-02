// sim.js — the fixed-step simulation: rounds, the buy phase, planting and
// defusing, damage and death, the economy. One job: advance the match by one
// 1/60s tick. Rendering, sound and the HUD only read what it emits.

import { BLOCKS, MAP, NODES } from "./map.js";
import { CFG, WEAPONS, GRENADES, ARMOR_PRICE, ARMOR_ABSORB, freshMatch, freshFighter, aliveOf } from "./state.js";
import { stepFighter, eyeHeight } from "./mover.js";
import { fireShot, startReload, finishReload, stepGrenades, throwGrenade } from "./arms.js";
import { makeBot, assignHolds, stepBot, hearShot, CALLSIGNS } from "./bots.js";

const STEP = 1 / 60;

export function createSim() {
  const match = freshMatch();
  const fighters = [];
  const player = freshFighter("player", "ember", MAP.attackerSpawn.x, MAP.attackerSpawn.z, MAP.attackerSpawn.yaw);
  player.name = "YOU";
  fighters.push(player);
  for (let i = 0; i < 4; i++) {
    const b = freshFighter(`ember-${i}`, "ember", MAP.attackerSpawn.x + (i - 1.5) * 2.2, MAP.attackerSpawn.z + 3, MAP.attackerSpawn.yaw);
    b.name = CALLSIGNS.ember[i];
    b.bot = makeBot(b, 0.45 + Math.random() * 0.35);
    fighters.push(b);
  }
  const defSpots = ["dSpawn", "dWest", "dEast", "site", "midN"];
  for (let i = 0; i < 5; i++) {
    const n = NODES[defSpots[i]];
    const b = freshFighter(`slate-${i}`, "slate", n.x, n.z, 0);
    b.name = CALLSIGNS.slate[i];
    b.bot = makeBot(b, 0.4 + Math.random() * 0.4);
    fighters.push(b);
  }
  assignHolds(fighters);
  const sim = {
    match, fighters, player,
    grenades: [], smokes: [], tracers: [],
    events: [], time: 0, acc: 0,
    flashFx: 0,
  };
  // Bots read the smoke list through the match; keep one shared array.
  match.smokes = sim.smokes;
  return sim;
}

function spawnRound(sim) {
  const { match, fighters, player } = sim;
  // Attackers regroup at the south spawn, defenders at the north.
  let ai = 0;
  let di = 0;
  for (const f of fighters) {
    f.alive = true;
    f.hp = 100;
    f.recoil = 0;
    f.reloading = false;
    f.flashUntil = 0;
    f.y = 0;
    f.vy = 0;
    if (f.team === "ember") {
      f.x = MAP.attackerSpawn.x + (ai - 2) * 2.4 + (Math.random() - 0.5) * 1.5;
      f.z = MAP.attackerSpawn.z + (ai % 2) * 2.5;
      f.yaw = MAP.attackerSpawn.yaw;
      ai += 1;
      if (f !== player && !f.bot) f.bot = makeBot(f, 0.5);
      if (f.bot) { f.bot.route = []; f.bot.target = null; f.bot.investigate = null; }
    } else {
      const spots = ["dSpawn", "dWest", "dEast", "site", "midN"];
      const n = NODES[spots[di % spots.length]];
      f.x = n.x + (Math.random() - 0.5) * 2;
      f.z = n.z + (Math.random() - 0.5) * 2;
      f.yaw = 0;
      di += 1;
      if (f.bot) { f.bot.route = []; f.bot.target = null; f.bot.investigate = null; }
    }
    // Dead fighters last round lose their kit; survivors keep theirs.
    if (f.lostKit) {
      f.weapon = "pistol";
      f.ammo = { pistol: { mag: 12, reserve: 120 } };
      f.armor = 0;
      f.lostKit = false;
    }
  }
  // The Igniter starts with the player.
  match.core = { state: "carried", x: 0, z: 0, progress: 0, fuse: 0, carrier: "player" };
  player.armor = player.armor ?? 0;
  sim.grenades = [];
  sim.smokes = [];
  sim.tracers = [];
}

function botBuy(sim) {
  // Bots arm up by round: early rounds SMG, later carbine or marksman.
  const r = sim.match.round;
  for (const f of sim.fighters) {
    if (f === sim.player || !f.alive) continue;
    const roll = Math.random();
    let pick = "smg";
    if (r >= 3 && roll < 0.45) pick = "carbine";
    else if (r >= 4 && roll < 0.6) pick = "marksman";
    else if (roll < 0.25) pick = "scatter";
    const def = WEAPONS[pick];
    f.weapon = pick;
    f.ammo[pick] = { mag: def.mag, reserve: def.reserve };
    if (Math.random() < 0.4) f.armor = 50;
    f.nades = { flash: Math.random() < 0.5 ? 1 : 0, smoke: Math.random() < 0.4 ? 1 : 0, he: Math.random() < 0.4 ? 1 : 0 };
  }
}

export function startMatch(sim) {
  sim.match.phase = "buy";
  sim.match.roundClock = CFG.buyTime;
  spawnRound(sim);
  botBuy(sim);
}

function endRound(sim, winner, reason) {
  const { match, player } = sim;
  match.phase = "roundEnd";
  match.phaseT = 0;
  match.roundWinner = winner;
  match.roundReason = reason;
  match.score[winner] += 1;
  // Economy.
  if (winner === "ember") {
    player.money += CFG.winMoney;
    match.lossStreak = 0;
  } else {
    player.money += CFG.lossMoney + Math.min(2, match.lossStreak) * CFG.lossStreakBonus;
    match.lossStreak += 1;
  }
  for (const f of sim.fighters) if (!f.alive) f.lostKit = true;
  sim.events.push({ type: "round", winner, reason });
  if (match.score[winner] >= CFG.roundsToWin) {
    match.phase = "matchEnd";
    match.matchWinner = winner;
    sim.events.push({ type: "match", winner });
  }
}

function applyDamage(sim, victim, damage, attacker, part) {
  if (!victim.alive) return;
  let rest = damage;
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, Math.round(rest * ARMOR_ABSORB));
    victim.armor -= absorbed;
    rest -= absorbed;
  }
  victim.hp -= rest;
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.alive = false;
    victim.lostKit = true;
    sim.events.push({
      type: "kill", killer: attacker, victim, headshot: part === "head",
    });
    if (attacker && attacker.team === "ember" && attacker === sim.player) {
      sim.player.money += CFG.killMoney;
    }
    // The Igniter drops where its carrier fell; the nearest living Ember
    // fighter becomes the new carrier.
    if (sim.match.core.state === "carried" && sim.match.core.carrier === victim.id) {
      const carrier = sim.fighters.find((f) => f.team === "ember" && f.alive);
      if (carrier) {
        sim.match.core.carrier = carrier.id;
        sim.match.core.progress = 0;
        if (carrier !== sim.player) sim.events.push({ type: "carrier", fighter: carrier });
      } else {
        sim.match.core.state = "dropped";
        sim.match.core.x = victim.x;
        sim.match.core.z = victim.z;
      }
    }
  }
}

function burstGrenade(sim, g) {
  const { fighters } = sim;
  if (g.kind === "flash") {
    for (const f of fighters) {
      if (!f.alive) continue;
      const dx = f.x - g.x;
      const dz = f.z - g.z;
      const d = Math.hypot(dx, dz);
      if (d > GRENADES.flash.radius) continue;
      // Only blinds fighters facing the burst with a clear line.
      const fx = -Math.sin(f.yaw);
      const fz = -Math.cos(f.yaw);
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (dot > -0.2) {
        f.flashUntil = sim.time + Math.max(0.6, 2.4 - d * 0.12);
        f.flashPower = 1;
      }
    }
    sim.events.push({ type: "flash", x: g.x, y: g.y, z: g.z });
  } else if (g.kind === "smoke") {
    sim.smokes.push({ x: g.x, y: 1.2, z: g.z, until: sim.time + GRENADES.smoke.life });
    sim.events.push({ type: "smoke", x: g.x, z: g.z });
  } else if (g.kind === "he") {
    sim.events.push({ type: "he", x: g.x, y: g.y, z: g.z });
    for (const f of fighters) {
      if (!f.alive || f === g.owner) continue;
      const d = Math.hypot(f.x - g.x, f.z - g.z);
      if (d < GRENADES.he.radius) {
        const dmg = Math.round(GRENADES.he.damage * (1 - d / GRENADES.he.radius));
        applyDamage(sim, f, dmg, g.owner, "body");
      }
    }
  }
}

function eyeOf(f) {
  return { x: f.x, y: (f.y ?? 0) + eyeHeight(f), z: f.z };
}

function aimFrom(f) {
  const cp = Math.cos(f.pitch);
  return {
    x: -Math.sin(f.yaw) * cp,
    y: Math.sin(f.pitch),
    z: -Math.cos(f.yaw) * cp,
  };
}

export function stepSim(sim, input, dt) {
  const { match, player } = sim;
  sim.time += dt;
  const time = sim.time;

  if (match.phase === "buy") {
    match.roundClock -= dt;
    if (match.roundClock <= 0) {
      match.phase = "freeze";
      match.phaseT = 0;
      match.roundClock = CFG.freezeTime;
      sim.events.push({ type: "freeze" });
    }
    return;
  }
  if (match.phase === "freeze") {
    match.phaseT += dt;
    if (match.phaseT >= CFG.freezeTime) {
      match.phase = "live";
      match.roundClock = CFG.roundTime;
      sim.events.push({ type: "live" });
    }
    return;
  }
  if (match.phase === "roundEnd") {
    match.phaseT += dt;
    if (match.phaseT > 4 && match.phase !== "matchEnd") {
      match.round += 1;
      match.phase = "buy";
      match.roundClock = CFG.buyTime;
      spawnRound(sim);
      botBuy(sim);
      sim.events.push({ type: "buyphase", round: match.round });
    }
    return;
  }
  if (match.phase !== "live" || match.phase === "matchEnd") return;

  // --- Live round.
  match.roundClock -= dt;

  // Player movement and actions.
  if (player.alive && time >= player.flashUntil) {
    stepFighter(player, input, dt);
    player.recoil = Math.max(0, player.recoil - dt * 1.6);
    if (input.fire) {
      const shot = fireShot(player, aimFrom(player), eyeOf(player), sim.fighters, BLOCKS, time);
      if (shot) {
        sim.events.push({ type: "shot", shooter: player, shot });
        sim.tracers.push({ from: eyeOf(player), to: shot.point, until: time + 0.07 });
        hearShot(sim.fighters, player.x, player.z, 26, player);
        if (shot.fighter) {
          applyDamage(sim, shot.fighter, shot.damage, player, shot.part);
          sim.events.push({ type: "hit", victim: shot.fighter, damage: shot.damage, headshot: shot.part === "head" });
        }
      } else if (player.ammo[player.weapon] && player.ammo[player.weapon].mag <= 0) {
        sim.events.push({ type: "dryfire" });
      }
    }
    if (input.reload) {
      if (startReload(player, time)) sim.events.push({ type: "reload", fighter: player });
    }
    if (player.reloading && time >= player.reloadUntil) {
      finishReload(player);
      sim.events.push({ type: "reloaded", fighter: player });
    }
    if (input.grenade) {
      const kind = input.grenade;
      const g = throwGrenade(player, kind, eyeOf(player), aimFrom(player));
      if (g) {
        sim.grenades.push(g);
        sim.events.push({ type: "throw", fighter: player, kind });
      }
      input.grenade = null;
    }
    // Planting: hold E inside the site while carrying the Igniter.
    const core = match.core;
    if (core.state === "carried" && core.carrier === "player" && input.plant) {
      const inSite = player.x > MAP.site.x0 && player.x < MAP.site.x1 && player.z > MAP.site.z0 && player.z < MAP.site.z1;
      if (inSite) {
        core.progress += dt;
        if (core.progress >= CFG.plantTime) {
          core.state = "planted";
          core.fuse = CFG.fuseTime;
          core.x = player.x;
          core.z = player.z;
          sim.events.push({ type: "planted", fighter: player });
        }
      } else {
        core.progress = Math.max(0, core.progress - dt * 2);
      }
    }
    // Pick up a dropped Igniter.
    if (core.state === "dropped") {
      const d = Math.hypot(core.x - player.x, core.z - player.z);
      if (d < 1.6) {
        core.state = "carried";
        core.carrier = "player";
        core.progress = 0;
        sim.events.push({ type: "pickup", fighter: player });
      }
    }
  }

  // Bots.
  for (const f of sim.fighters) {
    if (f === player || !f.bot) continue;
    const evs = stepBot(f, sim.fighters, match, dt, time, BLOCKS);
    for (const e of evs) {
      if (e.type === "shot") {
        sim.events.push(e);
        sim.tracers.push({ from: eyeOf(e.shooter), to: e.shot.point, until: time + 0.07 });
        hearShot(sim.fighters, e.shooter.x, e.shooter.z, 26, e.shooter);
        if (e.shot.fighter) {
          applyDamage(sim, e.shot.fighter, e.shot.damage, e.shooter, e.shot.part);
          if (e.shooter === player) sim.events.push({ type: "hit", victim: e.shot.fighter, damage: e.shot.damage, headshot: e.shot.part === "head" });
        }
      } else if (e.type === "reload") {
        if (startReload(e.fighter, time)) sim.events.push({ type: "reload", fighter: e.fighter });
      } else {
        sim.events.push(e);
      }
      if (e.type === "planted" || e.type === "defused") {
        // Round flow is checked below; nothing else to do here.
      }
    }
    if (f.reloading && time >= f.reloadUntil) finishReload(f);
  }

  // Grenades.
  stepGrenades(sim.grenades, dt, BLOCKS, (g) => burstGrenade(sim, g));
  // Prune expired smoke in place so match.smokes keeps its identity.
  for (let i = sim.smokes.length - 1; i >= 0; i--) {
    if (sim.smokes[i].until <= time) sim.smokes.splice(i, 1);
  }
  sim.tracers = sim.tracers.filter((t) => t.until > time);

  // Planted core fuse.
  const core = match.core;
  if (core.state === "planted") {
    core.fuse -= dt;
    if (core.fuse <= 0) {
      core.state = "detonated";
      sim.events.push({ type: "detonated" });
      endRound(sim, "ember", "Igniter detonated");
      return;
    }
  }
  if (core.state === "defused") {
    endRound(sim, "slate", "Igniter defused");
    return;
  }

  // Round end by elimination or time.
  const emberAlive = aliveOf(sim.fighters, "ember");
  const slateAlive = aliveOf(sim.fighters, "slate");
  if (emberAlive === 0) {
    endRound(sim, "slate", "Ember team eliminated");
    return;
  }
  if (slateAlive === 0 && core.state !== "planted") {
    endRound(sim, "ember", "Slate team eliminated");
    return;
  }
  if (match.roundClock <= 0) {
    if (core.state === "planted") {
      // Let the fuse decide; the clock stops mattering.
      match.roundClock = 0;
    } else {
      endRound(sim, "slate", "Time expired — Reactor held");
    }
  }
}

export function stepFixed(sim, input, frameDt) {
  sim.acc += Math.min(0.1, frameDt);
  let n = 0;
  while (sim.acc >= STEP && n < 5) {
    stepSim(sim, input, STEP);
    sim.acc -= STEP;
    n += 1;
  }
  if (n === 5) sim.acc = 0;
}
