// The player: a fighter with first-person movement. Acceleration-based walking,
// crouch, jump, axis-separated AABB collision, and the weapon state. The player
// is the only fighter driven by input; everything else reads its state.
import * as THREE from 'three';
import { collideCircle } from './world.js';
import { makeWeapon, tickWeapon, tryFire, releaseTrigger, startReload, currentSpread } from './weapons.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.1;
export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;

export function makePlayer(spawn) {
  const pistol = makeWeapon('pistol');
  return {
    name: 'You',
    team: 'attack',
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    vel: new THREE.Vector3(),
    yaw: spawn.yaw,
    pitch: 0,
    hp: 100,
    armor: 0,
    alive: true,
    height: PLAYER_HEIGHT,
    radius: PLAYER_RADIUS,
    eyeHeight: EYE_STAND,
    crouched: false,
    onGround: true,
    weapon: pistol,
    // Owned weapon instances, so ammo persists across switches.
    weapons: { pistol },
    grenades: { frag: 0, smoke: 0, flash: 0 },
    selected: 'pistol',
    // Recoil kick applied to pitch, recovered over time.
    recoilPitch: 0,
    money: 800,
    kills: 0,
    deaths: 0,
    // Footstep timing.
    stepTimer: 0,
    // Plant progress 0..1, and the site being planted at.
    planting: 0,
    plantSite: null,
    // Flash blindness 0..1 (1 = fully white).
    flash: 0,
  };
}

const _move = new THREE.Vector3();

// One fixed step of movement. `keys` is the input key set, `look` the consumed
// mouse delta. Returns 'step' when a footstep sound should play.
export function tickPlayer(p, keys, look, dt) {
  // Mouse look.
  p.yaw -= look.dx * 0.0022;
  p.pitch -= look.dy * 0.0022;
  const maxPitch = Math.PI / 2 - 0.05;
  p.pitch = Math.max(-maxPitch, Math.min(maxPitch, p.pitch));
  if (p.recoilPitch !== 0) {
    // Recoil is a decaying offset, not a permanent climb: the gun kicks up
    // with each shot and settles back when the player stops firing.
    p.recoilPitch *= Math.pow(0.0001, dt);
    if (Math.abs(p.recoilPitch) < 0.0001) p.recoilPitch = 0;
  }

  const crouched = keys.has('ControlLeft') || keys.has('ControlRight');
  p.crouched = crouched;
  const targetEye = crouched ? EYE_CROUCH : EYE_STAND;
  p.eyeHeight += (targetEye - p.eyeHeight) * Math.min(1, dt * 12);

  const speed = p.weapon.def.speed * (crouched ? 0.5 : 1);
  let fwd = 0;
  let strafe = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
  const len = Math.hypot(fwd, strafe) || 1;
  fwd /= len;
  strafe /= len;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  // Forward is -Z rotated by yaw; right is +X rotated by yaw.
  _move.set(-sin * fwd + cos * strafe, 0, -cos * fwd - sin * strafe);

  const accel = p.onGround ? 55 : 12;
  p.vel.x += _move.x * accel * dt;
  p.vel.z += _move.z * accel * dt;
  // Friction when no input.
  if (fwd === 0 && strafe === 0 && p.onGround) {
    const damp = Math.max(0, 1 - dt * 11);
    p.vel.x *= damp;
    p.vel.z *= damp;
  }
  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  if (hSpeed > speed) {
    p.vel.x *= speed / hSpeed;
    p.vel.z *= speed / hSpeed;
  }

  // Jump.
  if (keys.has('Space') && p.onGround) {
    p.vel.y = 5.4;
    p.onGround = false;
  }
  p.vel.y -= 16 * dt;
  p.pos.y += p.vel.y * dt;
  if (p.pos.y <= 0) {
    p.pos.y = 0;
    p.vel.y = 0;
    p.onGround = true;
  }

  // Axis-separated collision against the map boxes.
  p.pos.x += p.vel.x * dt;
  let push = collideCircle(p.pos.x, p.pos.z, PLAYER_RADIUS);
  if (push) {
    p.pos.x += push.x;
    p.pos.z += push.z;
  }
  p.pos.z += p.vel.z * dt;
  push = collideCircle(p.pos.x, p.pos.z, PLAYER_RADIUS);
  if (push) {
    p.pos.x += push.x;
    p.pos.z += push.z;
  }

  // Footsteps.
  let stepped = false;
  if (p.onGround && hSpeed > 2) {
    p.stepTimer -= dt * hSpeed;
    if (p.stepTimer <= 0) {
      p.stepTimer = 2.6;
      stepped = true;
    }
  }
  if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 0.5);
  return stepped ? 'step' : null;
}

// Advance the player's weapon. Returns 'reloaded' on the step the mag fills.
export function tickPlayerWeapon(p, dt) {
  return tickWeapon(p.weapon, dt);
}

// Fire the player's selected weapon once, if the trigger rules allow it.
// `rng` supplies the spread. Returns a shot record or null.
export function playerShoot(p, rng, triggerHeld, triggerWasHeld) {
  const res = tryFire(p.weapon, triggerHeld, triggerWasHeld);
  if (!res.fired) return { fired: false, reason: res.reason };
  const moving = Math.hypot(p.vel.x, p.vel.z) > 1.2;
  const spread = currentSpread(p.weapon, moving, p.crouched, false);
  // Direction from yaw/pitch with gaussian spread. The recoil offset is part
  // of the aim while it lasts, so a burst climbs and then settles.
  const dir = new THREE.Vector3(0, 0, -1);
  dir.applyEuler(new THREE.Euler(p.pitch + p.recoilPitch + rng.gauss() * spread, p.yaw + rng.gauss() * spread, 0, 'YXZ'));
  p.recoilPitch += p.weapon.def.recoil * 0.55;
  return { fired: true, dir };
}

export function playerReload(p) {
  return startReload(p.weapon);
}

export function playerReleaseTrigger(p) {
  releaseTrigger(p.weapon);
}

// Switch to an owned weapon instance, so its ammo persists. Returns true.
export function selectWeapon(p, id) {
  const w = p.weapons[id];
  if (!w || p.weapon.id === id) return !!w;
  p.weapon = w;
  p.selected = id;
  return true;
}

// Give the player a weapon instance (bought in the buy menu).
export function giveWeapon(p, id) {
  if (!p.weapons[id]) p.weapons[id] = makeWeapon(id);
  p.weapon = p.weapons[id];
  p.selected = id;
  return p.weapons[id];
}
