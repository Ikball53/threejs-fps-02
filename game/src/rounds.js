// rounds.js — round lifecycle, money, buy menu, bomb plant/defuse, match end.
// The round is won by clearing the Wardens or by the charge going off; it is
// lost when the player dies or the clock runs out with no plant.

import { ROUND_TIME, BUY_TIME, PLANT_TIME, DEFUSE_TIME, BOMB_TIME, WIN_ROUNDS, WEAPONS } from './state.js';
import { SPAWN, SITE } from './world.js';
import { spawnBots } from './bots.js';
import { sfx } from './audio.js';

export function startMatch(S) {
  S.scoreYou = 0; S.scoreFoe = 0; S.round = 1; S.money = 800; S.kills = 0; S.deaths = 0;
  S.matchWinner = null;
  startBuyPhase(S);
}

export function startBuyPhase(S) {
  S.phase = 'buy';
  S.buyClock = BUY_TIME;
  S.bombPlanted = false;
  S.bombTimer = 0;
  S.bombPos = null;
  S.plantProgress = 0;
  S.defuseProgress = 0;
  const p = S.player;
  p.pos.x = SPAWN.x; p.pos.z = SPAWN.z; p.yaw = SPAWN.yaw; p.pitch = 0;
  p.vel.x = 0; p.vel.z = 0; p.hp = 100; p.alive = true;
  p.reloading = 0; p.fireCooldown = 0; p.spreadBloom = 0;
  spawnBots(S);
  S.grenades = [];
  S.tracers = [];
}

export function startRound(S) {
  S.phase = 'live';
  S.roundClock = ROUND_TIME;
  S.plantProgress = 0;
  S.defuseProgress = 0;
}

function endRound(S, youWon, reason) {
  if (S.phase === 'over' || S.phase === 'matchover') return;
  S.phase = 'over';
  S.roundMsg = reason;
  S.roundMsgUntil = S.time + 3.5;
  if (youWon) {
    S.scoreYou += 1;
    S.money += 3250;
    sfx.roundWin();
  } else {
    S.scoreFoe += 1;
    S.money += 1900;
    sfx.roundLose();
  }
  if (S.scoreYou >= WIN_ROUNDS || S.scoreFoe >= WIN_ROUNDS) {
    S.matchWinner = S.scoreYou >= WIN_ROUNDS ? 'you' : 'foe';
    S.phase = 'matchover';
  }
}

export function stepRounds(S, dt, ui) {
  if (S.phase === 'buy') {
    S.buyClock -= dt;
    if (S.buyClock <= 0) { startRound(S); ui.onBuyClosed(); }
    return;
  }
  if (S.phase !== 'live' && S.phase !== 'planted') return;

  S.roundClock -= dt;
  const p = S.player;

  // Bomb timer once planted.
  if (S.bombPlanted) {
    S.bombTimer -= dt;
    if (S.bombTimer <= 0) {
      S.bombPlanted = false;
      ui.onBombExploded();
      endRound(S, true, 'CHARGE DETONATED — SITE CLEARED');
      return;
    }
  }

  // Planting: hold E inside the site ring.
  const inSite = Math.hypot(p.pos.x - SITE.x, p.pos.z - SITE.z) < SITE.r;
  if (S.phase === 'live' && p.alive && S.keys['KeyE'] && inSite && !S.bombPlanted) {
    S.plantProgress += dt / PLANT_TIME;
    if (Math.random() < dt * 2) sfx.plantBeep();
    if (S.plantProgress >= 1) {
      S.plantProgress = 0;
      S.bombPlanted = true;
      S.bombTimer = BOMB_TIME;
      S.bombPos = { x: p.pos.x, z: p.pos.z };
      S.phase = 'planted';
      S.money += 300;
      sfx.plantDone();
      ui.onPlanted();
    }
  } else if (S.plantProgress > 0) {
    S.plantProgress = Math.max(0, S.plantProgress - dt * 2);
  }

  // Defuse channel by a bot standing on the charge.
  if (S.phase === 'planted' && S.defuseProgress >= 1) {
    S.bombPlanted = false;
    S.defuseProgress = 0;
    ui.onDefused();
    endRound(S, false, 'WARDENS DEFUSED THE CHARGE');
    return;
  }

  const foesAlive = S.bots.filter((b) => b.alive).length;
  if (foesAlive === 0 && !S.bombPlanted) {
    endRound(S, true, 'ALL WARDENS DOWN — ROUND WON');
    return;
  }
  if (!p.alive && !S.bombPlanted) {
    // With the charge live the round plays out: detonation wins, a defuse loses.
    endRound(S, false, 'YOU WERE ELIMINATED');
    return;
  }
  if (S.roundClock <= 0 && !S.bombPlanted) {
    endRound(S, false, 'TIME UP — NO PLANT');
  }
}

// Called by main.js when a round-over banner has shown long enough.
export function advanceAfterRound(S, ui) {
  if (S.phase === 'matchover') return;
  if (S.matchWinner) return;
  S.round += 1;
  startBuyPhase(S);
  ui.onBuyOpened();
}

export function buyItem(S, id, ui) {
  const p = S.player;
  const price = { rifle: 2700, grenade: 300, ammo: 400, armor: 650, pistol_ammo: 150 }[id];
  if (price === undefined) return false;
  if (S.money < price) { ui.onBuyDenied('Not enough money'); return false; }
  if (id === 'rifle' && p.weapons.rifle.owned) { ui.onBuyDenied('Rifle already owned'); return false; }
  if (id === 'ammo' && !p.weapons.rifle.owned) { ui.onBuyDenied('Buy the rifle first'); return false; }
  if (id === 'armor' && p.armor >= 100) { ui.onBuyDenied('Armor already full'); return false; }
  S.money -= price;
  if (id === 'rifle') { p.weapons.rifle.owned = true; p.weapons.rifle.mag = WEAPONS.rifle.mag; p.weapons.rifle.reserve = WEAPONS.rifle.reserveMax; p.weapon = 'rifle'; }
  if (id === 'grenade') { p.weapons.grenade.owned = true; p.weapons.grenade.mag = 1; p.weapons.grenade.reserve += 1; }
  if (id === 'ammo') { p.weapons.rifle.reserve = WEAPONS.rifle.reserveMax; }
  if (id === 'pistol_ammo') { p.weapons.pistol.reserve = WEAPONS.pistol.reserveMax; }
  if (id === 'armor') { p.armor = Math.min(100, p.armor + 50); }
  sfx.buy();
  ui.onBought(id);
  return true;
}

export function damagePlayer(S, dmg, ui) {
  const p = S.player;
  if (!p.alive) return;
  let rest = dmg;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, rest * 0.5);
    p.armor -= absorbed;
    rest -= absorbed;
  }
  p.hp -= rest;
  sfx.hurt();
  ui.onHurt();
  if (p.hp <= 0) {
    p.hp = 0; p.alive = false; S.deaths += 1;
    ui.onPlayerDied();
  }
}

export function damageBot(S, bot, dmg, head, ui) {
  if (!bot.alive) return;
  bot.hp -= dmg;
  if (bot.hp <= 0) {
    bot.hp = 0; bot.alive = false;
    S.kills += 1;
    S.money += 300;
    sfx.kill();
    ui.onKill(bot, head);
  } else {
    sfx.hit();
    ui.onHit(bot, head);
    // A wounded bot turns toward the shot.
    bot.heard = { x: S.player.pos.x, z: S.player.pos.z, at: S.time };
    bot.target = { x: S.player.pos.x, z: S.player.pos.z };
    if (bot.state !== 'defuse') bot.state = 'investigate';
  }
}
