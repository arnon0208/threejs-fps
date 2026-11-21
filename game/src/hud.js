// The HUD: DOM overlays driven by the single game state. The 3D canvas is the
// game; everything else is plain HTML the player reads at a glance — health,
// armor, ammo, money, round score, timer, crosshair, hitmarker, kill feed, the
// buy menu and the round banners. No canvas drawing for UI, so it stays crisp.
import { SHOP } from './match.js';

let els = null;
let lastHitmark = 0;
let buyMessage = '';
let buyMessageTimer = 0;

export function buildHud() {
  const hud = document.getElementById('hud');
  hud.innerHTML = `
    <div id="crosshair"><i></i><i></i><i></i><i></i></div>
    <div id="hitmarker"><i></i><i></i><i></i><i></i></div>
    <div id="vignette"></div>
    <div id="flash"></div>
    <div id="health"><span id="health-num">100</span><div id="health-bar"><i></i></div><span id="armor-num"></span></div>
    <div id="ammo"><span id="ammo-mag">12</span><span id="ammo-reserve">/ 48</span><span id="weapon-name">P226</span></div>
    <div id="topbar">
      <span id="score-us">0</span><span id="timer">1:40</span><span id="score-them">0</span>
      <span id="round-label">ROUND 1</span>
    </div>
    <div id="money">$800</div>
    <div id="killfeed"></div>
    <div id="announce"></div>
    <div id="plant"><div id="plant-fill"></div><span id="plant-label"></span></div>
    <div id="bomb-status"></div>
    <div id="banner" hidden><h1 id="banner-title"></h1><p id="banner-sub"></p></div>
    <div id="buy" hidden>
      <h2>Buy phase — <span id="buy-timer"></span>s</h2>
      <p>Press a number key or click. Enter starts the round.</p>
      <div id="shop"></div>
      <p id="buy-message"></p>
    </div>
    <div id="menu" class="overlay">
      <section class="panel">
        <h1>Ember Yard</h1>
        <p>A tactical FPS in a dusk industrial yard. Plant the charge at A or B, or eliminate the four defenders. First to 5 rounds.</p>
        <button id="play" type="button">Click to play</button>
        <ul class="keys">
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</li>
          <li><kbd>Mouse</kbd> Look</li>
          <li><kbd>Click</kbd> Fire</li>
          <li><kbd>R</kbd> Reload</li>
          <li><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Weapons</li>
          <li><kbd>4</kbd><kbd>5</kbd><kbd>6</kbd> Frag / Smoke / Flash</li>
          <li><kbd>E</kbd> Plant the charge (hold, inside a site)</li>
          <li><kbd>Ctrl</kbd> Crouch</li>
          <li><kbd>Space</kbd> Jump</li>
        </ul>
      </section>
    </div>`;
  els = {
    crosshair: document.getElementById('crosshair'),
    hitmarker: document.getElementById('hitmarker'),
    vignette: document.getElementById('vignette'),
    flash: document.getElementById('flash'),
    healthNum: document.getElementById('health-num'),
    healthBar: document.querySelector('#health-bar i'),
    armorNum: document.getElementById('armor-num'),
    ammoMag: document.getElementById('ammo-mag'),
    ammoReserve: document.getElementById('ammo-reserve'),
    weaponName: document.getElementById('weapon-name'),
    scoreUs: document.getElementById('score-us'),
    scoreThem: document.getElementById('score-them'),
    timer: document.getElementById('timer'),
    roundLabel: document.getElementById('round-label'),
    money: document.getElementById('money'),
    killfeed: document.getElementById('killfeed'),
    announce: document.getElementById('announce'),
    plant: document.getElementById('plant'),
    plantFill: document.getElementById('plant-fill'),
    plantLabel: document.getElementById('plant-label'),
    bombStatus: document.getElementById('bomb-status'),
    banner: document.getElementById('banner'),
    bannerTitle: document.getElementById('banner-title'),
    bannerSub: document.getElementById('banner-sub'),
    buy: document.getElementById('buy'),
    buyTimer: document.getElementById('buy-timer'),
    shop: document.getElementById('shop'),
    buyMessage: document.getElementById('buy-message'),
    menu: document.getElementById('menu'),
    play: document.getElementById('play'),
  };
  // Shop buttons, built once; the buy callback is wired by main.js.
  els.shop.innerHTML = SHOP.map(
    (s) => `<button class="shop-item" data-id="${s.id}"><b>${s.name}</b><span>$${s.price}</span><i>${s.desc}</i></button>`,
  ).join('');
  return els;
}

export function showHitmarker(headshot) {
  els.hitmarker.classList.add('on');
  els.hitmarker.style.setProperty('--hm-color', headshot ? '#ff5a3c' : '#f0a830');
  lastHitmark = performance.now();
}

export function setBuyMessage(msg) {
  buyMessage = msg;
  buyMessageTimer = 3;
}

// One HUD refresh per frame from the game state.
export function tickHud(state, dt, time) {
  const { player, match } = state;
  if (performance.now() - lastHitmark > 120) els.hitmarker.classList.remove('on');

  els.healthNum.textContent = Math.ceil(player.hp);
  els.healthBar.style.width = `${Math.max(0, player.hp)}%`;
  els.healthBar.style.background = player.hp > 50 ? '#3fa08f' : player.hp > 25 ? '#e8862e' : '#c94f2a';
  els.armorNum.textContent = player.armor > 0 ? `+${Math.ceil(player.armor)} armor` : '';
  els.ammoMag.textContent = player.weapon.mag;
  els.ammoReserve.textContent = `/ ${player.weapon.reserve}`;
  els.weaponName.textContent = player.weapon.def.name;
  els.ammoMag.parentElement.classList.toggle('empty', player.weapon.mag === 0);
  els.money.textContent = `$${player.money}`;
  els.scoreUs.textContent = match.scoreUs;
  els.scoreThem.textContent = match.scoreThem;
  els.roundLabel.textContent = `ROUND ${Math.min(match.round, 9)}`;
  const t = match.charge ? match.charge.fuse : match.timer;
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60).toString().padStart(2, '0');
  els.timer.textContent = `${mm}:${ss}`;
  els.timer.style.color = match.charge ? '#ff5a3c' : t < 15 ? '#e8862e' : '';

  // Crosshair gap grows with spread and movement.
  const moving = Math.hypot(player.vel.x, player.vel.z);
  const gap = 4 + player.weapon.bloom * 220 + moving * 1.6;
  els.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);

  // Damage vignette from recent hurt.
  els.vignette.style.opacity = state.hurtFlash.toFixed(2);
  els.flash.style.opacity = player.flash.toFixed(2);

  // Kill feed.
  els.killfeed.innerHTML = match.killfeed
    .map(
      (k) =>
        `<div>${k.killer} <span class="kf-weapon">${k.weapon}</span> ${k.headshot ? '<span class="kf-head">HEADSHOT</span> ' : ''}${k.victim}</div>`,
    )
    .join('');

  // Announcement.
  els.announce.textContent = match.announce || '';
  els.announce.style.opacity = match.announce ? '1' : '0';

  // Plant progress.
  if (player.planting > 0 && player.plantSite) {
    els.plant.style.display = 'block';
    els.plantFill.style.width = `${(player.planting / 3) * 100}%`;
    els.plantLabel.textContent = `Planting at ${player.plantSite.name}…`;
  } else {
    els.plant.style.display = 'none';
  }

  // Bomb status line.
  if (match.charge && !match.charge.defused && !match.charge.detonated) {
    els.bombStatus.textContent = `CHARGE PLANTED — ${match.charge.fuse.toFixed(0)}s`;
    els.bombStatus.style.display = 'block';
  } else {
    els.bombStatus.style.display = 'none';
  }

  // Banner.
  if (match.banner && match.bannerTimer > 0) {
    els.banner.hidden = false;
    els.bannerTitle.textContent = match.banner;
    els.bannerSub.textContent = match.roundReason || '';
  } else {
    els.banner.hidden = true;
  }

  // Buy menu.
  const inBuy = match.phase === 'buy';
  els.buy.hidden = !inBuy;
  if (inBuy) {
    els.buyTimer.textContent = Math.ceil(match.buyTimer);
    if (buyMessageTimer > 0) {
      buyMessageTimer -= dt;
      els.buyMessage.textContent = buyMessage;
    } else {
      els.buyMessage.textContent = '';
    }
    for (const btn of els.shop.querySelectorAll('.shop-item')) {
      const item = SHOP.find((s) => s.id === btn.dataset.id);
      btn.classList.toggle('poor', player.money < item.price);
    }
  }

  // Menu overlay.
  els.menu.style.display = match.phase === 'menu' ? 'grid' : 'none';
}
