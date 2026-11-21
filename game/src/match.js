// The match: rounds, economy, the buy menu and the bomb. One match is a
// first-to-5 series of 100-second rounds. The attacker (the player) wins a round
// by eliminating the defenders, or by planting the charge at A or B and letting
// it detonate; the defenders win by killing the player, defusing a planted
// charge, or running the clock out before a plant. Money earned each round buys
// weapons, armor and grenades between rounds.
import * as THREE from 'three';
import { SITES, SPAWNS } from './world.js';
import { makeWeapon, WEAPONS } from './weapons.js';
import { GRENADES, makeGrenade } from './combat.js';
import { giveWeapon } from './player.js';
import { sendDefuser, botHear } from './bots.js';
import { sfx } from './audio.js';

export const ROUND_TIME = 100;
export const PLANT_TIME = 3;
export const FUSE_TIME = 40;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const BUY_TIME = 12;

export const SHOP = [
  { id: 'rifle', kind: 'weapon', name: 'VK-47 rifle', price: 2700, desc: 'Auto rifle, 30 rounds. The workhorse.' },
  { id: 'smg', kind: 'weapon', name: 'Raptor-9 SMG', price: 1500, desc: 'Fast, close-range spray.' },
  { id: 'armor', kind: 'armor', name: 'Kevlar vest', price: 650, desc: 'Absorbs half of incoming damage.' },
  { id: 'frag', kind: 'grenade', name: 'Frag grenade', price: 300, desc: 'Explodes for up to 110 damage.' },
  { id: 'smoke', kind: 'grenade', name: 'Smoke grenade', price: 300, desc: 'A cloud that blocks bot sight.' },
  { id: 'flash', kind: 'grenade', name: 'Flashbang', price: 200, desc: 'Blinds anyone looking at it.' },
];

export function makeMatch() {
  return {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 0,
    scoreUs: 0,
    scoreThem: 0,
    timer: 0,
    buyTimer: 0,
    charge: null,
    killfeed: [],
    banner: null,
    bannerTimer: 0,
    // Short-lived centre-screen announcement (plant, defuse, etc.).
    announce: null,
    announceTimer: 0,
    winner: null,
    roundReason: '',
    stats: { shots: 0, hits: 0, kills: 0, headshots: 0 },
  };
}

export function startMatch(m) {
  m.phase = 'buy';
  m.round = 1;
  m.scoreUs = 0;
  m.scoreThem = 0;
  m.timer = ROUND_TIME;
  m.buyTimer = BUY_TIME;
  m.charge = null;
  m.killfeed = [];
  m.banner = null;
  m.winner = null;
}

export function startRound(m, player, bots) {
  // Respawn everyone at their spawns, full health, fresh charge state.
  player.pos.set(SPAWNS.attacker.x, 0, SPAWNS.attacker.z);
  player.vel.set(0, 0, 0);
  player.yaw = SPAWNS.attacker.yaw;
  player.pitch = 0;
  player.hp = 100;
  player.alive = true;
  player.planting = 0;
  player.plantSite = null;
  player.flash = 0;
  bots.forEach((b, i) => {
    const s = SPAWNS.defenders[i % SPAWNS.defenders.length];
    b.pos.set(s.x, 0, s.z);
    b.vel.set(0, 0, 0);
    b.yaw = s.yaw;
    b.hp = 100;
    b.armor = 25;
    b.alive = true;
    b.state = 'hold';
    b.holdTimer = 2 + i;
    b.holdYaw = s.yaw;
    b.defusing = 0;
    b.weapon = makeWeapon('rifle');
    b.weapon.mag = b.weapon.def.mag;
    b.weapon.reserve = 120;
  });
  m.timer = ROUND_TIME;
  m.charge = null;
  m.phase = 'live';
}

// Buy an item during the buy phase. Returns a message for the HUD, or null.
export function buy(m, player, id) {
  if (m.phase !== 'buy') return null;
  const item = SHOP.find((s) => s.id === id);
  if (!item) return null;
  if (player.money < item.price) {
    sfx.denied();
    return 'Not enough money';
  }
  if (item.kind === 'weapon') {
    if (player.weapons[item.id]) {
      // Already owned: refill its ammo instead.
      const w = player.weapons[item.id];
      w.mag = w.def.mag;
      w.reserve = w.def.reserve;
      player.money -= Math.min(item.price, 300);
      sfx.buy();
      return `${WEAPONS[item.id].name} ammo refilled`;
    }
    player.money -= item.price;
    giveWeapon(player, item.id);
    sfx.buy();
    return `${WEAPONS[item.id].name} bought`;
  }
  if (item.kind === 'armor') {
    if (player.armor >= 100) return 'Armor already full';
    player.money -= item.price;
    player.armor = 100;
    sfx.buy();
    return 'Kevlar vest bought';
  }
  // Grenade.
  if (player.grenades[item.id] >= 2) return 'Carrying the maximum of 2';
  player.money -= item.price;
  player.grenades[item.id] += 1;
  sfx.buy();
  return `${item.name} bought`;
}

export function feedKill(m, killer, victim, headshot, weaponName) {
  m.killfeed.unshift({ killer, victim, headshot, weapon: weaponName, t: m.timer });
  if (m.killfeed.length > 5) m.killfeed.pop();
}

export function endRound(m, usWon, reason, player, bots) {
  if (usWon) {
    m.scoreUs += 1;
    player.money += 3250;
  } else {
    m.scoreThem += 1;
    player.money += 1900;
  }
  m.roundReason = reason;
  m.phase = 'roundEnd';
  m.bannerTimer = 3.5;
  m.banner = usWon ? 'ROUND WON' : 'ROUND LOST';
  if (usWon) sfx.roundWin();
  else sfx.roundLose();
  if (m.scoreUs >= WIN_ROUNDS || m.scoreThem >= WIN_ROUNDS || m.round >= MAX_ROUNDS) {
    m.phase = 'matchEnd';
    m.winner = m.scoreUs > m.scoreThem ? 'us' : m.scoreThem > m.scoreUs ? 'them' : 'draw';
    m.banner = m.winner === 'us' ? 'MATCH WON' : m.winner === 'them' ? 'MATCH LOST' : 'MATCH DRAWN';
    m.bannerTimer = 999;
  }
}

// The per-step match tick. `ctx` carries the player, bots, grenades, smokes,
// input, rng, and the throw callback. Handles keys, planting, the fuse, the
// timer and round transitions.
export function tickMatch(m, ctx, dt) {
  const { player, bots, input, rng } = ctx;
  if (m.bannerTimer > 0 && m.bannerTimer < 900) m.bannerTimer -= dt;
  if (m.announceTimer > 0) {
    m.announceTimer -= dt;
    if (m.announceTimer <= 0) m.announce = null;
  }

  if (m.phase === 'buy') {
    m.buyTimer -= dt;
    // Keyboard shortcuts for the shop.
    const shopKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
    shopKeys.forEach((code, i) => {
      if (input.pressed.has(code)) buy(m, player, SHOP[i].id);
    });
    if (input.pressed.has('Enter') || m.buyTimer <= 0) {
      m.buyTimer = 0;
      startRound(m, player, bots);
    }
    return;
  }

  if (m.phase === 'roundEnd') {
    if (m.bannerTimer <= 0) {
      m.round += 1;
      m.phase = 'buy';
      m.buyTimer = BUY_TIME;
    }
    return;
  }

  if (m.phase !== 'live') return;

  // Round timer (frozen once the charge is planted — the fuse takes over).
  if (!m.charge) {
    m.timer -= dt;
    if (m.timer <= 0) {
      m.timer = 0;
      endRound(m, false, 'Time expired before the plant', player, bots);
      return;
    }
  }

  // Planting: hold E inside a site, standing still.
  const speed = Math.hypot(player.vel.x, player.vel.z);
  let site = null;
  if (player.alive && !m.charge) {
    for (const s of Object.values(SITES)) {
      if (Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < s.r) {
        site = s;
        break;
      }
    }
  }
  if (site && input.keys.has('KeyE') && speed < 1.5) {
    if (player.plantSite !== site) {
      player.plantSite = site;
      player.planting = 0;
    }
    player.planting += dt;
    if (Math.floor(player.planting * 2) !== Math.floor((player.planting - dt) * 2)) sfx.plant();
    if (player.planting >= PLANT_TIME) {
      m.charge = { site, fuse: FUSE_TIME, defused: false, detonated: false, beepTimer: 0 };
      player.planting = 0;
      player.plantSite = null;
      m.announce = `Charge planted at ${site.name}`;
      m.announceTimer = 4;
      sfx.beep();
      for (const b of bots) botHear(b, site.x, site.z);
      sendDefuser(bots, m.charge);
    }
  } else {
    player.planting = 0;
    player.plantSite = null;
  }

  // The fuse: beeps accelerate, then the charge blows the round open.
  if (m.charge && !m.charge.defused && !m.charge.detonated) {
    m.charge.fuse -= dt;
    m.charge.beepTimer -= dt;
    if (m.charge.beepTimer <= 0) {
      sfx.beep();
      m.charge.beepTimer = Math.max(0.25, m.charge.fuse / FUSE_TIME) * 1.2;
    }
    if (m.charge.fuse <= 0) {
      m.charge.detonated = true;
      sfx.explosion();
      endRound(m, true, 'The charge detonated', player, bots);
      return;
    }
    if (m.charge.defused) {
      endRound(m, false, 'The charge was defused', player, bots);
      return;
    }
  }

  // Weapon select and grenade throws (live only).
  if (player.alive) {
    if (input.pressed.has('Digit1')) ctx.selectWeapon('pistol');
    if (input.pressed.has('Digit2')) ctx.selectWeapon('rifle');
    if (input.pressed.has('Digit3')) ctx.selectWeapon('smg');
    if (input.pressed.has('KeyR')) ctx.reload();
    for (const [code, type] of [['Digit4', 'frag'], ['Digit5', 'smoke'], ['Digit6', 'flash']]) {
      if (input.pressed.has(code)) ctx.throwGrenade(type);
    }
    // Quick throw: G throws a frag if carried.
    if (input.pressed.has('KeyG')) ctx.throwGrenade('frag');
  }

  // Round end by elimination.
  const botsAlive = bots.some((b) => b.alive);
  if (!botsAlive) {
    endRound(m, true, 'All defenders eliminated', player, bots);
    return;
  }
  if (!player.alive) {
    endRound(m, false, 'You were eliminated', player, bots);
  }
}

// Throw a grenade from the player's view direction.
export function throwGrenade(ctx, type) {
  const { player, grenades } = ctx;
  if (!player.alive || player.grenades[type] <= 0) return false;
  player.grenades[type] -= 1;
  const dir = new THREE.Vector3(0, 0, -1).applyEuler(
    new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'),
  );
  const pos = new THREE.Vector3(
    player.pos.x + dir.x * 0.6,
    player.pos.y + player.eyeHeight - 0.15,
    player.pos.z + dir.z * 0.6,
  );
  const vel = dir.clone().multiplyScalar(13);
  vel.y += 3.5;
  grenades.push(makeGrenade(type, player, pos, vel));
  sfx.throwPin();
  return true;
}
