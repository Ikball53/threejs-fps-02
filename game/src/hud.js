// hud.js — every DOM element the player sees: HUD, crosshair, menus, feed.
// Reads the state object; writes nothing back except through callbacks.

import { WEAPONS, BUY_ITEMS, WIN_ROUNDS } from './state.js';

let els = null;
let lastAmmo = '';

export function buildHud(onBuy, onStart) {
  const root = document.getElementById('hud');
  root.innerHTML = `
    <div id="crosshair"><span class="ch t"></span><span class="ch b"></span><span class="ch l"></span><span class="ch r"></span><span class="ch dot"></span></div>
    <div id="hitmark">✕</div>
    <div id="topbar">
      <div id="timer">1:40</div>
      <div id="score"><span class="you">YOU 0</span><span class="mid">— ROUND 1 —</span><span class="foe">WARDENS 0</span></div>
      <div id="bombstat"></div>
    </div>
    <div id="health"><div id="hpbar"></div><span id="hptext">100</span><span id="armortext"></span></div>
    <div id="ammo"><span id="ammomag">12</span><span id="ammores">/ 48</span><div id="wname">Falcon P9</div></div>
    <div id="money">$800</div>
    <div id="feed"></div>
    <div id="banner"></div>
    <div id="plantbar"><div id="plantfill"></div><span id="plantlabel"></span></div>
    <div id="hint">WASD move · Mouse aim · Click fire · R reload · 1/2/3 weapons · C crouch · Shift walk · B buy · E plant / defuse</div>
    <div id="menu">
      <h1>EMBER YARD</h1>
      <p class="sub">Tactical round shooter — plant the charge at Furnace A or clear the Wardens.</p>
      <p class="ctl">WASD move &nbsp;·&nbsp; Mouse aim &nbsp;·&nbsp; Click fire &nbsp;·&nbsp; R reload<br>1 / 2 / 3 weapons &nbsp;·&nbsp; C crouch &nbsp;·&nbsp; Shift slow-walk &nbsp;·&nbsp; B buy &nbsp;·&nbsp; E plant / defuse</p>
      <button id="playbtn">CLICK TO DEPLOY</button>
      <p class="fine">First to ${WIN_ROUNDS} rounds. Kills pay $300 · round win $3,250 · loss $1,900.</p>
    </div>
    <div id="buy" class="hidden">
      <h2>BUY PHASE — press 1–5, B to close</h2>
      <div id="buyrows"></div>
      <p id="buymoney"></p>
    </div>`;
  els = {
    root, timer: document.getElementById('timer'), score: document.getElementById('score'),
    bombstat: document.getElementById('bombstat'), hpbar: document.getElementById('hpbar'),
    hptext: document.getElementById('hptext'), armortext: document.getElementById('armortext'),
    ammomag: document.getElementById('ammomag'), ammores: document.getElementById('ammores'),
    wname: document.getElementById('wname'), money: document.getElementById('money'),
    feed: document.getElementById('feed'), banner: document.getElementById('banner'),
    plantbar: document.getElementById('plantbar'), plantfill: document.getElementById('plantfill'),
    plantlabel: document.getElementById('plantlabel'), menu: document.getElementById('menu'),
    buy: document.getElementById('buy'), buyrows: document.getElementById('buyrows'),
    buymoney: document.getElementById('buymoney'), hitmark: document.getElementById('hitmark'),
    crosshair: document.getElementById('crosshair'),
  };
  document.getElementById('playbtn').addEventListener('click', onStart);
  els.buy.addEventListener('click', (e) => {
    const row = e.target.closest('[data-buy]');
    if (row) onBuy(row.dataset.buy);
  });
  return els;
}

export function showMenu(show) { if (els) els.menu.classList.toggle('hidden', !show); }
export function showBuy(show, S) {
  if (!els) return;
  els.buy.classList.toggle('hidden', !show);
  if (!show) return;
  const p = S.player;
  els.buyrows.innerHTML = BUY_ITEMS.map((it) => {
    let note = '';
    if (it.id === 'rifle') note = p.weapons.rifle.owned ? 'OWNED' : '';
    if (it.id === 'grenade') note = `held ${p.weapons.grenade.mag + p.weapons.grenade.reserve}`;
    if (it.id === 'ammo') note = p.weapons.rifle.owned ? `${p.weapons.rifle.reserve} reserve` : 'needs rifle';
    if (it.id === 'armor') note = `${p.armor} armor`;
    return `<div class="buyrow" data-buy="${it.id}"><b>[${it.key}] ${it.label}</b><span>$${it.price}</span><em>${note}</em></div>`;
  }).join('');
  els.buymoney.textContent = `Your money: $${S.money} — buy phase ends in ${Math.ceil(S.buyClock)}s`;
}

export function banner(text, cls, ms) {
  if (!els) return;
  els.banner.textContent = text;
  els.banner.className = cls || '';
  els.banner.style.opacity = '1';
  clearTimeout(banner._t);
  banner._t = setTimeout(() => { els.banner.style.opacity = '0'; }, ms || 2600);
}

export function addFeed(text) {
  if (!els) return;
  const d = document.createElement('div');
  d.textContent = text;
  els.feed.prepend(d);
  while (els.feed.children.length > 5) els.feed.lastChild.remove();
  setTimeout(() => d.remove(), 9000);
}

export function hitmarker(kill) {
  if (!els) return;
  els.hitmark.style.opacity = '1';
  els.hitmark.style.color = kill ? '#ff5a3c' : '#fff';
  clearTimeout(hitmarker._t);
  hitmarker._t = setTimeout(() => { els.hitmark.style.opacity = '0'; }, kill ? 350 : 140);
}

export function updateHud(S, dt) {
  if (!els) return;
  const p = S.player;
  const t = Math.max(0, S.roundClock);
  els.timer.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  els.timer.style.color = t < 15 ? '#ff5a3c' : '#fff';
  els.score.innerHTML = `<span class="you">YOU ${S.scoreYou}</span><span class="mid">— ROUND ${S.round} —</span><span class="foe">WARDENS ${S.scoreFoe}</span>`;
  els.bombstat.textContent = S.bombPlanted
    ? `⚠ CHARGE LIVE ${S.bombTimer.toFixed(1)}s`
    : (S.player.weapons.grenade.owned || true) && S.phase === 'live' && nearSite(p) ? 'HOLD E TO PLANT' : '';
  els.bombstat.style.color = S.bombPlanted ? '#ff5a3c' : '#ffb13c';
  els.hpbar.style.width = `${Math.max(0, p.hp)}%`;
  els.hpbar.style.background = p.hp > 50 ? '#7fd67a' : p.hp > 25 ? '#ffb13c' : '#ff5a3c';
  els.hptext.textContent = `${Math.ceil(Math.max(0, p.hp))} HP`;
  els.armortext.textContent = p.armor > 0 ? ` · ${p.armor} ARMOR` : '';
  const w = WEAPONS[p.weapon];
  const st = p.weapons[p.weapon];
  const ammoTxt = p.reloading > 0 ? 'RELOADING…' : `${st.mag} / ${st.reserve}`;
  if (ammoTxt !== lastAmmo) {
    els.ammomag.textContent = p.reloading > 0 ? '––' : String(st.mag);
    els.ammores.textContent = p.reloading > 0 ? 'RELOADING' : `/ ${st.reserve}`;
    lastAmmo = ammoTxt;
  }
  els.wname.textContent = w.name + (p.weapon === 'grenade' ? ` ×${st.mag + st.reserve}` : '');
  els.money.textContent = `$${S.money}`;
  // Crosshair spread grows with bloom + movement: stopping to aim pays.
  const gap = 6 + p.spreadBloom * 90 + p.speed2d * 1.6;
  els.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  els.crosshair.style.opacity = S.phase === 'live' || S.phase === 'planted' ? '1' : '0';
  // Plant / defuse progress bar
  const prog = S.plantProgress > 0 ? S.plantProgress : S.defuseProgress;
  const label = S.plantProgress > 0 ? 'PLANTING CHARGE…' : S.defuseProgress > 0 ? 'DEFUSING…' : '';
  els.plantbar.style.display = prog > 0 ? 'block' : 'none';
  els.plantfill.style.width = `${(prog * 100).toFixed(0)}%`;
  els.plantlabel.textContent = label;
  void dt;
}

function nearSite(p) {
  const dx = p.pos.x - 17, dz = p.pos.z - (-12);
  return dx * dx + dz * dz < 4.5 * 4.5;
}
