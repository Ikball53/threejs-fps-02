// The match: rounds, phases, money, and the buy menu.
//
// A match is first to seven round wins. Each round runs through phases:
// buy (fighters spend their money), freeze (a short count-in), live (the
// fight, until one side is eliminated, the device explodes, the device is
// defused, or the clock runs out), then a short round-end pause before the
// next round. The teams swap who attacks after the first half? No — this
// yard is fought one way: Rustjackets always attack, Harbour Watch always
// defends, and the match ends when one side reaches seven.
//
// Money is the tactical layer. Kills pay, round wins pay more, and a team
// on a losing streak gets a bigger loss bonus each round it drops, so a
// team that is behind can afford rifles again instead of spiralling into
// pistol rounds forever. The buy menu sells rifles, SMGs, a sniper, a
// shotgun, grenades, kevlar, a helmet and a defuse kit.

import { ARENA, SITES } from './arena.js';
import { WEAPONS, GRENADES, GEAR } from './guns.js';

export const PHASES = {
  BUY: 'buy',
  FREEZE: 'freeze',
  LIVE: 'live',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

// Economy: what a round pays.
export const PAYOUT = {
  kill: 300,
  roundWin: 3250,
  roundLossBase: 1900,
  lossStreakBonus: 500, // +500 per consecutive loss, capped at 3 steps
  plantBonus: 300, // the carrier's team, for getting the device down
  defuseBonus: 300,
};

export function createMatch() {
  return {
    phase: PHASES.BUY,
    phaseT: 0,
    round: 1,
    score: { attack: 0, defend: 0 },
    lossStreak: { attack: 0, defend: 0 },
    clock: ARENA.buySeconds,
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    // The plant device: none | carried | planted | exploded | defused.
    plant: {
      state: 'none',
      targetSite: null, // SITES.A or SITES.B, picked at round start
      site: null, // the site it was planted at
      x: 0,
      z: 0,
      timer: 0, // counts down once planted
      plantProgress: 0, // 0..1 while the carrier plants
      defuseProgress: 0,
    },
  };
}

/** The buy menu: every item a fighter can spend money on, in menu order. */
export function buyCatalog() {
  const items = [];
  for (const w of [WEAPONS.rifle, WEAPONS.carbine, WEAPONS.smg, WEAPONS.shotgun, WEAPONS.sniper]) {
    items.push({ kind: 'weapon', id: w.id, name: w.name, price: w.price, key: w.id });
  }
  items.push({ kind: 'grenade', id: 'flash', name: GRENADES.flash.name, price: GRENADES.flash.price });
  items.push({ kind: 'grenade', id: 'smoke', name: GRENADES.smoke.name, price: GRENADES.smoke.price });
  items.push({ kind: 'grenade', id: 'he', name: GRENADES.he.name, price: GRENADES.he.price });
  items.push({ kind: 'gear', id: 'kevlar', name: GEAR.kevlar.name, price: GEAR.kevlar.price });
  items.push({ kind: 'gear', id: 'helmet', name: GEAR.helmet.name, price: GEAR.helmet.price });
  items.push({ kind: 'gear', id: 'defuseKit', name: GEAR.defuseKit.name, price: GEAR.defuseKit.price });
  return items;
}

/** Buy an item for a fighter. Returns true when the purchase went through. */
export function buyItem(fighter, itemId, state) {
  const item = buyCatalog().find((i) => i.id === itemId);
  if (!item) return false;
  if (fighter.money < item.price) return false;
  if (state.phase !== PHASES.BUY) return false;
  fighter.money -= item.price;
  if (item.kind === 'weapon') {
    fighter.weaponId = item.id;
    const w = WEAPONS[item.id];
    fighter.ammo = w.mag;
    fighter.reserve = w.reserve;
  } else if (item.kind === 'grenade') {
    fighter.grenades = fighter.grenades || { flash: 0, smoke: 0, he: 0 };
    fighter.grenades[item.id]++;
  } else if (item.id === 'kevlar') {
    fighter.armor = 100;
  } else if (item.id === 'helmet') {
    fighter.helmet = true;
  } else if (item.id === 'defuseKit') {
    fighter.defuseKit = true;
  }
  return true;
}

/** A bot's shopping: spend sensibly, favouring a rifle, then armour, then utility. */
export function botBuy(fighter, stream) {
  // Keep the pistol when broke; otherwise buy the best affordable rifle.
  const affordable = ['rifle', 'carbine', 'smg', 'shotgun']
    .map((id) => WEAPONS[id])
    .filter((w) => fighter.money >= w.price)
    .sort((a, b) => b.damage - a.damage);
  if (affordable.length > 0) {
    const pick = affordable[0];
    fighter.money -= pick.price;
    fighter.weaponId = pick.id;
    fighter.ammo = pick.mag;
    fighter.reserve = pick.reserve;
  } else if (fighter.money >= WEAPONS.smg.price) {
    const w = WEAPONS.smg;
    fighter.money -= w.price;
    fighter.weaponId = w.id;
    fighter.ammo = w.mag;
    fighter.reserve = w.reserve;
  }
  if (fighter.money >= GEAR.kevlar.price && stream.next() < 0.7) {
    fighter.money -= GEAR.kevlar.price;
    fighter.armor = 100;
  }
  fighter.grenades = fighter.grenades || { flash: 0, smoke: 0, he: 0 };
  if (fighter.money >= GRENADES.smoke.price && stream.next() < 0.5) {
    fighter.money -= GRENADES.smoke.price;
    fighter.grenades.smoke++;
  }
  if (fighter.money >= GRENADES.flash.price && stream.next() < 0.4) {
    fighter.money -= GRENADES.flash.price;
    fighter.grenades.flash++;
  }
  if (fighter.team === 'defend' && fighter.money >= GEAR.defuseKit.price && stream.next() < 0.5) {
    fighter.money -= GEAR.defuseKit.price;
    fighter.defuseKit = true;
  }
}

/** Pay every fighter on a team. */
function payTeam(fighters, team, amount) {
  for (const f of fighters) if (f.team === team) f.money += amount;
}

/** End the round: pay out, update streaks and the score, move the phase on. */
export function endRound(match, fighters, winner, reason) {
  const loser = winner === 'attack' ? 'defend' : 'attack';
  match.roundWinner = winner;
  match.roundReason = reason;
  match.score[winner]++;
  match.lossStreak[winner] = 0;
  match.lossStreak[loser] = Math.min(match.lossStreak[loser] + 1, 3);
  payTeam(fighters, winner, PAYOUT.roundWin);
  const lossPay = PAYOUT.roundLossBase + match.lossStreak[loser] * PAYOUT.lossStreakBonus;
  payTeam(fighters, loser, lossPay);
  match.phase = PHASES.ROUND_END;
  match.phaseT = 0;
  match.clock = 4;
  if (match.score[winner] >= ARENA.roundsToWin) {
    match.matchWinner = winner;
    match.phase = PHASES.MATCH_END;
    match.clock = 10;
  }
}

/** Start the next round: reset positions, pick a site, hand out the device. */
export function startRound(match, fighters, stream) {
  match.round++;
  match.phase = PHASES.BUY;
  match.phaseT = 0;
  match.clock = ARENA.buySeconds;
  match.roundWinner = null;
  match.roundReason = '';
  // The attack picks a site for this round, weighted by which site they
  // have won on less often — in practice: alternate, with a random nudge.
  const site = stream.next() < 0.5 ? SITES.A : SITES.B;
  match.plant = {
    state: 'none',
    targetSite: site,
    site: null,
    x: 0,
    z: 0,
    timer: 0,
    plantProgress: 0,
    defuseProgress: 0,
  };
  // The device goes to a random living attacker (the entry fragger carries).
  const carriers = fighters.filter((f) => f.team === 'attack');
  for (const f of carriers) f.hasDevice = false;
  if (carriers.length > 0) {
    const carrier = carriers[Math.floor(stream.next() * carriers.length)];
    carrier.hasDevice = true;
  }
  for (const f of fighters) {
    f.grenades = f.grenades || { flash: 0, smoke: 0, he: 0 };
  }
}

/** Advance the match clock. Returns an event string when a phase changes. */
export function matchTick(match, dt) {
  match.phaseT += dt;
  match.clock -= dt;
  if (match.phase === PHASES.BUY && match.clock <= 0) {
    match.phase = PHASES.FREEZE;
    match.phaseT = 0;
    match.clock = ARENA.freezeSeconds;
    return 'freeze';
  }
  if (match.phase === PHASES.FREEZE && match.clock <= 0) {
    match.phase = PHASES.LIVE;
    match.phaseT = 0;
    match.clock = ARENA.roundSeconds;
    return 'live';
  }
  if (match.phase === PHASES.ROUND_END && match.clock <= 0) {
    return 'nextRound';
  }
  if (match.phase === PHASES.MATCH_END && match.clock <= 0) {
    return 'matchOver';
  }
  return null;
}
