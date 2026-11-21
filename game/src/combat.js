// Combat: hitscan raycasts against fighters, damage with armor, and grenades.
// A fighter is { pos (feet, THREE.Vector3), yaw, hp, armor, alive, team, name,
// height, radius }. The player and the bots are both fighters, so one code path
// resolves every shot. No allocations in the hot path: the scratch vectors below
// are module-level and reused.
import * as THREE from 'three';
import { segmentBlocked } from './world.js';
import { damageAt } from './weapons.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

// Ray vs a fighter's body cylinder + head sphere. Returns the nearest hit
// { t, part: 'head' | 'body', point } or null. `origin`/`dir` are Vector3s.
export function rayHitFighter(origin, dir, maxDist, f) {
  const cx = f.pos.x;
  const cz = f.pos.z;
  const r = f.radius;
  // Body cylinder: solve in XZ, then check the height band.
  const ox = origin.x - cx;
  const oz = origin.z - cz;
  const a = dir.x * dir.x + dir.z * dir.z;
  let best = null;
  if (a > 1e-9) {
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t = (-b - sq) / (2 * a);
      if (t > 0 && t < maxDist) {
        const y = origin.y + dir.y * t;
        const top = f.pos.y + f.height * 0.86;
        if (y >= f.pos.y && y <= top) best = { t, part: 'body' };
      }
    }
  }
  // Head sphere, radius 0.24, centred at 92% of the fighter's height.
  const hx = cx;
  const hy = f.pos.y + f.height * 0.92;
  const hz = cz;
  const lx = origin.x - hx;
  const ly = origin.y - hy;
  const lz = origin.z - hz;
  const b2 = 2 * (lx * dir.x + ly * dir.y + lz * dir.z);
  const c2 = lx * lx + ly * ly + lz * lz - 0.24 * 0.24;
  const disc2 = b2 * b2 - 4 * c2;
  if (disc2 >= 0) {
    const t = (-b2 - Math.sqrt(disc2)) / 2;
    if (t > 0 && t < maxDist && (!best || t < best.t)) best = { t, part: 'head' };
  }
  return best;
}

// Fire one hitscan shot from `shooter` along `dir` (already spread-applied).
// `fighters` are the possible targets (never the shooter). `smokes` are active
// smoke clouds, which do NOT block player shots. Returns the hit or null, and
// applies damage through `onDamage(shooter, target, dmg, headshot)`.
export function resolveShot(shooter, dir, fighters, smokes, onDamage) {
  const eye = _v.set(shooter.pos.x, shooter.pos.y + shooter.eyeHeight, shooter.pos.z);
  const weapon = shooter.weapon;
  const maxDist = weapon.def.range;
  let bestTarget = null;
  let bestHit = null;
  for (const f of fighters) {
    if (!f.alive || f === shooter) continue;
    const hit = rayHitFighter(eye, dir, maxDist, f);
    if (!hit || (bestHit && hit.t >= bestHit.t)) continue;
    // A wall between muzzle and target stops the shot.
    const px = eye.x + dir.x * hit.t;
    const py = eye.y + dir.y * hit.t;
    const pz = eye.z + dir.z * hit.t;
    if (segmentBlocked(eye.x, eye.z, eye.y, px, pz, py)) continue;
    bestHit = hit;
    bestTarget = f;
  }
  if (!bestTarget) return null;
  const dmg = damageAt(weapon.def, bestHit.t, bestHit.part === 'head');
  onDamage(shooter, bestTarget, dmg, bestHit.part === 'head', bestHit.t);
  return { target: bestTarget, part: bestHit.part, dist: bestHit.t };
}

// Apply damage with armor: armor absorbs half the damage until it is spent.
export function applyDamage(target, dmg) {
  let rest = dmg;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, rest * 0.5);
    target.armor -= absorbed;
    rest -= absorbed;
  }
  target.hp -= rest;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
  }
  return rest;
}

// --- Grenades ----------------------------------------------------------------

export const GRENADES = {
  frag: { price: 300, fuse: 1.8, radius: 6.5, damage: 110 },
  smoke: { price: 300, fuse: 1.1, radius: 3.6, duration: 16 },
  flash: { price: 200, fuse: 1.4, radius: 26, duration: 2.5 },
};

// A thrown grenade: simple ballistic arc, one bounce, then its fuse runs out.
export function makeGrenade(type, owner, pos, vel) {
  return {
    type,
    owner,
    pos: pos.clone(),
    vel: vel.clone(),
    fuse: GRENADES[type].fuse,
    bounced: false,
    done: false,
  };
}

const GRAVITY = 14;

export function tickGrenade(g, dt, onDetonate) {
  g.vel.y -= GRAVITY * dt;
  g.pos.addScaledVector(g.vel, dt);
  if (g.pos.y < 0.12) {
    g.pos.y = 0.12;
    if (!g.bounced) {
      g.vel.y = Math.abs(g.vel.y) * 0.35;
      g.vel.x *= 0.6;
      g.vel.z *= 0.6;
      g.bounced = true;
    } else {
      g.vel.y = 0;
      g.vel.x *= 0.85;
      g.vel.z *= 0.85;
    }
  }
  g.fuse -= dt;
  if (g.fuse <= 0 && !g.done) {
    g.done = true;
    onDetonate(g);
  }
}

// Frag damage: falloff with distance, blocked by walls between blast and target.
export function fragDamage(g, fighters, onDamage) {
  const def = GRENADES.frag;
  for (const f of fighters) {
    if (!f.alive) continue;
    const dx = f.pos.x - g.pos.x;
    const dz = f.pos.z - g.pos.z;
    const dy = (f.pos.y + 0.9) - (g.pos.y + 0.12);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > def.radius) continue;
    if (segmentBlocked(g.pos.x, g.pos.z, g.pos.y + 0.12, f.pos.x, f.pos.z, f.pos.y + 0.9)) continue;
    const dmg = def.damage * (1 - (dist / def.radius) * 0.75);
    onDamage(g.owner, f, dmg, false, dist);
  }
}

// Is `from` visible from `eye` (a Vector3) at `eyeHeight`, ignoring smoke?
// Used by bot sight: walls block, smoke does not (smoke is checked separately).
export function hasLineOfSight(eye, eyeHeight, target, smokes) {
  const tx = target.pos.x;
  const tz = target.pos.z;
  const ty = target.pos.y + target.height * 0.7;
  if (segmentBlocked(eye.x, eye.z, eye.y + eyeHeight, tx, tz, ty)) return false;
  return true;
}

// Is the segment eye->target inside any smoke cloud? Smoke blocks bot vision.
export function blockedBySmoke(eye, target, smokes) {
  for (const s of smokes) {
    if (s.type !== 'smoke' || s.expired) continue;
    // Distance from the segment to the cloud centre, in 3D.
    _d.set(target.pos.x - eye.x, (target.pos.y + 0.9) - eye.y, target.pos.z - eye.z);
    const len = _d.length();
    if (len < 1e-6) continue;
    _d.multiplyScalar(1 / len);
    const cx = s.pos.x - eye.x;
    const cy = (s.pos.y + 1) - eye.y;
    const cz = s.pos.z - eye.z;
    const t = Math.max(0, Math.min(len, cx * _d.x + cy * _d.y + cz * _d.z));
    const px = eye.x + _d.x * t;
    const py = eye.y + _d.y * t;
    const pz = eye.z + _d.z * t;
    const ddx = s.pos.x - px;
    const ddy = (s.pos.y + 1) - py;
    const ddz = s.pos.z - pz;
    if (ddx * ddx + ddy * ddy + ddz * ddz < s.radius * s.radius) return true;
  }
  return false;
}
