// Bots: the defending team. Each bot is a fighter with a small state machine —
// HOLD at a site, PATROL a waypoint route, INVESTIGATE a noise, ENGAGE a visible
// target, DEFUSE a planted charge, RETREAT when hurt. They see through a vision
// cone, hear gunfire, strafe while firing in bursts, and their aim error grows
// with distance and target speed, so a moving player is hard to hit and a still
// one is not. All bot decisions live here; the match code only feeds events.
import * as THREE from 'three';
import { WAYPOINTS, WAY_EDGES, nearestWaypoint, findPath, collideCircle } from './world.js';
import { hasLineOfSight, blockedBySmoke } from './combat.js';
import { makeWeapon, tickWeapon, currentSpread } from './weapons.js';
import { makeRng } from './rng.js';

export const BOT_NAMES = ['Vex', 'Rook', 'Hale', 'Moss'];
export const BOT_HEIGHT = 1.8;
export const BOT_RADIUS = 0.4;

const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();

export function makeBot(index, spawn, seed) {
  const rng = makeRng(seed + index * 7919);
  return {
    name: BOT_NAMES[index % BOT_NAMES.length],
    team: 'defense',
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    vel: new THREE.Vector3(),
    yaw: spawn.yaw,
    pitch: 0,
    hp: 100,
    armor: 25,
    alive: true,
    height: BOT_HEIGHT,
    radius: BOT_RADIUS,
    eyeHeight: 1.55,
    weapon: makeWeapon('rifle'),
    state: 'hold',
    rng,
    // Navigation.
    route: [],
    routeIndex: 0,
    holdTimer: rng.range(2, 5),
    holdYaw: spawn.yaw,
    scanPhase: rng.range(0, Math.PI * 2),
    // Perception.
    target: null,
    lastSeen: null,
    reaction: 0,
    heard: null,
    // Combat.
    burstLeft: 0,
    burstPause: 0,
    strafeDir: 1,
    strafeTimer: 0,
    aimError: 0.02,
    // Defuse.
    defusing: 0,
    // Movement.
    speed: 3.4,
    moveAnim: 0,
    // Muzzle flash timer for the renderer.
    muzzle: 0,
    // Where the bot was last damaged from (for retreat direction).
    hurtFrom: null,
  };
}

// --- Helpers ----------------------------------------------------------------

function dist2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function angleTo(bot, x, z) {
  return Math.atan2(-(x - bot.pos.x), -(z - bot.pos.z));
}

function turnToward(bot, targetYaw, dt, rate = 6) {
  let d = targetYaw - bot.yaw;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const step = Math.max(-rate * dt, Math.min(rate * dt, d));
  bot.yaw += step;
  return Math.abs(d) < 0.05;
}

// Move toward (x, z) with map collision. Returns true on arrival.
function moveToward(bot, x, z, dt, speed) {
  const dx = x - bot.pos.x;
  const dz = z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.6) return true;
  const vx = (dx / dist) * speed;
  const vz = (dz / dist) * speed;
  bot.pos.x += vx * dt;
  let push = collideCircle(bot.pos.x, bot.pos.z, BOT_RADIUS);
  if (push) {
    bot.pos.x += push.x;
    bot.pos.z += push.z;
  }
  bot.pos.z += vz * dt;
  push = collideCircle(bot.pos.x, bot.pos.z, BOT_RADIUS);
  if (push) {
    bot.pos.x += push.x;
    bot.pos.z += push.z;
  }
  bot.moveAnim += dt * speed * 2;
  return dist < 0.8;
}

// Can this bot see the player right now? Vision cone ~110°, 45 m, walls and
// smoke block. A shooting or sprinting player is heard first (handled by the
// match code setting `heard`), which is what turns a bot toward the noise.
export function botCanSee(bot, player, smokes) {
  if (!player.alive) return false;
  const d = dist2D(bot.pos, player.pos);
  if (d > 45) return false;
  // Vision cone, unless the player is very close.
  if (d > 6) {
    const want = angleTo(bot, player.pos.x, player.pos.z);
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) > 1.05) return false;
  }
  _eye.set(bot.pos.x, bot.pos.y, bot.pos.z);
  if (!hasLineOfSight(_eye, bot.eyeHeight, player, smokes)) return false;
  if (blockedBySmoke(_eye, player, smokes)) return false;
  return true;
}

// --- The tick ----------------------------------------------------------------

// `world` carries: player, smokes, charge (planted bomb or null), time, and the
// event callbacks onBotShot(bot, hit), onBotKilled(bot, killer), onNoise(pos).
export function tickBot(bot, world, dt) {
  if (!bot.alive) return;
  const { player, smokes } = world;
  tickWeapon(bot.weapon, dt);
  if (bot.muzzle > 0) bot.muzzle -= dt;

  const sees = botCanSee(bot, player, smokes);
  if (sees) {
    bot.lastSeen = { x: player.pos.x, z: player.pos.z, t: world.time };
    if (bot.state !== 'engage') {
      bot.state = 'engage';
      // Reaction delay: further away and moving targets take longer to acquire.
      const d = dist2D(bot.pos, player.pos);
      const moving = Math.hypot(player.vel.x, player.vel.z) > 2;
      bot.reaction = 0.32 + d * 0.008 + (moving ? 0.12 : 0) + bot.rng.range(0, 0.15);
      bot.burstLeft = 0;
      bot.burstPause = 0;
    }
  } else if (bot.state === 'engage') {
    // Lost sight: keep the last known spot for a moment, then investigate it.
    const sinceSeen = world.time - (bot.lastSeen ? bot.lastSeen.t : 0);
    if (sinceSeen > 1.6) {
      bot.state = 'investigate';
      bot.heard = { x: bot.lastSeen.x, z: bot.lastSeen.z };
    }
  }

  switch (bot.state) {
    case 'engage':
      tickEngage(bot, world, dt);
      break;
    case 'investigate': {
      const target = bot.heard || { x: player.pos.x, z: player.pos.z };
      const arrived = moveToward(bot, target.x, target.z, dt, bot.speed);
      turnToward(bot, angleTo(bot, target.x, target.z), dt, 4);
      if (arrived) {
        bot.holdTimer -= dt;
        // Scan the area, then fall back to holding a site.
        bot.yaw += dt * 0.8;
        if (bot.holdTimer <= 0) {
          bot.state = 'hold';
          bot.holdTimer = bot.rng.range(2, 5);
          bot.route = [];
        }
      } else {
        bot.holdTimer = 2;
      }
      break;
    }
    case 'defuse': {
      const charge = world.charge;
      if (!charge || charge.defused || charge.detonated) {
        bot.state = 'hold';
        break;
      }
      const arrived = moveToward(bot, charge.site.x, charge.site.z, dt, bot.speed * 1.15);
      if (arrived) {
        bot.defusing += dt;
        if (bot.defusing >= 5) {
          charge.defused = true;
        }
      } else {
        bot.defusing = 0;
      }
      break;
    }
    case 'retreat': {
      // Fall back toward the nearest site, then hold.
      const site = nearestSite(bot);
      const arrived = moveToward(bot, site.x, site.z, dt, bot.speed * 1.1);
      if (arrived || bot.hp > 55) {
        bot.state = 'hold';
        bot.holdTimer = bot.rng.range(2, 4);
      }
      break;
    }
    case 'patrol': {
      if (!bot.route.length) {
        bot.state = 'hold';
        break;
      }
      const wp = WAYPOINTS[bot.route[bot.routeIndex]];
      const arrived = moveToward(bot, wp.x, wp.z, dt, bot.speed * 0.8);
      turnToward(bot, angleTo(bot, wp.x, wp.z), dt, 4);
      if (arrived) {
        bot.routeIndex += 1;
        if (bot.routeIndex >= bot.route.length) {
          bot.state = 'hold';
          bot.holdTimer = bot.rng.range(3, 6);
        }
      }
      break;
    }
    case 'hold':
    default: {
      // Slow scan, then pick a patrol route through the lanes.
      bot.holdTimer -= dt;
      bot.yaw = bot.holdYaw + Math.sin(world.time * 0.5 + bot.scanPhase) * 0.7;
      if (bot.holdTimer <= 0) {
        const from = nearestWaypoint(bot.pos.x, bot.pos.z);
        const to = bot.rng.pick([11, 12, 6, 9, 10]);
        bot.route = findPath(from, to);
        bot.routeIndex = 0;
        bot.state = bot.route.length > 1 ? 'patrol' : 'hold';
        bot.holdTimer = bot.rng.range(3, 6);
      }
      break;
    }
  }

  // Low health: break off and fall back.
  if (bot.alive && bot.hp < 30 && bot.state !== 'retreat' && bot.state !== 'engage') {
    bot.state = 'retreat';
  }
}

function nearestSite(bot) {
  const a = Math.hypot(bot.pos.x - 19, bot.pos.z + 14);
  const b = Math.hypot(bot.pos.x + 17.5, bot.pos.z + 14.5);
  return a < b ? { x: 19, z: -14 } : { x: -17.5, z: -14.5 };
}

function tickEngage(bot, world, dt) {
  const { player } = world;
  const d = dist2D(bot.pos, player.pos);
  // Face the player.
  turnToward(bot, angleTo(bot, player.pos.x, player.pos.z), dt, 7);
  // Strafe sideways, flipping direction every 0.7–1.4 s.
  bot.strafeTimer -= dt;
  if (bot.strafeTimer <= 0) {
    bot.strafeDir = bot.rng.next() < 0.5 ? -1 : 1;
    bot.strafeTimer = bot.rng.range(0.7, 1.4);
  }
  const side = bot.strafeDir;
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  const sx = -fz * side;
  const sz = fx * side;
  // Keep some distance: back off when too close, close in when too far.
  let mx = sx * 0.8;
  let mz = sz * 0.8;
  if (d > 22) {
    mx += fx * 0.9;
    mz += fz * 0.9;
  } else if (d < 7) {
    mx -= fx * 0.9;
    mz -= fz * 0.9;
  }
  const ml = Math.hypot(mx, mz) || 1;
  bot.pos.x += (mx / ml) * bot.speed * 0.7 * dt;
  let push = collideCircle(bot.pos.x, bot.pos.z, BOT_RADIUS);
  if (push) {
    bot.pos.x += push.x;
    bot.pos.z += push.z;
  }
  bot.pos.z += (mz / ml) * bot.speed * 0.7 * dt;
  push = collideCircle(bot.pos.x, bot.pos.z, BOT_RADIUS);
  if (push) {
    bot.pos.x += push.x;
    bot.pos.z += push.z;
  }
  bot.moveAnim += dt * 4;

  // Fire in bursts after the reaction delay.
  if (bot.reaction > 0) {
    bot.reaction -= dt;
    return;
  }
  if (bot.burstPause > 0) {
    bot.burstPause -= dt;
    return;
  }
  if (bot.burstLeft <= 0) {
    bot.burstLeft = bot.rng.int(3, 5);
    bot.burstPause = 0;
  }
  if (bot.weapon.cooldown > 0 || bot.weapon.reloading > 0) return;
  if (bot.weapon.mag <= 0) {
    bot.weapon.reloading = bot.weapon.def.reloadTime;
    return;
  }
  // Aim error: distance + player movement + player crouch + bot's own motion.
  const moving = Math.hypot(player.vel.x, player.vel.z) > 2;
  const err = 0.012 + d * 0.0011 + (moving ? 0.014 : 0) + (player.crouched ? -0.004 : 0);
  const spread = currentSpread(bot.weapon, true, false, false);
  const totalErr = err + spread;
  // Direction to the player's chest, with gaussian error.
  const tx = player.pos.x;
  const ty = player.pos.y + (bot.rng.next() < 0.12 ? player.height * 0.92 : player.height * 0.62);
  const tz = player.pos.z;
  const ox = bot.pos.x;
  const oy = bot.pos.y + bot.eyeHeight;
  const oz = bot.pos.z;
  _dir.set(tx - ox, ty - oy, tz - oz).normalize();
  // Apply the error as a small random rotation around the aim axis.
  const ex = bot.rng.gauss() * totalErr;
  const ey = bot.rng.gauss() * totalErr;
  _dir.x += ex;
  _dir.y += ey;
  _dir.normalize();
  bot.weapon.mag -= 1;
  bot.weapon.cooldown = bot.weapon.def.fireInterval;
  bot.weapon.bloom = Math.min(0.05, bot.weapon.bloom + 0.012);
  bot.burstLeft -= 1;
  if (bot.burstLeft <= 0) bot.burstPause = bot.rng.range(0.45, 0.8);
  bot.muzzle = 0.06;
  world.onBotShot(bot, _dir.clone());
}

// A bot hears a noise (gunshot, explosion, plant) inside 30 m.
export function botHear(bot, x, z) {
  if (!bot.alive) return;
  const d = Math.hypot(bot.pos.x - x, bot.pos.z - z);
  if (d > 32) return;
  if (bot.state === 'engage' || bot.state === 'defuse') return;
  bot.heard = { x, z };
  bot.state = 'investigate';
  bot.holdTimer = 2;
}

// Send the nearest living bot to defuse a planted charge.
export function sendDefuser(bots, charge) {
  let best = null;
  let bestD = Infinity;
  for (const b of bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - charge.site.x, b.pos.z - charge.site.z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (best) {
    best.state = 'defuse';
    best.defusing = 0;
    best.route = [];
  }
}
