// hud.js — the heads-up display and the buy menu: every number the player
// sees, the kill feed, banners, and the shop. One job: turn match state
// into DOM. It never writes game state back.

import { WEAPONS, GRENADES, ARMOR_PRICE } from "./state.js";

const $ = (id) => document.getElementById(id);

const BUY_ITEMS = [
  { key: "pistol", label: "P9 SIDEARM", price: 0 },
  { key: "scatter", label: "SG-12 SCATTERGUN", price: 900 },
  { key: "smg", label: "VK-9 SMG", price: 1200 },
  { key: "carbine", label: "AR-77 CARBINE", price: 2500 },
  { key: "marksman", label: "DMR-50 MARKSMAN", price: 4000 },
  { key: "armor", label: "KEVLAR ARMOR", price: ARMOR_PRICE },
  { key: "flash", label: "FLASH GRENADE", price: 200 },
  { key: "smoke", label: "SMOKE GRENADE", price: 300 },
  { key: "he", label: "HE CHARGE", price: 300 },
];

export function bindHud(onBuy) {
  const grid = $("buygrid");
  grid.innerHTML = "";
  BUY_ITEMS.forEach((item, i) => {
    const b = document.createElement("button");
    b.dataset.key = item.key;
    b.innerHTML = `<span>${i + 1}. ${item.label}</span><b>$${item.price}</b>`;
    b.addEventListener("click", () => onBuy(item.key));
    grid.appendChild(b);
  });
  return {
    money: $("money"), feed: $("feed"),
    timer: document.querySelector("#hud-top .timer"),
    score: document.querySelector("#hud-top .score"),
    pips: document.querySelector("#hud-top .pips"),
    hp: document.querySelector("#hud-bl .hp"),
    armor: document.querySelector("#hud-bl .armor"),
    ammo: document.querySelector("#hud-br .ammo"),
    gun: document.querySelector("#hud-br .gun"),
    cross: $("cross"), hitmark: $("hitmark"), vig: $("vig"),
    banner: $("banner"), bannerBig: document.querySelector("#banner .big"),
    bannerSub: document.querySelector("#banner .sub"),
    plantbar: $("plantbar"), plantLbl: document.querySelector("#plantbar .lbl"),
    plantFill: document.querySelector("#plantbar .fill"),
    prompt: $("prompt"), toast: $("toast"), buy: $("buy"),
    buyCash: document.querySelector("#buy .cash"),
    buyGrid: grid,
  };
}

const last = {};

function setText(el, key, value) {
  if (last[key] !== value) {
    last[key] = value;
    el.textContent = value;
  }
}

export function updateHud(h, sim) {
  const { match, player, fighters } = sim;
  const def = WEAPONS[player.weapon];
  const bag = player.ammo[player.weapon] ?? { mag: 0, reserve: 0 };
  setText(h.money, "money", `$${player.money}`);
  setText(h.hp, "hp", `${Math.max(0, Math.ceil(player.hp))}`);
  setText(h.armor, "armor", `ARMOR ${Math.ceil(player.armor)}`);
  const ammoHtml = `${bag.mag} <small>/ ${bag.reserve}</small>`;
  if (last.ammo !== ammoHtml) {
    last.ammo = ammoHtml;
    h.ammo.innerHTML = ammoHtml;
  }
  setText(h.gun, "gun", player.reloading ? `${def.name} — RELOADING` : def.name);
  const clock = Math.max(0, match.roundClock);
  const mm = Math.floor(clock / 60);
  const ss = Math.floor(clock % 60).toString().padStart(2, "0");
  const phaseName = match.phase === "buy" ? "BUY" : match.phase === "freeze" ? "FREEZE" : match.phase === "live" ? "" : match.phase.toUpperCase();
  setText(h.timer, "timer", phaseName ? `${mm}:${ss} ${phaseName}` : `${mm}:${ss}`);
  setText(h.score, "score", `EMBER ${match.score.ember} — ${match.score.slate} SLATE · ROUND ${match.round}`);
  const emberPips = fighters.filter((f) => f.team === "ember").map((f) => `<span class="${f.alive ? "" : "dead"}">●</span>`).join("");
  const slatePips = fighters.filter((f) => f.team === "slate").map((f) => `<span class="${f.alive ? "" : "dead"}">●</span>`).join("");
  const pipsHtml = `<span style="color:#ffb454">${emberPips}</span> vs <span style="color:#ff7a6e">${slatePips}</span>`;
  if (last.pips !== pipsHtml) {
    last.pips = pipsHtml;
    h.pips.innerHTML = pipsHtml;
  }
  // Crosshair gap grows with spread and recoil.
  const gap = 3 + player.spread * 320 + player.recoil * 14;
  h.cross.style.setProperty("--gap", `${gap}px`);
  const bars = h.cross.querySelectorAll("i");
  bars[0].style.left = `${-11 - gap}px`;
  bars[0].style.width = `${22 + gap * 2}px`;
  bars[1].style.top = `${-11 - gap}px`;
  bars[1].style.height = `${22 + gap * 2}px`;
  setText(h.buyCash, "cash", `$${player.money}`);
  // Buy buttons: affordable and not already held.
  for (const b of h.buyGrid.children) {
    const item = BUY_ITEMS.find((x) => x.key === b.dataset.key);
    const held = item.key === player.weapon;
    const owned = item.key === "armor" ? player.armor >= 100 : false;
    b.disabled = held || owned || player.money < item.price;
  }
}

export function feedKill(h, killer, victim, headshot) {
  const cls = killer.team === "ember" ? "pal" : "foe";
  const vcls = victim.team === "ember" ? "pal" : "foe";
  const line = document.createElement("div");
  line.innerHTML = `<span class="${cls}">${killer.name}</span> ${headshot ? "◉" : "✕"} <span class="${vcls}">${victim.name}</span>`;
  h.feed.prepend(line);
  while (h.feed.children.length > 5) h.feed.lastChild.remove();
}

export function feedLine(h, text, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = text;
  h.feed.prepend(line);
  while (h.feed.children.length > 5) h.feed.lastChild.remove();
}

export function showBanner(h, big, sub, color = "#ffd9a0") {
  h.bannerBig.textContent = big;
  h.bannerBig.style.color = color;
  h.bannerSub.textContent = sub;
  h.banner.style.display = "block";
}

export function hideBanner(h) {
  h.banner.style.display = "none";
}

export function showPlant(h, label, frac) {
  h.plantbar.style.display = "block";
  h.plantLbl.textContent = label;
  h.plantFill.style.width = `${Math.round(frac * 100)}%`;
}

export function hidePlant(h) {
  h.plantbar.style.display = "none";
}

export function showPrompt(h, text) {
  h.prompt.style.display = "block";
  h.prompt.textContent = text;
}

export function hidePrompt(h) {
  h.prompt.style.display = "none";
}

export function hitmark(h, headshot) {
  h.hitmark.style.opacity = "1";
  h.hitmark.style.color = headshot ? "#ff5a4a" : "#fff";
  setTimeout(() => { h.hitmark.style.opacity = "0"; }, 120);
}

export function damageFlash(h) {
  h.vig.style.boxShadow = "inset 0 0 120px rgba(255,30,10,0.55)";
  setTimeout(() => { h.vig.style.boxShadow = "inset 0 0 120px rgba(255,30,10,0)"; }, 140);
}

export function flashWhite(h, power) {
  h.vig.style.boxShadow = `inset 0 0 140px rgba(255,255,255,${0.75 * power})`;
  setTimeout(() => { h.vig.style.boxShadow = "inset 0 0 120px rgba(255,30,10,0)"; }, 200);
}

let toastTimer = 0;
export function toast(h, text) {
  h.toast.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { h.toast.textContent = ""; }, 2600);
}

export function openBuy(h) {
  h.buy.style.display = "block";
}

export function closeBuy(h) {
  h.buy.style.display = "none";
}

export function buyOpen(h) {
  return h.buy.style.display === "block";
}
