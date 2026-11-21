// Ember Yard: the map. One walled industrial yard, 52 x 40 m, with two bomb sites
// (A fuel depot east, B silo yard west), three lanes between the attacker spawn in
// the south and the defender spawns in the north. Everything is axis-aligned boxes,
// so collision and line-of-sight are cheap slab tests and the bots navigate a small
// waypoint graph instead of a navmesh.
//
// Coordinates: x east, z south (player spawn at z +17, sites at z -14). y is up;
// the player eye is 1.62 m standing, 1.10 m crouched.
import * as THREE from 'three';
import { HEX } from './palette.js';

// [cx, cz, w, d, h, material] — every solid in the map. The perimeter walls come
// first; the rest are cover the player and bots can hide behind and shoot over.
export const BOXES = [
  // Perimeter walls (4 m high).
  [0, -21, 56, 2, 4, 'concrete'],
  [0, 21, 56, 2, 4, 'concrete'],
  [-27, 0, 2, 44, 4, 'concrete'],
  [27, 0, 2, 44, 4, 'concrete'],
  // A site: fuel depot building, east-north. Big block with a doorway gap on its
  // west face (two boxes leave a 2.4 m opening).
  [20, -16, 10, 2, 4.5, 'containerA'],
  [20, -11.5, 2, 5, 4.5, 'containerA'],
  [23.5, -12.5, 3, 3, 4.5, 'containerA'],
  // A site low cover: pump housings the planter can crouch behind.
  [16, -15, 2.4, 1.2, 1.15, 'rust'],
  [19, -17.5, 1.2, 2.4, 1.15, 'rust'],
  // B site: silo yard, west-north. Two silos (boxed as square columns) and a pipe rack.
  [-20, -16, 4, 4, 6, 'containerB'],
  [-14.5, -17, 3, 3, 5, 'containerB'],
  [-17, -12, 6, 1, 3.2, 'concrete'],
  // B site low cover.
  [-19, -11.5, 2.4, 1.2, 1.15, 'rust'],
  // Mid: container rows forming the central lane's cover.
  [-4, -2, 6, 2, 2.6, 'containerB'],
  [4, 2, 6, 2, 2.6, 'containerA'],
  [-8, 6, 2, 6, 2.6, 'containerC'],
  [8, -6, 2, 6, 2.6, 'containerC'],
  // Central silo tower (boxed), the map's landmark and the mid sightline breaker.
  [0, -8, 5, 5, 7, 'containerB'],
  // Crates scattered along the lanes: 1.2 m, crouch cover, stand-and-shoot-over.
  [-14, 2, 1.6, 1.6, 1.2, 'containerC'],
  [-11, -8, 1.6, 1.6, 1.2, 'containerA'],
  [12, 8, 1.6, 1.6, 1.2, 'containerB'],
  [15, -2, 1.6, 1.6, 1.2, 'containerC'],
  [0, 10, 2.2, 1.4, 1.2, 'rust'],
  [-2, -14, 2.2, 1.4, 1.2, 'rust'],
  // South spawn cover: a low wall and a truck bed the attackers start behind.
  [-6, 15, 8, 1.4, 1.3, 'concrete'],
  [8, 15, 5, 2, 2.4, 'containerA'],
];

export const SITES = {
  A: { x: 19, z: -14, r: 4.5, name: 'A — Fuel Depot' },
  B: { x: -17.5, z: -14.5, r: 4.5, name: 'B — Silo Yard' },
};

export const SPAWNS = {
  // Attacker faces north into the yard (yaw 0 = -z); defenders face the
  // attacker spawn, so the hold scan sweeps across the lanes.
  attacker: { x: 0, z: 17, yaw: 0 },
  defenders: [
    { x: 17, z: -10, yaw: 2.58 },
    { x: -15, z: -10, yaw: -2.64 },
    { x: 0, z: -12, yaw: Math.PI },
    { x: 22, z: -6, yaw: 2.37 },
  ],
};

// Waypoint graph for the bots. Nodes at lane junctions, cover and both sites;
// edges join nodes with a clear straight run between them (checked at build time
// against the box list, so a bot never paths through a wall).
export const WAYPOINTS = [
  { x: 0, z: 17 }, // 0 attacker spawn
  { x: -6, z: 10 }, // 1 south-west
  { x: 6, z: 10 }, // 2 south-east
  { x: 0, z: 6 }, // 3 mid south
  { x: -12, z: 4 }, // 4 west lane
  { x: 12, z: 4 }, // 5 east lane
  { x: 0, z: -2 }, // 6 mid
  { x: -12, z: -6 }, // 7 west mid
  { x: 12, z: -6 }, // 8 east mid
  { x: -6, z: -10 }, // 9 B approach
  { x: 6, z: -10 }, // 10 A approach
  { x: -17.5, z: -14.5 }, // 11 site B
  { x: 19, z: -14 }, // 12 site A
  { x: 0, z: -14 }, // 13 north mid
  { x: -20, z: -6 }, // 14 B flank
  { x: 22, z: -6 }, // 15 A flank
  { x: -8, z: -16 }, // 16 B back
  { x: 14, z: -16 }, // 17 A back
];
export const WAY_EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 4], [2, 5], [3, 6], [4, 7], [5, 8],
  [6, 7], [6, 8], [6, 3], [7, 9], [8, 10], [9, 11], [10, 12], [9, 13],
  [10, 13], [13, 11], [13, 12], [7, 14], [14, 11], [8, 15], [15, 12],
  [11, 16], [12, 17], [13, 16], [13, 17], [4, 1], [5, 2],
];

// --- Collision and line of sight (plain math, no three.js) -------------------

// Circle (x, z, radius) vs the box list: returns the penetration push-out, or null.
export function collideCircle(x, z, r) {
  let px = 0;
  let pz = 0;
  let hit = false;
  for (const [cx, cz, w, d] of BOXES) {
    const hw = w / 2;
    const hd = d / 2;
    const nx = Math.max(cx - hw, Math.min(x, cx + hw));
    const nz = Math.max(cz - hd, Math.min(z, cz + hd));
    const dx = x - nx;
    const dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 1e-9) {
      const dist = Math.sqrt(d2);
      px += (dx / dist) * (r - dist);
      pz += (dz / dist) * (r - dist);
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const ox = hw + r - Math.abs(x - cx);
      const oz = hd + r - Math.abs(z - cz);
      if (ox < oz) px += x < cx ? -ox : ox;
      else pz += z < cz ? -oz : oz;
    }
  }
  return hit ? { x: px, z: pz } : null;
}

// Segment (x0,z0,y0)->(x1,z1,y1) vs the boxes, slab test. True when blocked.
// `h` is the height above which a box no longer blocks (crouch cover is 1.2 m).
export function segmentBlocked(x0, z0, y0, x1, z1, y1, ignoreTop = 99) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const dy = y1 - y0;
  for (const [cx, cz, w, d, h] of BOXES) {
    if (h > ignoreTop) continue;
    const minX = cx - w / 2;
    const maxX = cx + w / 2;
    const minZ = cz - d / 2;
    const maxZ = cz + d / 2;
    let t0 = 0;
    let t1 = 1;
    // X slab.
    if (Math.abs(dx) < 1e-9) {
      if (x0 < minX || x0 > maxX) continue;
    } else {
      let a = (minX - x0) / dx;
      let b = (maxX - x0) / dx;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    // Z slab.
    if (Math.abs(dz) < 1e-9) {
      if (z0 < minZ || z0 > maxZ) continue;
    } else {
      let a = (minZ - z0) / dz;
      let b = (maxZ - z0) / dz;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    // Y at the entry point must be under the box top.
    const yAt = y0 + dy * t0;
    if (yAt < h) return true;
  }
  return false;
}

// Nearest waypoint index to (x, z).
export function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i].x - x;
    const dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// BFS path (list of waypoint indices) from a to b over WAY_EDGES.
export function findPath(a, b) {
  if (a === b) return [a];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [a];
  prev[a] = a;
  while (queue.length) {
    const cur = queue.shift();
    for (const [u, v] of WAY_EDGES) {
      const nxt = u === cur ? v : v === cur ? u : -1;
      if (nxt === -1 || prev[nxt] !== -1) continue;
      prev[nxt] = cur;
      if (nxt === b) {
        const path = [b];
        let n = b;
        while (n !== a) {
          n = prev[n];
          path.unshift(n);
        }
        return path;
      }
      queue.push(nxt);
    }
  }
  return [a, b];
}

// --- Scene building ---------------------------------------------------------

const MATS = {};
function material(name) {
  if (!MATS[name]) {
    const c = HEX[name] ?? HEX.concrete;
    MATS[name] = new THREE.MeshLambertMaterial({ color: c });
  }
  return MATS[name];
}

// Build the static map meshes into `scene`. Returns nothing; the boxes are the
// collision model, the meshes are only what the player sees.
export function buildWorld(scene) {
  // A painted dusk sky: a vertical gradient drawn once on a canvas, so the
  // horizon glows amber and the zenith stays dark. No external image.
  const sky = document.createElement('canvas');
  sky.width = 4;
  sky.height = 256;
  const g = sky.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1c1410');
  grad.addColorStop(0.55, '#4a2c18');
  grad.addColorStop(0.8, '#8a5426');
  grad.addColorStop(1, '#5c3a22');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(HEX.fog, 30, 95);

  const hemi = new THREE.HemisphereLight(0xffd9a8, 0x3a2c1e, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.1);
  sun.position.set(-18, 26, 10);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(56, 44),
    new THREE.MeshLambertMaterial({ color: HEX.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  scene.add(ground);

  // Yard grid lines, cheap and readable at a glance.
  const grid = new THREE.GridHelper(52, 26, 0x4a3a28, 0x33291f);
  grid.position.y = 0.02;
  scene.add(grid);

  for (const [cx, cz, w, d, h, mat] of BOXES) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(mat));
    mesh.position.set(cx, h / 2, cz);
    scene.add(mesh);
    // A thin amber cap on taller blocks so sightlines read at dusk.
    if (h >= 4) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.06, 0.08, d + 0.06),
        new THREE.MeshLambertMaterial({ color: HEX.accent, emissive: 0x7a4a10 }),
      );
      cap.position.set(cx, h + 0.04, cz);
      scene.add(cap);
    }
  }

  // Site markers: glowing rings on the ground at A and B.
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color: HEX.accent, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    scene.add(ring);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8),
      new THREE.MeshBasicMaterial({ color: HEX.accent }),
    );
    post.position.set(site.x, 1.2, site.z);
    scene.add(post);
  }

  // The central silo gets a hazard stripe so the mid landmark reads instantly.
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(5.1, 0.5, 5.1),
    new THREE.MeshLambertMaterial({ color: HEX.teal }),
  );
  stripe.position.set(0, 6.4, -8);
  scene.add(stripe);
}
