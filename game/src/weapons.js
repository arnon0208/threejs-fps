// Weapons. Each definition is data; the firing math lives in `fireWeapon` below
// so the player and the bots share one gun model. Damage falls off with range,
// headshots multiply, armor absorbs half, and moving or firing on full-auto opens
// the spread — stopping to aim pays, as the bounty asks.
export const WEAPONS = {
  pistol: {
    name: 'P226',
    kind: 'pistol',
    price: 0,
    damage: 34,
    headMult: 2,
    range: 40,
    falloff: 0.6,
    fireInterval: 0.16,
    auto: false,
    mag: 12,
    reserve: 48,
    reloadTime: 1.5,
    spread: 0.004,
    moveSpread: 0.02,
    recoil: 0.011,
    bloomHalflife: 0.09,
    speed: 5.4,
  },
  rifle: {
    name: 'VK-47',
    kind: 'rifle',
    price: 2700,
    damage: 36,
    headMult: 3,
    range: 60,
    falloff: 0.55,
    fireInterval: 0.1,
    auto: true,
    mag: 30,
    reserve: 90,
    reloadTime: 2.2,
    spread: 0.003,
    moveSpread: 0.03,
    recoil: 0.016,
    bloomHalflife: 0.08,
    speed: 5.0,
  },
  smg: {
    name: 'Raptor-9',
    kind: 'smg',
    price: 1500,
    damage: 26,
    headMult: 2,
    range: 30,
    falloff: 0.5,
    fireInterval: 0.07,
    auto: true,
    mag: 32,
    reserve: 128,
    reloadTime: 1.9,
    spread: 0.008,
    moveSpread: 0.035,
    recoil: 0.009,
    bloomHalflife: 0.11,
    speed: 5.3,
  },
};

export const ORDER = ['pistol', 'rifle', 'smg'];

// A live weapon instance: ammo counts and the recoil/bloom state. `makeWeapon`
// clones a definition so the player and each bot carry their own.
export function makeWeapon(id) {
  const def = WEAPONS[id];
  return {
    id,
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloading: 0,
    bloom: 0,
    // True after a semi-auto shot until the trigger is released.
    triggerLatch: false,
  };
}

// Current spread in radians for a shot: base + bloom + movement, less when
// crouched or aiming down sights.
export function currentSpread(w, moving, crouched, aiming) {
  let s = w.def.spread + w.bloom + (moving ? w.def.moveSpread : 0);
  if (crouched) s *= 0.6;
  if (aiming) s *= 0.55;
  return s;
}

// Advance cooldowns/reload. Returns 'reloaded' on the step the mag fills.
export function tickWeapon(w, dt) {
  if (w.cooldown > 0) w.cooldown -= dt;
  // Bloom decays exponentially, so a burst opens the spread and it settles
  // back quickly when the player stops firing.
  if (w.bloom > 0) {
    w.bloom *= Math.pow(0.5, dt / w.def.bloomHalflife);
    if (w.bloom < 0.0005) w.bloom = 0;
  }
  if (w.reloading > 0) {
    w.reloading -= dt;
    if (w.reloading <= 0) {
      w.reloading = 0;
      const need = w.def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      return 'reloaded';
    }
  }
  return null;
}

// Try to fire once. Returns { fired: true } or { fired: false, reason }.
// `triggerHeld` is the trigger state; semi-auto weapons latch until release.
export function tryFire(w, triggerHeld, triggerWasHeld) {
  if (w.reloading > 0) return { fired: false, reason: 'reloading' };
  if (w.cooldown > 0) return { fired: false, reason: 'cooldown' };
  if (w.mag <= 0) return { fired: false, reason: 'empty' };
  if (!triggerHeld) return { fired: false, reason: 'released' };
  if (!w.def.auto && triggerWasHeld && w.triggerLatch) return { fired: false, reason: 'latch' };
  w.mag -= 1;
  w.cooldown = w.def.fireInterval;
  w.bloom = Math.min(0.04, w.bloom + w.def.recoil * 0.5);
  w.triggerLatch = true;
  return { fired: true };
}

export function releaseTrigger(w) {
  w.triggerLatch = false;
}

export function startReload(w) {
  if (w.reloading > 0 || w.mag >= w.def.mag || w.reserve <= 0) return false;
  w.reloading = w.def.reloadTime;
  return true;
}

// Damage at a range, before armor: linear falloff past half the weapon's range.
export function damageAt(def, dist, headshot) {
  const half = def.range * 0.5;
  const fall = dist <= half ? 1 : Math.max(def.falloff, 1 - (dist - half) / def.range);
  return def.damage * fall * (headshot ? def.headMult : 1);
}
