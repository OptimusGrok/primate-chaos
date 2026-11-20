// Primate Chaos — Gorilla-Tag-style WebXR jungle for Meta Quest Browser.
// CAVE TEST BUILD (/cave-test/): charged A-button jump, tunnel + domed cave, dark pillar chasm, cliff exit, shaft + clearing, ocean-cliff walls 3/4.
import * as THREE from '../vendor/three.module.js';
import { Reflector } from '../vendor/addons/Reflector.js';
// ---- DEBUG overlay support (test build only): last few errors, captured from the start. The hook is just a tiny array push.
const DBG_BUILD = 'cave-test dbg2 · 2026-11-21'; // version / build tag shown in the DEBUG overlay
const DBG_ERRS = [];
const dbgErr = m => { try { m = String(m); DBG_ERRS.push(m.length > 160 ? m.slice(0, 159) + '…' : m); if (DBG_ERRS.length > 5) DBG_ERRS.shift(); } catch (e) { } };
{
  const ce = console.error;
  console.error = function (...a) { dbgErr(a.length ? a.map(x => x instanceof Error ? x.message : typeof x === 'object' ? '[object]' : x).join(' ') : ''); return ce.apply(this, a); };
  addEventListener('error', e => dbgErr('Error: ' + (e.message || (e.target && e.target.src) || 'script error')));
  addEventListener('unhandledrejection', e => dbgErr('Unhandled: ' + (e.reason && e.reason.message || e.reason)));
}
const V3 = THREE.Vector3, Q = THREE.Quaternion, C3 = THREE.Color;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
let seed = 20261119;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rr = (a, b) => a + (b - a) * rnd();

// ---------- constants ----------
const HALF = 25, WALL_H = 18, CLIMB_H = 9;           // 50x50 clearing, wall 18 m, bottom 9 m climbable
const HR = 0.07;                                     // hand collider radius
const HAND_DROP = 0.1;                               // virtual hand (and its collider) sits 10 cm below the real controller: easier to reach the ground
const ARM_L1 = 0.37, ARM_L2 = 0.37;                  // gorilla upper arm / forearm (IK bones)
const SHOULDER = { x: 0.25, y: -0.4, z: 0.03 };      // shoulder joint relative to the head (yaw frame)
const WRIST_LOCAL = new V3(0, 0, 0.072); // wrist point in hand (grip) space
const BODY_OFF = 0.55, BODY_R = 0.35, HEAD_R = 0.18; // body sphere centre below head
const GRAV = 9.8, MAX_JUMP = 7.0, VEL_MULT = 1.15;
const WATER_Y = -0.12;
const CYCLE = 600;                                   // day/night cycle seconds (10 min)
const APPID = 'optimusgrok-monkey-mayhem-cavetest-v1'; // separate namespace: test players never meet live players
const RELAYS = ['wss://relay.primal.net', 'wss://nos.lol', 'wss://nostr.mom', 'wss://relay.snort.social', 'wss://relay.fountain.fm', 'wss://nostr.data.haus'];

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe8ff, 18, 75);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 3000); // far enough for the ocean 500 m below the cliff exit
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const hemi = new THREE.HemisphereLight(0xcfeeff, 0x3d5a2a, 1.0); scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff2d0, 2.0); scene.add(sunLight); scene.add(sunLight.target);
const worldMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// ---------- geometry merger (one draw call for the whole static world) ----------
class Merger {
  constructor() { this.p = []; this.n = []; this.c = []; }
  add(geo, color, m, vary = 0.07, colorFn, rng) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array, base = new C3(color), cc = new C3();
    for (let i = 0; i < p.length; i += 9) {
      if (colorFn) cc.set(colorFn((p[i + 1] + p[i + 4] + p[i + 7]) / 3, p[i], p[i + 2])); else cc.copy(base);
      const k = 1 + ((rng || rnd)() - 0.5) * 2 * vary;
      for (let j = 0; j < 3; j++) this.c.push(cc.r * k, cc.g * k, cc.b * k);
    }
    for (const v of p) this.p.push(v); for (const v of n) this.n.push(v);
    g.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const M4 = (pos, quat, scl) => new THREE.Matrix4().compose(pos || new V3(), quat || new Q(), scl || new V3(1, 1, 1));
const qFromTo = (a, b) => new Q().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
const UP = new V3(0, 1, 0);
function cylAB(mg, a, b, r0, r1, color, seg = 7, vary) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  mg.add(g, color, M4(a.clone().add(b).multiplyScalar(0.5), qFromTo(UP, d)), vary);
}

// ---------- signed-distance colliders ----------
function sdBox(p, c, h) {
  const qx = Math.abs(p.x - c.x) - h.x, qy = Math.abs(p.y - c.y) - h.y, qz = Math.abs(p.z - c.z) - h.z;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0);
}
const _t1 = new V3(), _t2 = new V3();
function sdCap(p, a, b, r) {
  _t1.subVectors(p, a); _t2.subVectors(b, a);
  const h = clamp(_t1.dot(_t2) / _t2.lengthSq(), 0, 1);
  return _t1.addScaledVector(_t2, -h).length() - r;
}
function sdCapT(p, a, b, r0, r1) { // tapered capsule (approximate SDF, fine for trunks/branches)
  _t1.subVectors(p, a); _t2.subVectors(b, a);
  const h = clamp(_t1.dot(_t2) / _t2.lengthSq(), 0, 1);
  return _t1.addScaledVector(_t2, -h).length() - (r0 + (r1 - r0) * h);
}
const colliders = [];
function addCol(kind, f, c, R, climb = true, extra = {}) { const o = Object.assign({ kind, f, c, R, climb }, extra); colliders.push(o); return o; }
// terrain
const STREAM = [[-3, -23.6], [-2.2, -15], [1.8, -6.5], [4.6, 1.5], [6.4, 6.2]];
const POND = { x: 7, z: 9, r: 4.2 };
function segDist(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1); return Math.hypot(px - ax - dx * t, pz - az - dz * t); }
function streamDist(x, z) { let d = 1e9; for (let i = 0; i < STREAM.length - 1; i++) d = Math.min(d, segDist(x, z, ...STREAM[i], ...STREAM[i + 1])); return d; }
function terrainH(x, z) {
  let h = 0.06 * Math.sin(x * 0.7 + z * 0.3) + 0.05 * Math.sin(z * 0.9 - x * 0.4);
  const sd = streamDist(x, z); if (sd < 1.6) h -= 0.42 * sm(1 - sd / 1.6);
  const pd = Math.hypot(x - POND.x, z - POND.z); if (pd < POND.r + 0.8) h -= 0.75 * sm(1 - pd / (POND.r + 0.8));
  const wd = Math.hypot(x + 3, z + 23.4); if (wd < 2.4) h -= 0.45 * sm(1 - wd / 2.4);
  return h;
}
addCol('ground', p => (p.z < -HALF - 1 || p.z > HALF || p.x < -HALF) ? 50 : (p.y - terrainH(p.x, p.z)) * 0.95, null, 0, true); // spawn clearing only; west/south edges drop to the ocean, cave system has real voids
// walls (solid outside the clearing), upper half is slippery
const CAVES = [
  { c: new V3(-9, 3.2 + 1.2, -26.4), h: new V3(1.5, 1.2, 1.9), floor: 3.2 },
  { c: new V3(3, 6.0 + 1.2, -26.4), h: new V3(1.5, 1.2, 1.9), floor: 6.0 },
];
// both wall-cave mouths: 3 m wide (same as the old square opening), straight sides 1.9 m then a 1.5 m radius cap → 3.4 m peak (taller than the old 2.4 m flat lintel; walking width stays 3 m at head height)
const CAVE_ARCH = { hw: 1.5, wallH: 1.9 };
function caveArchProf(n = 12) { const hw = CAVE_ARCH.hw, wallH = CAVE_ARCH.wallH, pr = [[-hw, 0], [-hw, wallH]]; for (let i = 1; i < n; i++) { const t = Math.PI - Math.PI * i / n; pr.push([hw * Math.cos(t), wallH + hw * Math.sin(t)]); } pr.push([hw, wallH], [hw, 0]); return pr; }
function sdCaveArch(p, k) { // < 0 inside a wall cave's arched volume (from just in front of the wall to the back of the alcove)
  const dx = p.x - k.c.x, y = p.y - k.floor, a = CAVE_ARCH;
  const pr = Math.max(-y, Math.hypot(dx, Math.max(y - a.wallH, 0)) - a.hw);
  const z0 = -HALF, z1 = k.c.z - k.h.z;
  return Math.max(pr, Math.max((z1 - 0.02) - p.z, p.z - (z0 + 0.5))); // alcove slab: back .. 0.5 m in front of the wall (same lip as the old square hole, so a 0.35 m body can walk in)
}
function insetArchProf(pr, d) { // d > 0 shrinks the opening; d < 0 expands into the rock
  const out = [];
  for (let i = 0; i < pr.length; i++) {
    const a = pr[Math.max(0, i - 1)], b = pr[i], c = pr[Math.min(pr.length - 1, i + 1)];
    const tx = c[0] - a[0], ty = c[1] - a[1], L = Math.hypot(tx, ty) || 1;
    out.push([b[0] + ty / L * d, b[1] - tx / L * d]);
  }
  return out;
}
function _archPushQuad(pos, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
}
function makeArchTubeGeo(z0, z1, segs = 5, inset = 0, n = 14) {
  const pr = insetArchProf(caveArchProf(n), inset), pos = [], dz = (z1 - z0) / segs;
  for (let s = 0; s < segs; s++) {
    const za = z0 + dz * s, zb = z0 + dz * (s + 1);
    for (let i = 0; i < pr.length - 1; i++) {
      const [ax, ay] = pr[i], [bx, by] = pr[i + 1];
      _archPushQuad(pos, ax, ay, za, bx, by, za, bx, by, zb, ax, ay, zb);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function makeArchFrameGeo(z0, z1, thick = 0.55, n = 14) {
  const inner = caveArchProf(n), outer = insetArchProf(inner, -thick), pos = [];
  outer[0][1] = Math.min(outer[0][1], -0.12);
  outer[outer.length - 1][1] = Math.min(outer[outer.length - 1][1], -0.12);
  const ring = (a, b, za, zb) => { for (let i = 0; i < a.length - 1; i++) { const [ax, ay] = a[i], [bx, by] = a[i + 1], [cx, cy] = b[i + 1], [dx, dy] = b[i]; _archPushQuad(pos, ax, ay, za, bx, by, za, cx, cy, zb, dx, dy, zb); } };
  ring(outer, inner, z0, z0); // front face
  ring(inner, outer, z1, z1); // back face
  ring(inner, inner, z0, z1); // inner soffit
  ring(outer, outer, z1, z0); // outer wrap (reversed z so it faces out)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function makeArchCapGeo(n = 14, inset = 0) {
  const pr = insetArchProf(caveArchProf(n), inset), pos = [];
  for (let i = 1; i < pr.length - 1; i++) {
    pos.push(pr[0][0], pr[0][1], 0, pr[i + 1][0], pr[i + 1][1], 0, pr[i][0], pr[i][1], 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function makeArchSurroundGeo(padX = 1.25, padY = 0.55, padTop = 1.0, depth = 1.55, n = 14) {
  // rock plate with an arched hole: fills the rectangular skip around each mouth so the thin wall never shows sky in the spandrels
  const hw = CAVE_ARCH.hw + padX, y0 = -padY, y1 = CAVE_ARCH.wallH + CAVE_ARCH.hw + padTop;
  const sh = new THREE.Shape(); sh.moveTo(-hw, y0); sh.lineTo(hw, y0); sh.lineTo(hw, y1); sh.lineTo(-hw, y1); sh.closePath();
  const hole = new THREE.Path(), pr = caveArchProf(n);
  hole.moveTo(pr[0][0], pr[0][1]); for (const [u, v] of pr.slice(1)) hole.lineTo(u, v); hole.closePath(); sh.holes.push(hole);
  return new THREE.ExtrudeGeometry(sh, { depth: depth, bevelEnabled: false, steps: 1 });
}
// ---------- cave system (test build): tunnel from the upper wall cave -> domed cave -> dark pillar chasm -> ledge -> side tunnel -> cliff ----------
const CXF = CAVES[1].floor; // 6 m: everything walkable in the cave system sits at this level unless noted
const CX = {
  F: CXF,
  tun: { x: 3, vz0: CAVES[1].c.z - CAVES[1].h.z, vz1: -33.9, z0: -26.0, z1: -37.0, hw: 1.4, wallH: 0.95 }, // 5 m+ arched tunnel (rounded roof); collider runs on into the cave and the dome so the joins have no seams
  dome: { c: new V3(3, CXF, -42.3), r: new V3(6.5, 7, 9) },                                  // big cave with a domed top
  ledgeZ: -48, slipRun: 3,                                                                    // far edge of the big cave; last 3 m are smooth (no hand grip)
  G: 4.0, PR: 1.0,                                                                            // pillar gap (edge to edge) and pillar top radius
  chasm: { c: new V3(-6.25, CXF - 26.5, -59), h: new V3(15.75, 33.5, 11) },                    // void: x -22..9.5 (open left of pillar 4), y F-60..F+7, z -70..-48
  end: { c: new V3(3, CXF + 1.75, -71.25), h: new V3(3, 1.75, 3.25) },                         // ledge chamber after the 3rd pillar (z -74.5..-68: overlaps the chasm void, so no seam at the ledge)
  rt: { z: -72, vx0: 6, vx1: 10, x0: 3.5, x1: 12, hw: 1.4, wallH: 1.0 },                         // 4 m tunnel to the RIGHT (+x), x 6..10 (collider overlaps chamber and open air)
  faceZ: -73.4, faceX: 10, ocean: -500,
  air: { c: new V3(1255, 200, -61.7), h: new V3(1245, 1000, 11.7) },                           // open air outside the cliff: x>10, -73.4<z<-50
  fallT: 2.0,
};
CX.pillars = [0, 1, 2].map(i => new V3(3, CXF, CX.ledgeZ - CX.G - CX.PR - i * (2 * CX.PR + CX.G)));
CX.endEdge = CX.pillars[2].z - CX.PR - CX.G; // -70
CX.pillars.push(new V3(3 - (2 * CX.PR + CX.G), CXF, CX.pillars[2].z)); // pillar 4: left of 3 (same 6 m centre spacing), same z
// outside: the mouth lip, two 1x1 rock ledges, an overhang with the vine, then the 6 m x 1 m ledge (z = face .. face+1)
CX.lip = { c: new V3(10.6, CXF - 0.75, -72.0), h: new V3(0.6, 0.75, 1.4) };
CX.ledges = [
  { c: new V3(13.3, CXF - 0.3, -72.95), h: new V3(0.5, 0.3, 0.55) },
  { c: new V3(15.9, CXF - 0.3, -72.95), h: new V3(0.5, 0.3, 0.55) },
  { c: new V3(23.0, CXF + 3.0 - 0.3, -72.95), h: new V3(3.0, 0.3, 0.55), long: true },
];
CX.overhang = { c: new V3(18.2, CXF + 7.0, -73.0), h: new V3(0.7, 0.4, 0.75) };
CX.vine = { top: new V3(18.2, CXF + 6.6, -72.75), L: 6.0 };
CX.CLR_Y = 15; CX.SHAFT_R = 0.61;
CX.SHAFT = { c: new V3(3, 0, -42.3), r: 0.61, y0: CXF + 7, y1: 15 }; // 1.22 m shaft through the dome apex up to the clearing
CX.shaftVine = { top: new V3(3, 16.4, -42.3), L: 16.4 - (CXF + 2.1) }; // hangs to ~2.1 m above the wide-cave floor
CX.clearSpawn = new V3(6.2, 15, -39.5); // open grass east of the shaft, away from the south cliff and the trees
function sdArchZ(p, a) { const dx = p.x - a.x, y = p.y - CXF; return Math.max(Math.max(-y, Math.hypot(dx, Math.max(y - a.wallH, 0)) - a.hw), Math.max(p.z - a.z0 - 0.05, a.z1 - p.z)); }
function sdArchX(p, a) { const dz = p.z - a.z, y = p.y - CXF; return Math.max(Math.max(-y, Math.hypot(dz, Math.max(y - a.wallH, 0)) - a.hw), Math.max(a.x0 - p.x, p.x - a.x1)); }
function sdDome(p) { const c = CX.dome.c, r = CX.dome.r; const k = Math.hypot((p.x - c.x) / r.x, (p.y - c.y) / r.y, (p.z - c.z) / r.z); return Math.max(CXF - p.y, (k - 1) * 6.5); }
function sdShaft(p) { // vertical cylinder through the dome apex up into the clearing
  const d = Math.hypot(p.x - CX.SHAFT.c.x, p.z - CX.SHAFT.c.z) - CX.SHAFT.r;
  const dy = Math.max(CX.SHAFT.y0 - 0.4 - p.y, p.y - (CX.CLR_Y + 2.2));
  return Math.min(Math.max(d, dy), 0) + Math.hypot(Math.max(d, 0), Math.max(dy, 0));
}
function inClrXZ(p) { return p.x > -HALF + 0.2 && p.x < HALF - 0.2 && p.z < -HALF - 0.15 && p.z > -51.5; }
function inShaftXZ(p, pad = 0) { return Math.hypot(p.x - CX.SHAFT.c.x, p.z - CX.SHAFT.c.z) < CX.SHAFT.r + pad; }
function sdClrAir(p) { // open air on the mountain-top clearing
  if (!inClrXZ(p) || p.y < CX.CLR_Y - 0.05 || p.y > CX.CLR_Y + 16) return 99;
  return p.y - (CX.CLR_Y + 16);
}
function cxInterior(p) { // < 0 inside the open space of the cave system (incl. the voids)
  return Math.min(sdArchZ(p, CX.tun), sdDome(p), sdBox(p, CX.chasm.c, CX.chasm.h), sdBox(p, CX.end.c, CX.end.h), sdArchX(p, CX.rt), sdBox(p, CX.air.c, CX.air.h), sdShaft(p), sdClrAir(p));
}
const inXZ = (p, b, e = 0) => Math.abs(p.x - b.c.x) < b.h.x + e && Math.abs(p.z - b.c.z) < b.h.z + e;
function cxSlip(p) { // smooth rock: chasm, cliff face, and the last 3 m of the big cave floor (so only the charged jump crosses the gaps)
  if (inXZ(p, CX.chasm, 0.12) && p.y > CX.chasm.c.y - CX.chasm.h.y) return true;
  if (p.x > CX.faceX - 0.12 && p.z > CX.faceZ - 0.12 && p.z < -49.9) return true;
  return cxStrip(p);
}
function cxStrip(p) { return p.z < CX.ledgeZ + CX.slipRun && p.z > CX.ledgeZ - 0.3 && p.y < CXF + 0.4 && Math.abs(p.x - 3) < 7; } // the smooth grey strip before the first ledge's lip
const SLICK_K = 0.75; // grey strip floor: a hand pushing on it slides (moves you 75% of the hand's travel, along the floor only) and never holds you up or flings you
// void columns: falling here = 2 s fall, then back on the last platform you stood on (else spawn)
const cxVoid = p => inXZ(p, CX.chasm) || (p.x > CX.faceX + 0.05 && p.z > CX.faceZ && p.z < -50);
const offOcean = p => (p.z > HALF - 0.02 && p.x > -HALF - 200 && p.x < HALF + 8) || (p.x < -HALF + 0.02 && p.z > -90 && p.z < HALF + 200);
const wallClimb = p => p.y < CLIMB_H && !cxSlip(p);
// Wall 1 (N): caves. Wall 2 (E): to the right of wall 1. Both stop just below the mountain-top clearing so you can walk off the south cliff.
// Walls 3 (S) and 4 (W) are only the below-ground ocean cliffs — no above-ground wall, the ground ends at a drop.
addCol('wall', p => { if (p.y > CX.CLR_Y - 1.4) return 99; let d = p.z + HALF; for (const k of CAVES) d = Math.max(d, -sdCaveArch(p, k)); return Math.max(d, -cxInterior(p)); }, null, 0, wallClimb, { wall: 'N' });
addCol('wall', p => p.y > CX.CLR_Y - 1.4 ? 99 : (p.z < -HALF - 1 ? 50 : HALF - p.x), null, 0, wallClimb, { wall: 'E' });
// east face of the mountain north of the spawn (top of wall 2 continues along the plateau)
addCol('wall', p => (p.z > -HALF - 0.2 || p.z < -52 || p.y > CX.CLR_Y + 0.4) ? 99 : HALF - p.x, null, 0, p => p.y < CLIMB_H, { wall: 'E' });
// west face of the mountain north of the spawn (continuous with wall 4's below-ground cliff)
addCol('wall', p => (p.z > -HALF - 0.2 || p.z < -52 || p.y > CX.CLR_Y + 0.4 || p.y < -1) ? 99 : p.x + HALF, null, 0, p => p.y < CLIMB_H, { wall: 'W' });

const world = new Merger();
// ground
{
  const g = new THREE.PlaneGeometry(52, 52, 56, 56); g.rotateX(-Math.PI / 2);
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) pa.setY(i, terrainH(pa.getX(i), pa.getZ(i)) + (rnd() - 0.5) * 0.04);
  // clip the grass at the west (wall 4) and south (wall 3) ocean cliffs (no extra rnd)
  for (let i = 0; i < pa.count; i++) {
    let x = pa.getX(i), z = pa.getZ(i);
    if (x < -HALF) { x = -HALF; pa.setX(i, x); }
    if (z > HALF) { z = HALF; pa.setZ(i, z); }
    if (x === -HALF || z === HALF) pa.setY(i, terrainH(x, z));
  }
  const greens = ['#5cbf4a', '#4fae40', '#69c957', '#58b84a'];
  world.add(g, '#5cbf4a', null, 0.05, (y) => y < -0.2 ? '#9b8f5e' : y < -0.08 ? '#c9b47a' : greens[(rnd() * 4) | 0]);
}
// water surface (pond + stream + waterfall pool) built from the same grid
const waterGeo = (() => {
  const pts = [], N = 64, S = 50 / N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x0 = -25 + i * S, z0 = -25 + j * S, x1 = x0 + S, z1 = z0 + S;
    const m = Math.min(terrainH(x0, z0), terrainH(x1, z0), terrainH(x0, z1), terrainH(x1, z1), terrainH(x0 + S / 2, z0 + S / 2));
    if (m < WATER_Y - 0.01) pts.push(x0, WATER_Y, z0, x0, WATER_Y, z1, x1, WATER_Y, z0, x1, WATER_Y, z0, x0, WATER_Y, z1, x1, WATER_Y, z1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.computeVertexNormals(); return g;
})();
const water = new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({ color: 0x3fc6e8, transparent: true, opacity: 0.72, emissive: 0x0a3a50 }));
scene.add(water);
// one always-on ocean plane (south/west drops + the exit cliff). The later CXG.out ocean is reused / skipped.
const oceanWorld = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2c74b2, emissive: 0x0b2c48 }));
oceanWorld.position.set(0, CX.ocean, 0); scene.add(oceanWorld); CX.oceanMesh = oceanWorld;

// rock wall: walls 1 (N) and 2 (E) — chunky layered rock all the way up to the mountain top.
// Walls 3 (S) and 4 (W) are only the below-ground ocean cliffs; the grass ends at those edges.
{
  const rocks = ['#7d6a58', '#8a7663', '#6f5f50', '#958068', '#6a5848', '#82705e'];
  const mossC = ['#3a5c32', '#4a6e38', '#2f4f28'];
  const TOP = CX.CLR_Y + 0.55; // visual top of walls 1 and 2, flush with the clearing
  const sides = [
    { n: new V3(0, 0, 1), o: new V3(0, 0, -HALF), along: new V3(1, 0, 0), id: 1 },
    { n: new V3(-1, 0, 0), o: new V3(HALF, 0, 0), along: new V3(0, 0, 1), id: 2 },
  ];
  const box = new THREE.BoxGeometry(1, 1, 1);
  const ico = new THREE.DodecahedronGeometry(1, 0);
  const mouthHit = (pos, padX = 1.2, padTop = 0.9) => CAVES.some(k => {
    const dx = Math.abs(pos.x - k.c.x), y = pos.y - k.floor;
    return dx < CAVE_ARCH.hw + padX && y > -0.65 && y < CAVE_ARCH.wallH + CAVE_ARCH.hw + padTop;
  });
  const dress = (s, y0, y1, moss) => {
    const q = qFromTo(new V3(0, 0, 1), s.n);
    for (let a = -HALF - 0.8; a < HALF + 0.8; a += 1.45) for (let y = y0; y < y1 - 0.3; y += 1.35) {
      const pos = s.o.clone().addScaledVector(s.along, a + rr(-0.18, 0.18)).add(new V3(0, y + 0.75, 0));
      if (s.id === 1 && mouthHit(pos)) continue;
      const depth = rr(1.15, 1.45), prot = rr(0, 0.22);
      pos.addScaledVector(s.n, -depth / 2 + prot);
      const col = (moss && y < 2.2 && rnd() < 0.16) ? mossC[(rnd() * 3) | 0] : (y < 0 ? (y < -16 ? '#3a322c' : '#5a4e44') : rocks[(rnd() * 6) | 0]);
      world.add(box, col, M4(pos, q, new V3(rr(1.5, 2.05), rr(1.25, 1.85), depth)), 0.1);
    }
    for (let i = 0; i < 10; i++) {
      const a = rr(-HALF + 1, HALF - 1), y = rr(y0 + 0.6, y1 - 1.2);
      const pos = s.o.clone().addScaledVector(s.along, a).add(new V3(0, y, 0));
      if (s.id === 1 && mouthHit(pos, 1.6, 1.1)) continue;
      pos.addScaledVector(s.n, -0.15 + rr(0, 0.35));
      world.add(ico, (y < 0 ? '#4a423c' : rocks[(rnd() * 6) | 0]), M4(pos, q, new V3(rr(0.45, 0.85), rr(0.35, 0.7), rr(0.45, 0.8))), 0.12);
    }
    for (let i = 0; i < 7; i++) {
      const a = rr(-HALF + 0.5, HALF - 0.5), y = rr(y0 + 0.8, y1 - 0.8);
      const pos = s.o.clone().addScaledVector(s.along, a).add(new V3(0, y, 0));
      if (s.id === 1 && mouthHit(pos, 1.3, 0.9)) continue;
      pos.addScaledVector(s.n, 0.02);
      world.add(box, '#3a322c', M4(pos, q, new V3(rr(0.04, 0.1), rr(0.7, 1.8), rr(0.12, 0.22))), 0.02);
    }
    for (let y = y0 + 1.6; y < y1 - 0.6; y += 2.35) {
      for (let a = -HALF + 2; a < HALF - 2; a += 6.5) {
        const pos = s.o.clone().addScaledVector(s.along, a + rr(-0.6, 0.6)).add(new V3(0, y + rr(-0.15, 0.15), 0));
        if (s.id === 1 && mouthHit(pos, 1.8, 0.7)) continue;
        pos.addScaledVector(s.n, 0.08);
        world.add(box, y < 0 ? '#2e2824' : '#5c4e42', M4(pos, q, new V3(rr(2.2, 3.6), rr(0.1, 0.18), rr(0.35, 0.55))), 0.04);
      }
    }
    return q;
  };
  for (const s of sides) {
    const q = dress(s, -0.4, TOP, true);
    const addSlab = (midAlong, y, w, h, d, col, vary, prot = -1.0) => {
      const pos = s.o.clone().addScaledVector(s.along, midAlong).add(new V3(0, y, 0)).addScaledVector(s.n, prot);
      world.add(box, col, M4(pos, q, new V3(w, h, d)), vary);
    };
    // cornice at the mountain top (no smooth grey slab — rock all the way up)
    addSlab(0, TOP + 0.08, 2 * HALF + 4, 0.4, 1.15, '#5a4b3e', 0.04, -0.45);
    if (s.id === 1) {
      const pk = CAVES[1], gap0 = pk.c.x - (CAVE_ARCH.hw + 0.9), gap1 = pk.c.x + (CAVE_ARCH.hw + 0.9);
      const peak = pk.floor + CAVE_ARCH.wallH + CAVE_ARCH.hw;
      addSlab((gap0 + gap1) / 2, peak + 0.18, gap1 - gap0 - 0.1, 0.32, 1.15, '#6a5c50', 0.04, -0.25);
    }
  }
  // walls 3 (S) and 4 (W): sheer cliffs below the grass, dropping toward the ocean
  const cliffs = [
    { n: new V3(0, 0, -1), o: new V3(0, 0, HALF), along: new V3(1, 0, 0), id: 3 },
    { n: new V3(1, 0, 0), o: new V3(-HALF, 0, 0), along: new V3(0, 0, 1), id: 4 },
  ];
  for (const s of cliffs) {
    dress(s, -28, 0.2, false);
    const q = qFromTo(new V3(0, 0, 1), s.n);
    const pos = s.o.clone().add(new V3(0, -80, 0)).addScaledVector(s.n, -1.2);
    world.add(box, '#1a1816', M4(pos, q, new V3(2 * HALF + 6, 120, 2.4)), 0.02);
  }
  // mountain's west and east faces north of the spawn (wall 4 / wall 2 continued), so the plateau has sides
  for (const s of [
    { n: new V3(1, 0, 0), o: new V3(-HALF, 0, -HALF - 13.5), along: new V3(0, 0, 1), span: 27 },
    { n: new V3(-1, 0, 0), o: new V3(HALF, 0, -HALF - 13.5), along: new V3(0, 0, 1), span: 27 },
  ]) {
    const q = qFromTo(new V3(0, 0, 1), s.n);
    for (let a = -s.span / 2; a < s.span / 2; a += 1.5) for (let y = -0.4; y < TOP - 0.3; y += 1.4) {
      const pos = s.o.clone().addScaledVector(s.along, a + rr(-0.15, 0.15)).add(new V3(0, y + 0.7, 0)).addScaledVector(s.n, -rr(0.55, 0.75));
      world.add(box, rocks[(rnd() * 6) | 0], M4(pos, q, new V3(rr(1.5, 2.05), rr(1.2, 1.8), rr(1.15, 1.45))), 0.1);
    }
    // below-ground continuation of those faces down to the ocean
    for (let a = -s.span / 2; a < s.span / 2; a += 1.6) for (let y = -1.2; y > -28; y -= 1.5) {
      const pos = s.o.clone().addScaledVector(s.along, a).add(new V3(0, y, 0)).addScaledVector(s.n, -0.7);
      world.add(box, y < -16 ? '#3a322c' : '#5a4e44', M4(pos, q, new V3(1.8, 1.6, 1.3)), 0.08);
    }
  }
  // coarse east ridge from the NE mountain toward the exit cliff (right of wall 1)
  {
    const q = qFromTo(new V3(0, 0, 1), new V3(-1, 0, 0));
    for (let i = 0; i < 8; i++) {
      const t0 = i / 7, z = -52 - t0 * 20, x = 25 - t0 * 13, y = TOP * (1 - t0 * 0.35) * 0.5;
      const h = TOP * (1 - t0 * 0.25) + 2;
      world.add(box, rocks[(rnd() * 6) | 0], M4(new V3(x, h / 2 - 1, z), q, new V3(4.5, h, 3.2)), 0.08);
    }
  }

  // arched interiors + matching stone frames (shop gets a back wall; parkour cave opens into the tunnel)
  const dark = '#5b4c40', zMouth = -HALF;
  const tubeGeo = makeArchTubeGeo(0, -1, 5, -0.04);
  const frameGeo = makeArchFrameGeo(0, 1, 0.55);
  const capGeo = makeArchCapGeo(14, -0.04);
  for (const k of CAVES) {
    const back = k.c.z - k.h.z, midZ = (zMouth + back) / 2, depth = zMouth - back;
    const tm = new THREE.Matrix4().makeTranslation(k.c.x, k.floor, zMouth).multiply(new THREE.Matrix4().makeScale(1, 1, depth));
    world.add(tubeGeo, k === CAVES[1] ? '#2e2925' : dark, tm, 0.05);
    world.add(box, k === CAVES[1] ? '#2a2622' : dark, M4(new V3(k.c.x, k.floor - 0.28, midZ), null, new V3(CAVE_ARCH.hw * 2 + 0.5, 0.56, depth + 0.2)), 0.03);
    if (k === CAVES[0]) {
      const cm = new THREE.Matrix4().makeTranslation(k.c.x, k.floor, back - 0.02);
      world.add(capGeo, dark, cm, 0.04);
      // rectangular back-stop behind the cap so the thin mountain shell never shows sky through the shop
      world.add(box, dark, M4(new V3(k.c.x, k.floor + (CAVE_ARCH.wallH + CAVE_ARCH.hw) / 2, back - 0.4), null, new V3(CAVE_ARCH.hw * 2 + 1.4, CAVE_ARCH.wallH + CAVE_ARCH.hw + 0.8, 0.7)), 0.03);
    }
    const smat = new THREE.Matrix4().makeTranslation(k.c.x, k.floor, zMouth).multiply(new THREE.Matrix4().makeScale(1, 1, -1));
    world.add(makeArchSurroundGeo(1.25, 0.5, 0.75, 1.55), '#65574b', smat, 0.05);
    const fm = new THREE.Matrix4().makeTranslation(k.c.x, k.floor, zMouth + 0.22).multiply(new THREE.Matrix4().makeScale(1, 1, -0.55));
    world.add(frameGeo, '#6e5e4f', fm, 0.06);
    const peak = k.floor + CAVE_ARCH.wallH + CAVE_ARCH.hw;
    world.add(box, '#5c4e42', M4(new V3(k.c.x, peak + 0.6, zMouth - 0.7), null, new V3(CAVE_ARCH.hw * 2 + 2.0, 1.2, 0.9)), 0.04);
    // a few mossy tufts and hanging vines beside the mouth, clear of the opening
    for (const sx of [-1, 1]) {
      const vx = k.c.x + sx * (CAVE_ARCH.hw + 0.7);
      world.add(box, mossC[(rnd() * 3) | 0], M4(new V3(vx, k.floor + CAVE_ARCH.wallH + 0.35, zMouth + 0.28), null, new V3(0.12, rr(0.8, 1.6), 0.08)), 0.08);
      world.add(box, mossC[(rnd() * 3) | 0], M4(new V3(vx + sx * 0.18, k.floor + CAVE_ARCH.wallH - 0.2, zMouth + 0.32), null, new V3(0.1, rr(0.6, 1.2), 0.07)), 0.08);
    }
    world.add(new THREE.DodecahedronGeometry(0.35, 0), '#e8d36a', M4(new V3(k.c.x - 0.9, k.floor + 0.2, back + 0.4)));
  }
  world.add(new THREE.BoxGeometry(2.8, 0.5, 1.2), '#6a5a4b', M4(new V3(-3, 11.1, -HALF + 0.3)));
  seed = 1443482688; // trees and everything after must keep the original rnd sequence
}

// ---------- trees, branches, roots, platforms ----------
const TREES = [
  { x: -8, z: -6, r: 0.95, h: 12.6, id: 'T1' }, { x: 8, z: -8, r: 0.95, h: 12.9, id: 'T2' },
  { x: 12.5, z: 5, r: 1.0, h: 11 }, { x: -12, z: 8, r: 1.05, h: 11.5 }, { x: -16, z: -13, r: 0.9, h: 10.5 },
  { x: 16, z: -15, r: 0.9, h: 10.5 }, { x: 15, z: 17, r: 1.0, h: 11 }, { x: -6, z: 17, r: 0.95, h: 10.8 },
];
const VINES = [];
const PLATFORMS = [];
const trunkC = '#7a4f2c', barkC = '#8b5a33', leafC = ['#3fae3a', '#5ccc3f', '#2f9a3a', '#7ad94a'];
const capColl = (a, b, r, kind = 'branch', r1 = r) => addCol(kind, r1 === r ? p => sdCap(p, a, b, r) : p => sdCapT(p, a, b, r, r1), a.clone().add(b).multiplyScalar(0.5), a.distanceTo(b) / 2 + Math.max(r, r1), true, { a, b, r, r1 });
const boxColl = (c, h, kind = 'platform') => addCol(kind, p => sdBox(p, c, h), c, h.length(), true, { h });
function addPlatform(c, h, color = '#c08a4a', kind = 'platform') {
  world.add(new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2), color, M4(c), 0.06);
  for (let i = -1; i <= 1; i++) world.add(new THREE.BoxGeometry(h.x * 2 + 0.04, 0.04, 0.05), '#8a5a2a', M4(new V3(c.x, c.y + h.y + 0.005, c.z + i * h.z * 0.6)));
  const col = boxColl(c, h, kind); PLATFORMS.push({ c, h, kind }); return col;
}
for (const t of TREES) {
  const base = new V3(t.x, terrainH(t.x, t.z) - 0.3, t.z), top = new V3(t.x, t.h, t.z);
  cylAB(world, base, top, t.r * 1.15, t.r * 0.7, trunkC, 8);
  capColl(base, top, t.r * 1.12, 'trunk', t.r * 0.72);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + rr(0, 1), d = new V3(Math.cos(a), 0, Math.sin(a));
    const a0 = base.clone().addScaledVector(d, t.r * 0.8).setY(0.35), b0 = base.clone().addScaledVector(d, t.r + 1.4).setY(terrainH(t.x + d.x * (t.r + 1.4), t.z + d.z * (t.r + 1.4)) + 0.05);
    cylAB(world, a0, b0, 0.26, 0.14, barkC, 5); capColl(a0, b0, 0.2, 'root');
  }
  t.branches = [];
  if (t.id === 'T1') { // ladder of stubs up to the course start pad
    [[1.2, 2.6], [2.4, 1.4], [3.6, 0.3], [4.8, -0.9], [6.0, 0.5]].forEach(([y, a]) => {
      const d = new V3(Math.cos(a), 0.12, Math.sin(a)).normalize();
      const a0 = new V3(t.x, y, t.z).addScaledVector(d, t.r * 0.6), b0 = a0.clone().addScaledVector(d, t.r * 0.4 + 1.2);
      cylAB(world, a0, b0, 0.2, 0.15, barkC, 6); capColl(a0, b0, 0.17, 'rung');
    });
  }
  const nb = t.id ? 2 : 4;
  for (let i = 0; i < nb; i++) {
    let a = i * Math.PI * 2 / nb + rr(0, 0.7) + (t.id === 'T1' ? 2.2 : t.id === 'T2' ? -0.9 : 0);
    const y = (t.id ? 8.6 : 3.4) + i * (t.id ? 1.2 : 1.55) + rr(0, 0.4), len = rr(2.8, 3.8);
    const d = new V3(Math.cos(a), 0.28, Math.sin(a)).normalize();
    const a0 = new V3(t.x, y, t.z), b0 = a0.clone().addScaledVector(d, len + t.r);
    cylAB(world, a0, b0, 0.34, 0.22, barkC, 6); capColl(a0, b0, 0.33, 'branch', 0.22);
    t.branches.push({ a: a0, b: b0 });
    if (b0.y > 5) world.add(new THREE.IcosahedronGeometry(rr(1.3, 1.8), 0), leafC[(rnd() * 4) | 0], M4(b0.clone().add(new V3(0, 0.6, 0)), null, new V3(1, 0.7, 1)), 0.1);
  }
  world.add(new THREE.IcosahedronGeometry(2.8, 0), leafC[(rnd() * 4) | 0], M4(top.clone().add(new V3(0, 0.6, 0)), null, new V3(1.15, 0.7, 1.15)), 0.1);
  world.add(new THREE.IcosahedronGeometry(1.9, 0), leafC[(rnd() * 4) | 0], M4(top.clone().add(new V3(rr(-1.6, 1.6), 1.5, rr(-1.6, 1.6))), null, new V3(1, 0.75, 1)), 0.1);
}
for (const [ti, ang, y] of [[2, Math.PI, 4.6], [3, 0, 5.2], [6, Math.PI * 1.25, 4.0], [7, -Math.PI / 2, 6.0]]) {
  const t = TREES[ti], d = new V3(Math.cos(ang), 0, Math.sin(ang));
  const c = new V3(t.x, y, t.z).addScaledVector(d, t.r + 1.05);
  addPlatform(c, new V3(1.2, 0.15, 1.2));
  cylAB(world, new V3(t.x, y - 1.4, t.z), c.clone().addScaledVector(d, 0.6).setY(y - 0.12), 0.18, 0.14, barkC, 5);
}
const ROCKS = [[3, 2.5, 0.7], [-2.5, 3, 0.5], [-3, -2.5, 0.9], [2.6, -3.6, 0.45], [-14, 0, 1.2], [14, -4, 1.0], [0, 12, 1.1], [-10, -17, 0.9], [10, -18, 1.1],
  [19, 6, 1.0], [-20, -5, 1.2], [-19, 11, 0.8], [6, 18, 0.9], [-9, -22.6, 1.1], [3, -22.6, 1.2], [-21, 20, 1.3], [21, -21, 1.2]];
for (const [x, z, r] of ROCKS) {
  const c = new V3(x, terrainH(x, z) + r * 0.3, z);
  world.add(new THREE.DodecahedronGeometry(r * 0.92, 0), ['#8d8f93', '#9a9a95', '#7f8486'][(rnd() * 3) | 0], M4(c, new Q().setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), new V3(1, 0.85, 1)), 0.1);
  addCol('rock', p => p.distanceTo(c) - r * 0.82, c, r, true);
}
const FLOWERS = [];
for (let i = 0; i < 34; i++) {
  let x, z, k = 0;
  do { const s = STREAM[(rnd() * STREAM.length) | 0]; const near = rnd() < 0.5; x = near ? POND.x + rr(-6, 6) : s[0] + rr(-3.5, 3.5); z = near ? POND.z + rr(-6, 6) : s[1] + rr(-3.5, 3.5); k++; }
  while ((terrainH(x, z) < -0.05 || Math.abs(x) > 23 || Math.abs(z) > 23) && k < 20);
  const y = terrainH(x, z);
  world.add(new THREE.CylinderGeometry(0.015, 0.02, 0.35, 3), '#3d8a2e', M4(new V3(x, y + 0.17, z)), 0);
  world.add(new THREE.OctahedronGeometry(0.11, 0), ['#ff6fb5', '#ffe14a', '#b77bff', '#ffffff', '#ff8a3d'][(rnd() * 5) | 0], M4(new V3(x, y + 0.37, z), null, new V3(1, 0.45, 1)), 0.05);
  FLOWERS.push(new V3(x, y + 0.4, z));
}
for (let i = 0; i < 14; i++) {
  const s = (rnd() * 4) | 0, a = rr(-22, 22), off = rr(21.5, 23.5);
  const x = s === 0 ? a : s === 1 ? a : s === 2 ? off : -off, z = s === 0 ? -off : s === 1 ? off : a;
  if (Math.abs(x + 3) < 3 && z < -20) continue;
  world.add(new THREE.IcosahedronGeometry(rr(0.7, 1.1), 0), leafC[(rnd() * 4) | 0], M4(new V3(x, terrainH(x, z) + 0.3, z), null, new V3(1, 0.6, 1)), 0.1);
}

// ---------- canopy obstacle course (start pad on T1 -> beams, vines, platforms -> finish pad on T2) ----------
const COURSE = {};
{
  const logA = new V3(-8, 12.3, -6), logB = new V3(8, 12.6, -8);
  cylAB(world, logA, logB, 0.34, 0.3, barkC, 7); capColl(logA, logB, 0.32, 'log');
  const onLog = x => { const t = (x - logA.x) / (logB.x - logA.x); return logA.clone().lerp(logB, t); };
  COURSE.start = addPlatform(new V3(-6.2, 7.0, -6.0), new V3(1.0, 0.15, 1.0), '#3fb3ff', 'start');
  const b1a = new V3(-5.2, 7.0, -6.1), b1b = new V3(-1.9, 7.2, -6.6);
  cylAB(world, b1a, b1b, 0.3, 0.26, barkC, 6); capColl(b1a, b1b, 0.28, 'beam');
  COURSE.mid = addPlatform(new V3(1.2, 6.8, -7.0), new V3(0.9, 0.15, 0.9), '#c08a4a', 'platform');
  const b2a = new V3(2.1, 6.9, -7.1), b2b = new V3(3.6, 7.2, -7.4);
  cylAB(world, b2a, b2b, 0.3, 0.26, barkC, 6); capColl(b2a, b2b, 0.28, 'beam');
  COURSE.finish = addPlatform(new V3(6.5, 7.3, -8.0), new V3(1.0, 0.15, 1.0), '#ffcf3f', 'finish');
  COURSE.beams = [[b1a, b1b], [b2a, b2b]];
  COURSE.vineTops = [onLog(-1.2).add(new V3(0, -0.3, 0)), onLog(4.3).add(new V3(0, -0.3, 0))];
  COURSE.vineLens = [COURSE.vineTops[0].y - 7.6, COURSE.vineTops[1].y - 7.5];
  for (const [p, col] of [[COURSE.start.c, '#3fb3ff'], [COURSE.finish.c, '#ffcf3f']]) {
    const a = p.clone().add(new V3(0.8, 0.15, 0.8)), b = a.clone().add(new V3(0, 1.3, 0));
    cylAB(world, a, b, 0.03, 0.03, '#eeeeee', 4);
    world.add(new THREE.BoxGeometry(0.5, 0.3, 0.02), col, M4(b.clone().add(new V3(0.25, -0.18, 0))));
  }
}
function addVine(top, L) { const q = top.clone().add(new V3(0, -L, 0)); VINES.push({ top, L, q, qp: q.clone(), held: 0 }); }
addVine(COURSE.vineTops[0], COURSE.vineLens[0]); addVine(COURSE.vineTops[1], COURSE.vineLens[1]);
for (const ti of [2, 3, 4, 5, 6, 7]) {
  const t = TREES[ti]; const br = t.branches.filter(b => b.b.y < 9.2).sort((a, b) => b.b.y - a.b.y)[0];
  if (!br) continue; const top = br.a.clone().lerp(br.b, 0.85).add(new V3(0, -0.2, 0)); addVine(top, top.y - 1.7);
}
{ const q = CX.vine.top.clone().add(new V3(0, -CX.vine.L, 0)); VINES.push({ top: CX.vine.top, L: CX.vine.L, q, qp: q.clone(), held: 0, trig: true }); } // cliff vine: grab with either trigger
{ const q = CX.shaftVine.top.clone().add(new V3(0, -CX.shaftVine.L, 0)); VINES.push({ top: CX.shaftVine.top, L: CX.shaftVine.L, q, qp: q.clone(), held: 0, trig: true, shaft: true }); } // shaft vine: same grab as the cliff vine
const vineMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 5).translate(0, -0.5, 0), new THREE.MeshLambertMaterial({ color: 0x4e8a2a, flatShading: true }), VINES.length);
scene.add(vineMesh); vineMesh.frustumCulled = false;
const vineLeaf = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.14, 0), new THREE.MeshLambertMaterial({ color: 0x6fd04a, flatShading: true }), VINES.length * 3);
scene.add(vineLeaf); vineLeaf.frustumCulled = false;

// waterfall (scrolling stripes) + splash ring
const fallMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, uniforms: { t: { value: 0 }, light: { value: 1 } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'varying vec2 vUv;uniform float t;uniform float light;void main(){float s=fract(vUv.y*6.+t*1.8+sin(vUv.x*14.)*.12);float a=.55+.35*smoothstep(.6,1.,s);vec3 c=mix(vec3(.55,.85,1.),vec3(1.),smoothstep(.7,1.,s));gl_FragColor=vec4(c*light,a*smoothstep(0.,.08,vUv.x)*smoothstep(1.,.92,vUv.x));}',
});
const fall = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 11, 1, 1), fallMat); fall.position.set(-3, 5.5, -HALF + 0.12); scene.add(fall);
const splash = new THREE.Mesh(new THREE.RingGeometry(0.4, 1.6, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
splash.rotation.x = -Math.PI / 2; splash.position.set(-3, WATER_Y + 0.02, -23.6); scene.add(splash);

// course signs (canvas texture, redrawn only when it changes)
const signCv = document.createElement('canvas'); signCv.width = 512; signCv.height = 256;
const signTex = new THREE.CanvasTexture(signCv); signTex.colorSpace = THREE.SRGBColorSpace;
const signMat = new THREE.MeshBasicMaterial({ map: signTex });
const signs = [];
for (const [pos, yaw] of [[new V3(-6.3, 1.7, -4.6), 0.55], [new V3(-6.6, 8.1, -7.1), 0.25]]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), signMat); m.position.copy(pos); m.rotation.y = yaw; scene.add(m); signs.push(m);
  world.add(new THREE.BoxGeometry(1.62, 0.87, 0.06), '#6b4423', M4(pos.clone().add(new V3(-Math.sin(yaw) * 0.035, 0, -Math.cos(yaw) * 0.035)), new Q().setFromEuler(new THREE.Euler(0, yaw, 0))), 0);
  cylAB(world, pos.clone().add(new V3(-Math.sin(yaw) * 0.06, -0.4, -Math.cos(yaw) * 0.06)), new V3(pos.x - Math.sin(yaw) * 0.06, pos.y > 5 ? 7.15 : 0, pos.z - Math.cos(yaw) * 0.06), 0.05, 0.05, '#6b4423', 4);
}
const worldMesh = new THREE.Mesh(world.build(), worldMat); scene.add(worldMesh);

// ---------- sky colour, stars, sun, moon, mist, fireflies ----------
// sky: one even colour per moment (scene.background, identical to the fog colour, so fogged far walls melt into it: no bands, corners or black cap)
// stars: a few hundred points far beyond everything (no fog), faded in at dusk, out at dawn
const starMat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
const stars = (() => {
  const n = 420, p = [], c = []; let h = 4242; const r = () => (h = (h * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) { const y = 0.04 + 0.96 * Math.sqrt(r()), ph = r() * Math.PI * 2, rr = Math.sqrt(1 - y * y), k = 0.55 + 0.45 * r(); p.push(Math.cos(ph) * rr * 250, y * 250, Math.sin(ph) * rr * 250); c.push(k, k, k * (0.92 + 0.08 * r())); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  const m = new THREE.Points(g, starMat); m.frustumCulled = false; m.renderOrder = -1; m.visible = false; scene.add(m); return m;
})();
const sun = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 1), new THREE.MeshBasicMaterial({ color: 0xfff3b0, fog: false })); scene.add(sun);
const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(6, 1), new THREE.MeshBasicMaterial({ color: 0xe6ecff, fog: false })); scene.add(moon);
const mistTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const mistMat = new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, opacity: 0.22, depthWrite: false, color: 0xffffff });
const mist = new THREE.Group(); scene.add(mist);
{
  const pos = [], uv = [], pl = new THREE.PlaneGeometry(1, 1).toNonIndexed();
  for (let i = 0; i < 9; i++) { const g = pl.clone(); const s = rr(10, 16); g.applyMatrix4(M4(new V3(rr(-18, 18), rr(0.25, 0.7), rr(-18, 18)), new Q().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new V3(s, s, 1))); pos.push(...g.attributes.position.array); uv.push(...g.attributes.uv.array); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  mist.add(new THREE.Mesh(g, mistMat));
}
const ffMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { t: { value: 0 }, op: { value: 0 } },
  vertexShader: 'attribute float ph;uniform float t;varying float b;void main(){vec3 p=position+vec3(sin(t*.6+ph)*.8,sin(t*.9+ph*2.)*.4,cos(t*.5+ph)*.8);b=.5+.5*sin(t*3.+ph*5.);vec4 mv=modelViewMatrix*vec4(p,1.);gl_PointSize=clamp(60./-mv.z,2.,18.);gl_Position=projectionMatrix*mv;}',
  fragmentShader: 'uniform float op;varying float b;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(vec3(.75,1.,.35)*op*b*smoothstep(.5,0.,d),1.);}',
});
const fireflies = (() => { const n = 70, p = [], ph = []; for (let i = 0; i < n; i++) { p.push(rr(-22, 22), rr(0.5, 4.5), rr(-22, 22)); ph.push(rnd() * 6.28); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('ph', new THREE.Float32BufferAttribute(ph, 1)); const m = new THREE.Points(g, ffMat); m.frustumCulled = false; scene.add(m); return m; })();

// ---------- animals: birds overhead + butterflies (CPU-animated, one draw call each) ----------
function dynMesh(nTris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nTris * 9), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nTris * 9), 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })); m.frustumCulled = false; scene.add(m); return m;
}
const BIRDS = []; for (let i = 0; i < 6; i++) BIRDS.push({ cx: rr(-8, 8), cz: rr(-8, 8), R: rr(10, 22), y: rr(16, 23), w: rr(0.12, 0.25) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * 6.28, col: new C3(['#e63b2e', '#2e7be6', '#ffffff', '#ffcc22', '#1fbf6a', '#ff7a1a'][i]) });
const birdMesh = dynMesh(BIRDS.length * 4);
const BUTTER = []; for (let i = 0; i < 10; i++) { const f = FLOWERS[(i * 3) % FLOWERS.length]; BUTTER.push({ c: f.clone(), ph: rnd() * 6.28, sp: rr(0.4, 0.8), col: new C3(['#ff5fd2', '#ffe24a', '#5fd0ff', '#ff8a2a', '#ffffff'][i % 5]) }); }
const butterMesh = dynMesh(BUTTER.length * 4);
{
  const bc = birdMesh.geometry.attributes.color; BIRDS.forEach((b, i) => { for (let k = 0; k < 12; k++) { const c = k < 6 ? b.col.clone().multiplyScalar(0.75) : b.col; bc.setXYZ(i * 12 + k, c.r, c.g, c.b); } });
  const uc = butterMesh.geometry.attributes.color; BUTTER.forEach((b, i) => { for (let k = 0; k < 12; k++) uc.setXYZ(i * 12 + k, b.col.r, b.col.g, b.col.b); });
}
const _a = new V3(), _b = new V3(), _c = new V3(), _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q0 = new Q(), _p0 = new V3();
function writeTri(arr, o, m, a, b, c) { _a.copy(a).applyMatrix4(m); _b.copy(b).applyMatrix4(m); _c.copy(c).applyMatrix4(m); arr[o] = _a.x; arr[o + 1] = _a.y; arr[o + 2] = _a.z; arr[o + 3] = _b.x; arr[o + 4] = _b.y; arr[o + 5] = _b.z; arr[o + 6] = _c.x; arr[o + 7] = _c.y; arr[o + 8] = _c.z; }
const BV = { n: new V3(0, 0, 0.45), t: new V3(0, 0, -0.35), l: new V3(-0.09, 0, 0), r: new V3(0.09, 0, 0), w1: new V3(-0.06, 0, 0.18), w2: new V3(-0.06, 0, -0.12), w3: new V3(0.06, 0, 0.18), w4: new V3(0.06, 0, -0.12) };
const _wl = new V3(), _wr = new V3(), S14 = new V3(1.4, 1.4, 1.4), S1 = new V3(1, 1, 1);
const BF = { L1: new V3(), L2: new V3(), R1: new V3(), R2: new V3(), N: new V3(0, 0, 0.03), T: new V3(0, 0, -0.03) };
function updateAnimals(t) {
  const pa = birdMesh.geometry.attributes.position, arr = pa.array;
  BIRDS.forEach((b, i) => {
    const sg = Math.sign(b.w), a = b.ph + t * b.w, x = b.cx + Math.cos(a) * b.R, z = b.cz + Math.sin(a) * b.R, y = b.y + Math.sin(t * 0.5 + i) * 1.2;
    const heading = Math.atan2(-Math.sin(a) * sg, Math.cos(a) * sg);
    _m.compose(_p0.set(x, y, z), _q0.setFromEuler(_e.set(0, heading, 0)), S14);
    const f = Math.sin(t * 9 + i * 2) * 0.55; _wl.set(-0.75, Math.sin(f) * 0.75, 0.05); _wr.set(0.75, Math.sin(f) * 0.75, 0.05);
    const o = i * 36;
    writeTri(arr, o, _m, BV.n, BV.l, BV.t); writeTri(arr, o + 9, _m, BV.n, BV.t, BV.r);
    writeTri(arr, o + 18, _m, BV.w1, _wl, BV.w2); writeTri(arr, o + 27, _m, BV.w3, BV.w4, _wr);
  });
  pa.needsUpdate = true;
  const pb = butterMesh.geometry.attributes.position, br = pb.array;
  BUTTER.forEach((b, i) => {
    const tt = t * b.sp + b.ph, x = b.c.x + Math.sin(tt * 1.3) * 1.2, z = b.c.z + Math.cos(tt * 0.9) * 1.2, y = b.c.y + 0.4 + Math.sin(tt * 3) * 0.25;
    _m.compose(_p0.set(x, y, z), _q0.setFromEuler(_e.set(0, tt * 1.1, 0)), S1);
    const f = Math.abs(Math.sin(t * 16 + i)) * 1.2, cy = Math.sin(f) * 0.09, cx = Math.cos(f) * 0.09; const o = i * 36;
    BF.L1.set(-cx, cy, 0.06); BF.L2.set(-cx, cy, -0.05); BF.R1.set(cx, cy, 0.06); BF.R2.set(cx, cy, -0.05);
    writeTri(br, o, _m, BF.N, BF.L1, BF.T); writeTri(br, o + 9, _m, BF.T, BF.L1, BF.L2); writeTri(br, o + 18, _m, BF.N, BF.T, BF.R1); writeTri(br, o + 27, _m, BF.T, BF.R2, BF.R1);
  });
  pb.needsUpdate = true;
}

// ---------- bananas ----------
const bananaGeo = (() => { const mg = new Merger(); mg.add(new THREE.TorusGeometry(0.12, 0.04, 5, 8, Math.PI * 0.75), '#ffe135', null, 0.05); mg.add(new THREE.ConeGeometry(0.025, 0.06, 4), '#6b4a1a', M4(new V3(0.12, 0.02, 0), new Q().setFromEuler(new THREE.Euler(0, 0, 0.2))), 0); return mg.build(); })();
const BANANAS = [];
{
  const spots = [[1.5, 0.3, 1.5], [-1.8, 0.3, -1.2], [4, 0.3, -1], [3, 1.45, 2.5], [-3, 1.6, -2.5], [-2.5, 0.95, 3], [0, 2.0, 12], [-14, 2.1, 0], [14, 1.8, -4], [7, 0.3, 9], [5, 0.3, 13],
    [-6, 0.3, 10], [-9, 4.0, -23.8], [3, 6.8, -24.3], [-9, 3.6, -26.8], [3, 6.4, -26.8], [-16, 0.3, 18], [18, 0.3, -8], [-20, 2.3, -5], [10, 2.1, -18]];
  for (const p of PLATFORMS) spots.push([p.c.x, p.c.y + 0.45, p.c.z]);
  spots.push([-3.5, 7.8, -6.4], [2.9, 7.7, -7.3]);
  for (const t of TREES.slice(2)) { const b = t.branches[1]; if (b) spots.push([b.b.x, b.b.y + 0.4, b.b.z]); }
  for (const s of spots) BANANAS.push({ p: new V3(...s), alive: true, respawn: 0 });
}
const bananaMesh = new THREE.InstancedMesh(bananaGeo, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x403000, flatShading: true }), BANANAS.length);
bananaMesh.frustumCulled = false; scene.add(bananaMesh);

// ---------- gorilla avatars (classic Gorilla Tag look: dark fur, light grey face + chest plates) ----------
// Built with its own deterministic noise (not the seeded world rnd) so the world layout is untouched.
// Per-vertex 'fur' flag: fur takes the player's colour (or lava), face/chest plates stay light grey.
class GorillaBuilder {
  constructor() { this.p = []; this.n = []; this.c = []; this.f = []; this.h = 12345; }
  noise() { this.h = (this.h * 16807) % 2147483647; return this.h / 2147483647; }
  add(geo, color, m, fur = 1, vary = 0.08) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); geo.dispose();
    if (m) g.applyMatrix4(m);
    g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array, base = new C3(color);
    for (let i = 0; i < p.length; i += 9) { const k = 1 + (this.noise() - 0.5) * 2 * vary; for (let j = 0; j < 3; j++) { this.c.push(base.r * k, base.g * k, base.b * k); this.f.push(fur); } }
    for (const v of p) this.p.push(v); for (const v of n) this.n.push(v);
    g.dispose(); return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('fur', new THREE.Float32BufferAttribute(this.f, 1));
    g.computeBoundingSphere(); return g;
  }
}
const EUL = (x, y, z) => new Q().setFromEuler(new THREE.Euler(x, y, z));
const FUR = '#ffffff', FUR_DARK = '#9a9a9a', PLATE = '#b4b4b4', RING = '#858585', EYE = '#101010', MUZZLE = '#c4c4c4', HOLE = '#2a2a2a';
// a tuft of fur: thin open 4-sided spike from 'at' along 'dir'
function tuft(gb, at, dir, len = 0.05, r = 0.016, col = FUR) {
  const d = dir.clone().normalize();
  gb.add(new THREE.ConeGeometry(r, len, 4, 1, true), col, M4(at.clone().addScaledVector(d, len / 2), qFromTo(UP, d)), 1, 0.15);
}
function mirrorX(geo) { // right-hand copy of a left-hand model (flip x, keep triangle winding front-facing)
  const g = geo.clone();
  for (const name of ['position', 'normal', 'color', 'fur']) {
    const a = g.attributes[name], s = a.itemSize, arr = a.array;
    for (let i = 0; i < arr.length; i += 3 * s) for (let k = 0; k < s; k++) { const t = arr[i + s + k]; arr[i + s + k] = arr[i + 2 * s + k]; arr[i + 2 * s + k] = t; }
  }
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  for (let i = 0; i < p.length; i += 3) { p[i] = -p[i]; n[i] = -n[i]; }
  g.computeBoundingSphere(); return g;
}
// Hand in WebXR grip space (left hand): palm faces +x, fingers wrap forward (-z), thumb on top, wrist at +z (the IK forearm joins there).
function buildHand(closed = false) { // closed: fingers curled into the palm and thumb across them (trigger grip)
  const gb = new GorillaBuilder(); gb.h = 777; const SKIN = new C3(2.1, 2.1, 2.1), SKIN2 = new C3(1.7, 1.7, 1.7); // palm/fingers a shade lighter than the fur
  gb.add(new THREE.BoxGeometry(0.06, 0.11, 0.105), SKIN2, M4(new V3(0.002, 0, -0.01)), 1, 0.06);           // palm
  gb.add(new THREE.BoxGeometry(0.03, 0.115, 0.075), FUR, M4(new V3(-0.028, 0, 0.0)), 1, 0.06);              // back of hand
  for (const [y, len] of [[0.037, 0.06], [0, 0.068], [-0.037, 0.056]]) {                                  // 3 chunky fingers
    if (closed) { // knuckle at z=-0.06: first segment bends toward the palm (+x), tip folds back toward the wrist
      const K = new V3(-0.006, y, -0.06), a1 = -1.15, a2 = -2.55, d1 = new V3(-Math.sin(a1), 0, -Math.cos(a1)), d2 = new V3(-Math.sin(a2), 0, -Math.cos(a2)), L1 = len * 0.62;
      gb.add(new THREE.BoxGeometry(0.038, 0.032, L1), SKIN, M4(K.clone().addScaledVector(d1, L1 / 2), EUL(0, a1, 0)), 1, 0.08);
      gb.add(new THREE.BoxGeometry(0.034, 0.03, 0.045), SKIN2, M4(K.clone().addScaledVector(d1, L1).addScaledVector(d2, 0.02), EUL(0, a2, 0)), 1, 0.08);
      continue;
    }
    gb.add(new THREE.BoxGeometry(0.038, 0.032, len), SKIN, M4(new V3(-0.006, y, -0.06 - len / 2)), 1, 0.08);
    gb.add(new THREE.BoxGeometry(0.034, 0.03, 0.045), SKIN2, M4(new V3(0.008, y, -0.075 - len), EUL(0, -0.55, 0)), 1, 0.08);
  }
  if (closed) gb.add(new THREE.BoxGeometry(0.034, 0.034, 0.07), SKIN, M4(new V3(0.058, 0.03, -0.075), EUL(-Math.PI / 2 + 0.35, 0, 0.2)), 1, 0.06); // thumb wrapped over the curled fingers
  else gb.add(new THREE.BoxGeometry(0.034, 0.034, 0.07), SKIN, M4(new V3(0.03, 0.062, -0.04), EUL(0.3, -0.7, 0)), 1, 0.06); // thumb
  gb.add(new THREE.CylinderGeometry(0.052, 0.05, 0.05, 7, 1, true).rotateX(Math.PI / 2), FUR, M4(new V3(0, 0, 0.05)), 1, 0.08); // wrist stub (forearm overlaps it)
  for (const [y, z] of [[0.035, 0.02], [-0.03, 0.025], [0.0, -0.02], [0.04, -0.03], [-0.04, -0.025]]) tuft(gb, new V3(-0.042, y, z), new V3(-0.6, 0.15, 1), 0.026, 0.01);
  for (let i = 0; i < 7; i++) { const ang = i / 7 * Math.PI * 2 + 0.3, r = new V3(Math.cos(ang) * 0.75, Math.sin(ang), 0); tuft(gb, new V3(0, 0, 0.045).addScaledVector(r, 0.055), r.clone().multiplyScalar(0.8).add(new V3(0, 0, 0.9)), 0.032, 0.012); } // shaggy wrist cuff
  for (const z of [-0.035, 0.0, 0.03]) tuft(gb, new V3(-0.01, -0.058, z), new V3(-0.2, -1, 0.8), 0.028, 0.011); // hair along the outer edge
  return gb.build();
}
const gorillaGeo = (() => {
  // torso: short and bulky, no legs; light grey chest plate
  const body = new GorillaBuilder(); body.h = 31;
  body.add(new THREE.DodecahedronGeometry(0.36, 0), FUR, M4(null, null, new V3(1.15, 1.0, 0.9)), 1, 0.06);
  for (const sx of [-1, 1]) body.add(new THREE.DodecahedronGeometry(0.16, 0), FUR, M4(new V3(0.29 * sx, 0.17, 0.02)), 1, 0.06);
  body.add(new THREE.IcosahedronGeometry(0.25, 1), PLATE, M4(new V3(0, 0.02, -0.255), null, new V3(1.0, 1.05, 0.38)), 0, 0.03);
  for (let i = 0; i < 9; i++) { const a = -0.9 + 1.8 * i / 8; tuft(body, new V3(Math.sin(a) * 0.3, 0.26 - Math.abs(a) * 0.08, 0.1 + Math.cos(a) * 0.12), new V3(Math.sin(a), 0.6, 0.8), 0.06, 0.022); }
  // head: big rounded fur dome, darker brow, light grey face plate, round eye rings, big dark eyes, muzzle with nostrils, small mouth
  const head = new GorillaBuilder(); head.h = 57;
  head.add(new THREE.IcosahedronGeometry(0.175, 2), FUR, M4(new V3(0, 0.03, 0.02), null, new V3(1.05, 1.03, 1.0)), 1, 0.05); // smooth rounded dome (no cap-like brow band)
  head.add(new THREE.IcosahedronGeometry(0.12, 1), PLATE, M4(new V3(0, -0.02, -0.115), null, new V3(1.3, 1.08, 0.52)), 0, 0.03); // face plate
  for (const sx of [-1, 1]) {
    head.add(new THREE.CylinderGeometry(0.047, 0.047, 0.02, 10), RING, M4(new V3(0.055 * sx, 0.02, -0.165), EUL(Math.PI / 2, 0, 0)), 0, 0.02);
    head.add(new THREE.CylinderGeometry(0.031, 0.031, 0.02, 10), EYE, M4(new V3(0.055 * sx, 0.02, -0.174), EUL(Math.PI / 2, 0, 0)), 0, 0);
    head.add(new THREE.BoxGeometry(0.012, 0.012, 0.01), '#ffffff', M4(new V3(0.055 * sx + 0.01, 0.032, -0.185)), 0, 0); // eye glint
  }
  head.add(new THREE.IcosahedronGeometry(0.068, 1), MUZZLE, M4(new V3(0, -0.07, -0.165), null, new V3(1.3, 0.82, 0.75)), 0, 0.03); // muzzle
  for (const sx of [-1, 1]) head.add(new THREE.BoxGeometry(0.016, 0.012, 0.012), HOLE, M4(new V3(0.018 * sx, -0.052, -0.215)), 0, 0); // nostrils
  head.add(new THREE.BoxGeometry(0.05, 0.008, 0.012), HOLE, M4(new V3(0, -0.098, -0.205)), 0, 0); // mouth
  // arms: long and chunky, with tufts (unit length along +z, scaled to reach the hand)
  // arms: upper arm (shoulder ball -> elbow) and forearm (elbow ball -> wrist), built at nominal length along +z, posed by two-bone IK
  const upper = new GorillaBuilder(); upper.h = 99;
  upper.add(new THREE.DodecahedronGeometry(0.088, 0), FUR, null, 1, 0.06);
  upper.add(new THREE.CylinderGeometry(0.074, 0.09, ARM_L1 + 0.04, 7, 1, true).translate(0, (ARM_L1 + 0.04) / 2 - 0.02, 0).rotateX(Math.PI / 2), FUR, null, 1, 0.08);
  for (let i = 0; i < 9; i++) { const a = i * 2.4, z = 0.05 + (ARM_L1 - 0.08) * i / 8, r = new V3(Math.cos(a), Math.sin(a), 0); tuft(upper, r.clone().multiplyScalar(0.078).setZ(z), r.clone().multiplyScalar(0.6).setZ(1), 0.045, 0.016); }
  const fore = new GorillaBuilder(); fore.h = 101;
  fore.add(new THREE.DodecahedronGeometry(0.08, 0), FUR, M4(null, null, new V3(1, 1, 1.1)), 1, 0.06); // elbow
  fore.add(new THREE.CylinderGeometry(0.057, 0.074, ARM_L2 + 0.05, 7, 1, true).translate(0, (ARM_L2 + 0.05) / 2, 0).rotateX(Math.PI / 2), FUR, null, 1, 0.08); // runs 5 cm into the hand
  for (let i = 0; i < 9; i++) { const a = i * 2.4 + 1, z = 0.05 + (ARM_L2 - 0.1) * i / 8, r = new V3(Math.cos(a), Math.sin(a), 0); tuft(fore, r.clone().multiplyScalar(0.068 - 0.03 * z).setZ(z), r.clone().multiplyScalar(0.6).setZ(1), 0.04, 0.014); }
  for (const a of [0.6, 2.2, 3.8, 5.3]) tuft(fore, new V3(Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.05), new V3(Math.cos(a) * 0.5, Math.sin(a) * 0.5, -1), 0.04, 0.016); // shaggy elbow
  const handL = buildHand().scale(1.3, 1.3, 1.3); // big gorilla hands
  const handLc = buildHand(true).scale(1.3, 1.3, 1.3); // trigger held: closed fist
  return { body: body.build(), head: head.build().scale(1.22, 1.22, 1.22), upper: upper.build(), fore: fore.build(), hand: handL, handL, handR: mirrorX(handL), handLc, handRc: mirrorX(handLc) };
})();
function gorillaMat(color) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color });
  m.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float fur;\nvarying float vFur;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFur = fur;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFur;').replace('#include <color_fragment>', 'diffuseColor.rgb = vColor.rgb * mix(vec3(1.0), diffuse, vFur);');
  };
  m.customProgramCacheKey = () => 'gorilla-fur';
  return m;
}
const LAVA = new C3(0xff4a12);
// name tag: white pixel-style text on the chest (crisp nearest-filtered low-res canvas, hard alpha)
function nameSprite(text) {
  const W = 128, H = 20, c = document.createElement('canvas'); c.width = W; c.height = H; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.053), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, depthWrite: false }));
  s.userData.set = (t, it) => {
    const x = c.getContext('2d'); x.clearRect(0, 0, W, H);
    x.fillStyle = '#fff'; x.font = 'bold 15px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const str = String(t).toUpperCase(); const w = x.measureText(str).width; x.save(); if (w > W - 4) { x.translate(W / 2, 0); x.scale((W - 4) / w, 1); x.translate(-W / 2, 0); } x.fillText(str, W / 2, H / 2 + 1); x.restore();
    const im = x.getImageData(0, 0, W, H), d = im.data; for (let i = 3; i < d.length; i += 4) { const on = d[i] > 110; d[i] = on ? 255 : 0; d[i - 1] = d[i - 2] = d[i - 3] = 255; } x.putImageData(im, 0, 0);
    tex.needsUpdate = true; s.userData.text = t; s.userData.it = !!it;
  };
  s.userData.set(text); return s;
}
const _qFlipY = new Q().setFromAxisAngle(UP, Math.PI);
// two-bone IK: shoulder -> elbow -> wrist. Elbow bends outward/back/down (pole), stretches uniformly past full reach, never flips for close hands.
const _ik = { dir: new V3(), perp: new V3(), pole: new V3(), S: new V3(), W: new V3(), E: new V3(), off: new V3() };
function solveElbow(S, T, pole, out) {
  const dir = _ik.dir.subVectors(T, S); let d = dir.length(); if (d < 1e-5) { dir.set(0, -1, 0); d = 1e-5; } else dir.divideScalar(d);
  const k = Math.max(1, d / (ARM_L1 + ARM_L2)), a1 = ARM_L1 * k, a2 = ARM_L2 * k;
  const dc = Math.max(Math.abs(a1 - a2) + 0.08, Math.min(d, a1 + a2 - 1e-4));
  const a = (a1 * a1 - a2 * a2 + dc * dc) / (2 * dc), h = Math.sqrt(Math.max(0, a1 * a1 - a * a));
  const perp = _ik.perp.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-3) { perp.set(0, -1, 0).addScaledVector(dir, dir.y); if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0); }
  perp.normalize();
  return out.copy(S).addScaledVector(dir, a).addScaledVector(perp, h);
}
function boneTo(m, a, b, L) { m.position.copy(a); m.scale.set(1, 1, Math.max(0.03, a.distanceTo(b)) / L); m.lookAt(b); }
// pose one whole arm (upper, fore, hand) from the head pose (yaw quat yq), the hand position h and optional hand rotation q
function poseArm(i, upper, fore, hand, head, yq, h, q) {
  const sx = i ? 1 : -1, S = _ik.S.copy(_ik.off.set(SHOULDER.x * sx, SHOULDER.y, SHOULDER.z).applyQuaternion(yq)).add(head), W = _ik.W;
  if (q) W.copy(WRIST_LOCAL).applyQuaternion(q).add(h);
  else { const d = _ik.dir.subVectors(h, S); if (d.lengthSq() < 1e-6) d.set(0, -1, 0); d.normalize(); W.copy(h).addScaledVector(d, -WRIST_LOCAL.z); }
  const E = solveElbow(S, W, _ik.pole.set(0.9 * sx, -0.55, 0.6).applyQuaternion(yq), _ik.E);
  boneTo(upper, S, E, ARM_L1); boneTo(fore, E, W, ARM_L2);
  if (hand) { hand.position.copy(h); if (q) hand.quaternion.copy(q); else hand.quaternion.copy(fore.quaternion).multiply(_qFlipY); } // no hand rotation sent: fingers continue the forearm
}
function makeGorilla(color, name) {
  const mat = gorillaMat(color);
  const g = { mat, color: new C3(color), group: new THREE.Group(), it: false };
  g.body = new THREE.Mesh(gorillaGeo.body, mat); g.head = new THREE.Mesh(gorillaGeo.head, mat);
  g.hands = [new THREE.Mesh(gorillaGeo.handL, mat), new THREE.Mesh(gorillaGeo.handR, mat)];
  g.arms = [new THREE.Mesh(gorillaGeo.upper, mat), new THREE.Mesh(gorillaGeo.upper, mat)];
  g.fores = [new THREE.Mesh(gorillaGeo.fore, mat), new THREE.Mesh(gorillaGeo.fore, mat)];
  g.tag = nameSprite(name);
  g.tag.position.set(0, 0.15, -0.352); g.tag.rotation.set(0, Math.PI, 0); // on the upper chest, facing forward (-z)
  g.body.add(g.tag);
  g.group.add(g.body, g.head, ...g.hands, ...g.arms, ...g.fores); scene.add(g.group);
  g.setColor = c => { g.color.set(c); g.apply(g.it); };
  g.apply = it => { g.it = it; mat.color.copy(it ? LAVA : g.color); mat.emissive.set(it ? 0xff2200 : 0x000000); mat.emissiveIntensity = it ? 0.55 : 0; g.tag.userData.set(g.tag.userData.text, it); };
  const yq = new Q(), e = new THREE.Euler(), ye = new THREE.Euler();
  g.pose = (head, hq, hl, hr, ql, qr) => {
    e.setFromQuaternion(hq, 'YXZ'); yq.setFromEuler(ye.set(0, e.y, 0));
    g.head.position.copy(head); g.head.quaternion.copy(hq);
    g.body.position.copy(head); g.body.position.y -= BODY_OFF - 0.05; g.body.quaternion.copy(yq);
    poseArm(0, g.arms[0], g.fores[0], g.hands[0], head, yq, hl, ql); poseArm(1, g.arms[1], g.fores[1], g.hands[1], head, yq, hr, qr);
  };
  // cosmetics (shop items): hat/face on the head, body items on the torso; layers follow the parent (mirror avatar = layer 5)
  g.grip = 0; g.setGrip = bits => { bits |= 0; if (bits === g.grip) return; g.grip = bits; g.hands[0].geometry = bits & 1 ? gorillaGeo.handLc : gorillaGeo.handL; g.hands[1].geometry = bits & 2 ? gorillaGeo.handRc : gorillaGeo.handR; }; // trigger = closed hand
  g.cos = {}; g.cosKey = '{}';
  g.setCos = cos => {
    const key = JSON.stringify(cos || {}); if (key === g.cosKey) return; g.cosKey = key;
    for (const sl of ['hat', 'face', 'body']) {
      const id = cos && cos[sl], cur = g.cos[sl]; if (cur && cur.userData.id === id) continue;
      if (cur) { cur.parent.remove(cur); g.cos[sl] = null; }
      if (id && COS_GEO[id]) { const m = new THREE.Mesh(COS_GEO[id], COS_MAT), par = sl === 'body' ? g.body : g.head; m.userData.id = id; m.layers.mask = par.layers.mask; par.add(m); g.cos[sl] = m; }
    }
  };
  g.dispose = () => { scene.remove(g.group); mat.dispose(); g.tag.material.map.dispose(); g.tag.material.dispose(); g.tag.geometry.dispose(); };
  return g;
}

// ---------- local player ----------
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
const ME = {
  name: LS('mm_name') || ('Monkey' + (100 + Math.floor(Math.random() * 900))),
  color: '#34343a', // classic near-black gorilla fur (face and chest plates stay light grey)
  bananas: 0,
};
const handMat = gorillaMat(ME.color); // first-person hands: palm, 3 fingers + thumb, furry forearm
const myHands = [new THREE.Mesh(gorillaGeo.handL, handMat), new THREE.Mesh(gorillaGeo.handR, handMat)];
myHands.forEach(h => scene.add(h));
// first-person arms (upper arm + elbow + forearm joined to the hand), on their own layer so the mirror shows the full avatar instead
const FP_LAYER = 6; camera.layers.enable(FP_LAYER);
const myArms = [0, 1].map(() => { const u = new THREE.Mesh(gorillaGeo.upper, handMat), f = new THREE.Mesh(gorillaGeo.fore, handMat); u.layers.set(FP_LAYER); f.layers.set(FP_LAYER); scene.add(u, f); return { u, f }; });
const _fpE = new THREE.Euler(), _fpY = new THREE.Euler(), _fpQ = new Q();
const wristCv = document.createElement('canvas'); wristCv.width = 256; wristCv.height = 160;
const wristTex = new THREE.CanvasTexture(wristCv); wristTex.colorSpace = THREE.SRGBColorSpace;
const wrist = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.0875), new THREE.MeshBasicMaterial({ map: wristTex, fog: false }));
wrist.position.set(0, 0.078, 0.14); wrist.rotation.x = -Math.PI / 2 + 0.35; myHands[0].add(wrist); // just behind the wrist cuff, raised clear of the hand and fur
const muteBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 10), new THREE.MeshBasicMaterial({ color: 0x33dd55, fog: false }));
muteBtn.position.set(0.088, 0.07, 0.13); myHands[0].add(muteBtn);
const dbgBtnCv = document.createElement('canvas'); dbgBtnCv.width = 128; dbgBtnCv.height = 56; // DEBUG touch button, left of the wrist panel (test build)
const dbgBtnTex = new THREE.CanvasTexture(dbgBtnCv); dbgBtnTex.colorSpace = THREE.SRGBColorSpace;
const dbgBtn = new THREE.Mesh(new THREE.PlaneGeometry(0.046, 0.0201), new THREE.MeshBasicMaterial({ map: dbgBtnTex, fog: false }));
dbgBtn.position.set(-0.099, 0.078, 0.14); dbgBtn.rotation.x = wrist.rotation.x; myHands[0].add(dbgBtn);
wrist.visible = muteBtn.visible = dbgBtn.visible = false; // hidden until the left thumbstick is clicked

// ---------- input: real WebXR, desktop fallback, or scripted fake XR for tests ----------
const DESK = { yaw: 0, pitch: -0.15, keys: new Set(), ph: 0, cph: 0, jumpT: 9, jumpLatch: false };
function emptyInput() { return { head: new V3(0, 1.6, 0), headQ: new Q(), hands: [{ p: new V3(-0.25, 0.9, -0.25), q: new Q(), grip: false }, { p: new V3(0.25, 0.9, -0.25), q: new Q(), grip: false }] }; }
function readVR(frame) {
  const inp = emptyInput(), sim = !renderer.xr.isPresenting && MM.xrSim; // MM.xrSim: scripted XRFrame/inputSources for tests (same code path as the headset)
  const ref = sim ? sim.ref : renderer.xr.getReferenceSpace(), session = sim ? sim.session : renderer.xr.getSession(); if (sim) frame = sim.frame;
  if (!frame || !ref || !session) return null;
  const vp = frame.getViewerPose(ref); if (!vp) return null;
  const tp = vp.transform.position, to = vp.transform.orientation;
  inp.head.set(tp.x, tp.y, tp.z); inp.headQ.set(to.x, to.y, to.z, to.w);
  const found = [false, false];
  for (const src of session.inputSources) {
    const i = src.handedness === 'left' ? 0 : src.handedness === 'right' ? 1 : -1; if (i < 0 || !src.gripSpace) continue;
    const gp = frame.getPose(src.gripSpace, ref); if (!gp) continue;
    const p = gp.transform.position, o = gp.transform.orientation;
    inp.hands[i].p.set(p.x, p.y, p.z); inp.hands[i].q.set(o.x, o.y, o.z, o.w);
    const b = src.gamepad && src.gamepad.buttons; inp.hands[i].grip = !!(b && b[1] && b[1].value > 0.5); inp.hands[i].stick = !!(b && b[3] && b[3].pressed); inp.hands[i].trig = !!(b && b[0] && b[0].value > 0.5); if (i === 1) inp.a = !!(b && b[4] && (b[4].pressed || b[4].value > 0.5)); else inp.y = !!(b && b[5] && (b[5].pressed || b[5].value > 0.5)); inp.hands[i].src = src; found[i] = true; // xr-standard: [4] = A (right), [5] = Y (left)
  }
  for (let i = 0; i < 2; i++) if (!found[i]) inp.hands[i].p.copy(inp.head).add(new V3(i ? 0.25 : -0.25, -0.7, -0.2));
  for (const h of inp.hands) h.p.y -= HAND_DROP; // virtual hand hangs a bit below the controller
  return inp;
}
function readDesk(dt) {
  const inp = emptyInput(); const k = DESK.keys;
  inp.headQ.setFromEuler(new THREE.Euler(DESK.pitch, DESK.yaw, 0, 'YXZ'));
  const fw = new V3(-Math.sin(DESK.yaw), 0, -Math.cos(DESK.yaw)), rt = new V3(Math.cos(DESK.yaw), 0, -Math.sin(DESK.yaw));
  const mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0), mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  const moving = mz || mx, dir = fw.clone().multiplyScalar(mz).addScaledVector(rt, mx).normalize();
  if (moving) DESK.ph += dt * 2.3;
  if (k.has('Space') && !DESK.jumpLatch) { DESK.jumpT = 0; DESK.jumpLatch = true; } if (!k.has('Space')) DESK.jumpLatch = false;
  DESK.jumpT += dt;
  const climb = k.has('KeyE'); if (climb) DESK.cph += dt * 1.5;
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1, h = inp.hands[i];
    let off = rt.clone().multiplyScalar(0.27 * s).addScaledVector(fw, 0.25); let y = -0.62;
    if (moving) {
      const ph = (DESK.ph + (i ? 0.5 : 0)) % 1;
      if (ph < 0.5) { const t = ph / 0.5; y = -1.0; off.addScaledVector(dir, 0.38 - 0.76 * t); }
      else { const t = (ph - 0.5) / 0.5; y = -0.6; off.addScaledVector(dir, -0.38 + 0.76 * t); }
    }
    if (DESK.jumpT < 0.12) y = -0.62 - (DESK.jumpT / 0.12) * 0.75; else if (DESK.jumpT < 0.3) y = -0.45;
    if (climb) {
      const held = PH.hands[i].vine;
      const ph = held ? 0.0 : (DESK.cph + (i ? 0.5 : 0)) % 1;
      if (ph < 0.5) { const t = ph / 0.5; off = rt.clone().multiplyScalar(0.2 * s).addScaledVector(fw, 0.62 - 0.12 * t); y = 0.35 - 0.75 * t; h.grip = true; }
      else { const t = (ph - 0.5) / 0.5; off = rt.clone().multiplyScalar(0.3 * s).addScaledVector(fw, 0.05); y = -0.4 + 0.75 * t; h.grip = false; }
    }
    h.p.copy(inp.head).add(off); h.p.y += y;
    h.q.copy(inp.headQ); h.trig = climb && h.grip; // E also squeezes the triggers (cliff vine)
  }
  inp.a = k.has('KeyF'); // hold F = hold A (charged jump)
  inp.y = k.has('KeyY'); // Y = menu (flat page: opens it; choose with keys 1-6)
  return inp;
}
function readFake() {
  const f = MM.fake, inp = emptyInput();
  inp.head.fromArray(f.head || [0, 1.6, 0]); if (f.headQ) inp.headQ.fromArray(f.headQ);
  for (let i = 0; i < 2; i++) { const h = f.hands && f.hands[i]; if (h) { inp.hands[i].p.fromArray(h.p); inp.hands[i].grip = !!h.grip; if (h.q) inp.hands[i].q.fromArray(h.q); inp.hands[i].stick = !!h.stick; inp.hands[i].trig = !!h.trig; } }
  inp.a = !!(f.a || (f.hands && f.hands[1] && f.hands[1].a)); inp.y = !!(f.y || (f.hands && f.hands[0] && f.hands[0].y));
  for (const h of inp.hands) h.p.y -= HAND_DROP; // same offset as real controllers
  return inp;
}

// ---------- Gorilla-Tag locomotion physics ----------
const PH = {
  V: new V3(), hist: [], simT: 0, spawned: false, grounded: false, anyAnch: false, freeze: false,
  hands: [0, 1].map(() => ({ anch: false, gripAnch: false, a: new V3(), vine: null, vLen: 0, slip: false, contact: false, col: null })),
};
// charged jump (A on the right controller): hold to charge (full at 2 s), hands planted, camera sinks; release = push off
const JUMP = { charging: false, t: 0, c: 0, sink: 0, onVine: false, plant: [new V3(), new V3()], push: 0, blend: 0, last: null, count: 0,
  FULL: 2.0, SINK: 0.3, VH: 4.66, VU: 5.08, K0: 0.3, PUSH: 0.18, BLEND: 0.15,
  GRACE: 0.3,  // support may flicker for this long (head bob on a real headset lifts the body off the floor for a frame) without losing the charge
  FLY: 1.6,    // after take-off the hands don't touch surfaces until you land (max this long), so dangling controllers can't snag the pillar side and kill the jump
  wait: false, fly: 0 };
JUMP.scale = c => JUMP.K0 + (1 - JUMP.K0) * c * c * c;               // launch speed scale: steep near the top, so only a full charge reaches the longest gaps
JUMP.speed = c => ({ h: JUMP.VH * JUMP.scale(c), u: JUMP.VU * JUMP.scale(c) });
const _n = new V3(), _p = new V3();
function nearest(p, rad = 0.6) {
  let best = 1e9, bc = null;
  for (const c of colliders) { if (c.c && p.distanceTo(c.c) - c.R > rad) continue; const d = c.f(p); if (d < best) { best = d; bc = c; } }
  return { d: best, col: bc };
}
function normalOf(col, p) {
  const e = 0.01;
  const dx = col.f(_p.set(p.x + e, p.y, p.z)) - col.f(_p.set(p.x - e, p.y, p.z));
  const dy = col.f(_p.set(p.x, p.y + e, p.z)) - col.f(_p.set(p.x, p.y - e, p.z));
  const dz = col.f(_p.set(p.x, p.y, p.z + e)) - col.f(_p.set(p.x, p.y, p.z - e));
  return new V3(dx, dy, dz).normalize();
}
const isClimb = (col, p) => typeof col.climb === 'function' ? col.climb(p) : col.climb;
function spawn(inp) {
  const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 0.8, sx = Math.cos(a) * r, sz = Math.sin(a) * r; // centre of the clearing (small jitter so players don't overlap)
  rig.position.set(sx - inp.head.x, terrainH(sx, sz) + BODY_OFF + BODY_R + 0.02 - inp.head.y, sz - inp.head.z);
  PH.V.set(0, 0, 0); PH.hist.length = 0; PH.hands.forEach(h => { h.anch = false; h.ghost = false; if (h.vine) h.vine.held--; h.vine = null; }); PH.anyAnch = false; PH.lastPlat = null; PH.lastStand = null; PH.clearFall = false; PH.spawned = true; MM.stats.spawns = (MM.stats.spawns || 0) + 1; PH.lastSup = PH.simT; JUMP.charging = false; JUMP.sink = 0; JUMP.push = 0; JUMP.blend = 0; JUMP.fly = 0;
}
// falling in the cave system: back on the last platform you stood on (safe spot away from its drop), else spawn
CX.ledgeSpawn = new V3(3, CXF, CX.ledgeZ + 1.0); // first ledge: 1 m back from its lip, facing the pillars
CX.platFirst = { id: 'first ledge', at: () => CX.ledgeSpawn };
CX.platPillars = CX.pillars.map((pc, i) => ({ id: 'pillar ' + (i + 1), pillar: true, at: () => new V3(pc.x, CXF, pc.z) }));
CX.platFar = { id: 'far ledge', at: () => new V3(3, CXF, CX.endEdge - 1.2) };
CX.platLip = { id: 'cliff lip', at: () => new V3(CX.lip.c.x - 0.7, CXF, CX.lip.c.z) };
CX.platLedges = CX.ledges.map((l, i) => ({ id: l.long ? 'long ledge' : 'cliff ledge ' + (i + 1), long: l.long, l, at: x => new V3(l.long ? clamp(x ?? l.c.x, l.c.x - l.h.x + 0.6, l.c.x + l.h.x - 0.6) : l.c.x, l.c.y + l.h.y, l.c.z) }));
CX.platClear = { id: 'top clearing', at: () => CX.clearSpawn };
CX.platJungle = { id: 'jungle', at: () => { const s = PH.lastStand || { x: 0, z: 4 }; const x = clamp(s.x, -HALF + 2.2, HALF - 2.2), z = clamp(s.z, -HALF + 2.2, HALF - 2.2); return new V3(x, terrainH(x, z), z); } };
CX.plats = [CX.platFirst, ...CX.platPillars, CX.platFar, CX.platLip, ...CX.platLedges, CX.platClear, CX.platJungle];
function cxPlatAt(p) { // which platform you are standing on (feet at p), or null
  if (p.y > CX.CLR_Y - 0.55 && inClrXZ(p) && !inShaftXZ(p, 0.05)) return CX.platClear;
  if (p.z > -HALF - 1) return CX.platJungle;                                                            // spawn clearing: last place stood
  for (let i = 0; i < CX.pillars.length; i++) { const pc = CX.pillars[i]; if (Math.hypot(p.x - pc.x, p.z - pc.z) < CX.PR + 0.4 && p.y > CXF - 0.5) return CX.platPillars[i]; }
  for (let i = 0; i < CX.ledges.length; i++) if (inXZ(p, CX.ledges[i], 0.35) && p.y > CX.ledges[i].c.y) return CX.platLedges[i];
  if (p.y < CXF - 0.5) return undefined;                                                               // below the floors: keep the last one
  if (p.x > CX.rt.vx0 - 0.5 && Math.abs(p.z - CX.rt.z) < CX.rt.hw + 1) return CX.platLip;             // side tunnel / mouth lip
  if (p.z < CX.endEdge + 0.3) return CX.platFar;                                                      // ledge chamber
  if (p.z > CX.ledgeZ - 0.3) return CX.platFirst;                                                     // tunnel, big cave, first ledge
  return undefined;
}
function spawnPlat(inp, pl) {
  if (pl && pl.pillar) pl = CX.platFirst; // any pillar fall (1-4) returns to the first ledge
  const p = pl.at(PH.lastPlatX); spawn(inp); rig.position.set(p.x - inp.head.x, p.y + BODY_OFF + BODY_R + 0.02 - inp.head.y, p.z - inp.head.z); PH.lastPlat = pl === CX.platJungle ? null : pl;
  PH.clearFall = false;
  MM.stats.ledgeSpawns = (MM.stats.ledgeSpawns || 0) + 1; MM.lastRespawn = pl.id;
}
const _pf = new V3();
function physStep(dt, inp, now) {
  const P = rig.position;
  const wasAnch = PH.anyAnch;
  if (!wasAnch) { PH.V.y -= GRAV * dt; P.addScaledVector(PH.V, dt); }
  const corr = new V3(); let nc = 0; const slip = new V3(), sCorr = new V3(); let ns = 0;
  for (let i = 0; i < 2; i++) {
    const h = PH.hands[i], ih = inp.hands[i];
    const hw = ih.p.clone().add(P);
    if (h.vine && !(h.vine.trig ? ih.trig : ih.grip)) { h.vine.held--; h.vine = null; sfx('whoosh'); }
    if (!h.vine && (ih.grip || ih.trig) && !h.anch) {
      for (const v of VINES) {
        if (!(v.trig ? ih.trig : ih.grip) || JUMP.noGrab > 0) continue; // cliff vine: triggers; jungle vines: grip
        const d = sdCap(hw, v.top, v.q, 0.05);
        if (d < 0.12) { h.vine = v; v.held++; h.vLen = clamp(hw.distanceTo(v.top), 0.4, v.L); haptic(ih, 0.5, 40); sfx('grab'); MM.stats.vineGrabs++; break; }
      }
    }
    if (h.vine) { h.contact = false; continue; }
    if (PH.clearFall) { h.anch = false; h.slick = false; h.gripAnch = false; h.contact = false; h.slip = false; continue; } // falling off the mountain top: hanging hands must not catch wall 1 on the way down
    if (inp.noHands) { h.anch = false; h.slick = false; h.gripAnch = false; h.contact = false; h.slip = false; h.ghost = true; continue; } // charged jump (planted / in flight): hands don't touch rock
    const q = nearest(hw);
    if (h.ghost) { if (q.d < HR - 0.03) { h.contact = false; h.slip = false; continue; } h.ghost = false; } // hands back on after a jump / the menu while already sunk into rock: they pass through until they come out (no snap, no launch)
    h.contact = q.d < HR + 0.01; h.col = q.col;
    if (h.anch && h.slick) { // pushing along the slick grey strip: horizontal only, the hand slides a bit
      if (q.d > HR + 0.015 || !cxStrip(hw)) { h.anch = false; h.slick = false; }
      else { const rel = ih.p.clone().sub(inp.head), d = h.rel.clone().sub(rel); d.y = 0; d.multiplyScalar(SLICK_K); sCorr.add(d); ns++; h.rel.copy(rel); h.a.x = hw.x + d.x; h.a.z = hw.z + d.z; } // arm strokes (hand vs head) push you; walking with your feet while a hand drags doesn't hold you back
    } else if (h.anch) {
      const release = h.gripAnch ? !ih.grip : q.d > HR + 0.015;
      if (release) { h.anch = false; h.gripAnch = false; }
      else { corr.add(h.a.clone().sub(hw)); nc++; }
    } else if (q.col && q.d < HR) {
      const n = normalOf(q.col, hw), cl = isClimb(q.col, hw);
      if (!cl && n.y > 0.55 && cxStrip(hw)) { h.anch = true; h.slick = true; h.gripAnch = false; h.a.copy(hw); (h.rel || (h.rel = new V3())).copy(ih.p).sub(inp.head); haptic(ih, 0.1, 15); MM.stats.slips++; }
      else if (cl) {
        h.anch = true; h.slick = false; h.gripAnch = ih.grip; h.a.copy(hw).addScaledVector(n, HR - q.d); corr.add(h.a.clone().sub(hw)); nc++;
        const sp = PH.V.length(); haptic(ih, clamp(0.15 + sp * 0.12, 0.15, 0.9), 25); sfx('tap', sp);
      } else { slip.addScaledVector(n, HR - q.d); if (!h.slip) haptic(ih, 0.1, 15); MM.stats.slips++; }
      h.slip = !cl;
    } else if (q.col && ih.grip && q.d < HR + 0.06 && isClimb(q.col, hw)) {
      h.anch = true; h.slick = false; h.gripAnch = true; h.a.copy(hw); haptic(ih, 0.4, 30); sfx('tap', 1);
    } else h.slip = false;
  }
  if (nc) P.addScaledVector(corr, 1 / nc); else if (ns) P.addScaledVector(sCorr, 1 / ns);
  if (slip.lengthSq()) { P.add(slip.clampLength(0, 0.1)); const n = slip.clone().normalize(); const vn = PH.V.dot(n); if (vn < 0) PH.V.addScaledVector(n, -vn); }
  // vine: hand can't get further from the vine's top than where it grabbed → pendulum swing
  for (let i = 0; i < 2; i++) {
    const h = PH.hands[i]; if (!h.vine) continue;
    const hw = inp.hands[i].p.clone().add(P), d = hw.clone().sub(h.vine.top), len = d.length();
    if (len > h.vLen) { const u = d.multiplyScalar(1 / len); P.addScaledVector(u, h.vLen - len); const vr = PH.V.dot(u); if (vr > 0) PH.V.addScaledVector(u, -vr); }
  }
  PH.anyAnch = PH.hands.some(h => h.anch && !h.slick); // slick-strip hands push you along but don't hold you (gravity, no fling)
  PH.hist.push({ p: P.clone(), t: now }); while (PH.hist.length > 7) PH.hist.shift();
  if (PH.anyAnch && PH.hist.length > 2) { const o = PH.hist[0]; const span = Math.max(1e-3, now - o.t); PH.V.copy(P).sub(o.p).multiplyScalar(1 / span); }
  if (wasAnch && !PH.anyAnch) { PH.V.multiplyScalar(VEL_MULT).clampLength(0, MAX_JUMP); }
  PH.grounded = false;
  for (let it = 0; it < 2; it++) for (const [off, r] of [[BODY_OFF - JUMP.sink, BODY_R], [0, HEAD_R]]) { // crouch while charging a jump: body rises toward the head, so the head sinks
    const c = inp.head.clone().add(P); c.y -= off;
    for (const col of colliders) {
      if (PH.clearFall && c.z > -HALF - 0.5 && c.y < CX.CLR_Y - 1) continue; // falling off the mountain toward the start: don't land on jungle ground, rocks or trees
      if (col.c && c.distanceTo(col.c) - col.R > r + 0.2) continue;
      const d = col.f(c); if (d >= r) continue;
      const n = normalOf(col, c);
      if (n.y > 0.55) { PH.grounded = true; const dy = Math.min((r - d) / n.y, r); P.y += dy; c.y += dy; if (PH.V.y < 0) PH.V.y = 0; } // walkable: resolve vertically so you don't slide down slopes
      else { P.addScaledVector(n, r - d); c.addScaledVector(n, r - d); const vn = PH.V.dot(n); if (vn < 0) PH.V.addScaledVector(n, -vn); }
    }
  }
  if (PH.grounded && !PH.anyAnch) { const k = Math.exp(-9 * dt); PH.V.x *= k; PH.V.z *= k; if (PH.V.x * PH.V.x + PH.V.z * PH.V.z < 0.04) { PH.V.x = 0; PH.V.z = 0; } }
  pushPeers(P, inp, dt);
  const hy = P.y + inp.head.y;
  _oob.set(P.x + inp.head.x, hy, P.z + inp.head.z);
  if (PH.grounded || PH.anyAnch || PH.hands.some(h => h.vine)) PH.lastSup = now;
  if (PH.grounded) {
    _pf.set(P.x + inp.head.x, P.y + inp.head.y - BODY_OFF - BODY_R, P.z + inp.head.z);
    const pl = cxPlatAt(_pf);
    if (pl) { PH.lastPlat = pl; PH.lastPlatX = _pf.x; PH.clearFall = false; if (pl === CX.platJungle) PH.lastStand = { x: _pf.x, z: _pf.z }; }
  }
  if (PH.hands.some(h => h.vine && h.vine.shaft)) PH.lastPlat = CX.platClear; // shaft vine: falling off it puts you back in the clearing (or you climb out)
  else if (PH.hands.some(h => h.vine && h.vine.trig)) PH.lastPlat = CX.platLedges[1]; // the cliff vine hangs above the second ledge
  if (PH.lastPlat === CX.platClear && !PH.grounded && hy < CX.CLR_Y - 0.8 && hy > CX.CLR_Y - 6) PH.clearFall = true; // only if you actually dropped off the plateau (not teleported to the jungle with lastPlat still set)
  const inCx = _oob.z < -HALF - 1 && cxInterior(_oob) < 0.6;
  const fallBack = () => { MM.stats.fallResets = (MM.stats.fallResets || 0) + 1; MM.lastFall = now - PH.lastSup; if (PH.lastPlat) spawnPlat(inp, PH.lastPlat); else spawn(inp); };
  if (PH.clearFall && hy < CX.CLR_Y - 0.5 && now - (PH.lastSup ?? now) >= CX.fallT) fallBack();
  else if (inCx) { // cave system: voids are real; falling into one = 2 s of falling, then spawn
    if (cxVoid(_oob) && hy < CXF - 0.4 && now - (PH.lastSup ?? now) >= CX.fallT) fallBack();
    else if (hy < CX.ocean - 300) spawn(inp);
  } else if (offOcean(_oob) && hy < 8) { if (hy < -0.4 && now - (PH.lastSup ?? now) >= CX.fallT) fallBack(); }
  else if (hy < -6 || hy > 40 || outOfBounds(_oob)) spawn(inp);
}
// out of the play area: beyond the clearing (+2 m slack), except inside a wall cave (they reach ~3.3 m into the north wall; the shop lives in one)
const _oob = new V3(), CAVE_SLACK = 0.6;
function outOfBounds(h) {
  if (Math.abs(h.x) <= HALF + 2 && Math.abs(h.z) <= HALF + 2) return false;
  if (cxInterior(h) < CAVE_SLACK) return false; // cave system, chasm and cliff air are play area (falls there use the 2 s fall timer)
  for (const k of CAVES) if (sdCaveArch(h, k) < CAVE_SLACK) return false;
  if (offOcean(h) && h.y < 20) return false;
  if (h.y > CX.CLR_Y - 1.5 && inClrXZ(h)) return false;
  if (inShaftXZ(h, 0.4) && h.y < CX.CLR_Y + 4 && h.y > CXF) return false;
  return true;
}
let lastInp = null;
const _pBody = new V3(), PEER_R = BODY_R + 0.02;
function pushPeers(P, inp, dt) { // capsule push-out vs each visible remote so two players can't occupy the same space (or the shaft vine)
  if (!NET.remotes.size) return;
  _pBody.set(P.x + inp.head.x, P.y + inp.head.y - BODY_OFF, P.z + inp.head.z);
  const rad = BODY_R + PEER_R, maxPush = 0.09; // clamp per step: smooth, no launch
  for (const r of NET.remotes.values()) {
    if (!r.avatar || !r.avatar.group.visible) continue;
    const dx = _pBody.x - r.headPos.x, dz = _pBody.z - r.headPos.z, dy = _pBody.y - (r.headPos.y - BODY_OFF);
    if (Math.abs(dy) > 1.25) continue;
    const h = Math.hypot(dx, dz);
    if (h >= rad) continue;
    if (h < 1e-4) { P.x += 0.04; _pBody.x += 0.04; continue; }
    const push = Math.min(rad - h, maxPush), s = push / h;
    P.x += dx * s; P.z += dz * s; _pBody.x += dx * s; _pBody.z += dz * s;
    const vn = PH.V.x * dx + PH.V.z * dz;
    if (vn < 0) { const k = vn / (h * h); PH.V.x -= k * dx; PH.V.z -= k * dz; }
    if (PH.V.y > 1.2) PH.V.y *= 0.5; // don't launch upward off a peer
  }
}
function physics(dt, inp, now) {
  if (PH.freeze) return;
  const n = Math.max(1, Math.ceil(dt / (1 / 90) - 1e-6)), sd = dt / n;
  const prev = lastInp || inp;
  for (let s = 1; s <= n; s++) {
    const k = s / n, li = { head: prev.head.clone().lerp(inp.head, k), headQ: inp.headQ, hands: inp.hands.map((h, i) => ({ p: prev.hands[i].p.clone().lerp(h.p, k), grip: h.grip, trig: h.trig, src: h.src })), noHands: inp.noHands };
    PH.simT += sd; physStep(sd, li, PH.simT); // simulation clock (not wall clock) for the release-velocity estimate
  }
}
function haptic(ih, v, ms) { try { const a = ih.src && ih.src.gamepad && ih.src.gamepad.hapticActuators; if (a && a[0]) a[0].pulse(v, ms); } catch (e) { } }

// ---------- audio: synthesised jungle ambience (WebAudio) ----------
const AU = { ctx: null };
function noiseBuf(ctx, sec) { const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0); let l = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; l = (l + 0.04 * w) / 1.04; d[i] = w * 0.6 + l * 2; } return b; }
function panner(ctx, pos, ref = 2, roll = 1.2, model = 'equalpower') { return new PannerNode(ctx, { panningModel: model, distanceModel: 'inverse', refDistance: ref, rolloffFactor: roll, maxDistance: 80, positionX: pos.x, positionY: pos.y, positionZ: pos.z }); }
function startAudio() {
  if (AU.ctx) { AU.ctx.resume(); return; }
  let ctx; try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  AU.ctx = ctx; AU.out = ctx.createGain(); AU.out.connect(ctx.destination); AU.master = ctx.createGain(); AU.master.gain.value = MUSIC.on ? 0.9 : 0; AU.master.connect(AU.out); // AU.master = game sound (menu 'Music' switch); voice chat bypasses it
  const nb = noiseBuf(ctx, 3); AU.nb = nb; AU.sources = [];
  const loop = (f, type, q, gain, dest) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = gain; s.connect(fl).connect(g).connect(dest); s.start(0, Math.random() * 2); return g; };
  AU.wind = loop(320, 'lowpass', 0.5, 0.05, AU.master); const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08; const lg = ctx.createGain(); lg.gain.value = 0.035; lfo.connect(lg).connect(AU.wind.gain); lfo.start();
  for (const [p, g, f, name] of [[new V3(-3, 2, -24.5), 0.5, 900, 'waterfall'], [new V3(-1, 0, -12), 0.12, 1600, 'stream'], [new V3(3.5, 0, -1), 0.1, 1800, 'stream'], [new V3(7, 0, 9), 0.08, 1300, 'pond']]) {
    const pn = panner(ctx, p, g > 0.3 ? 2.5 : 1.5, 1.3); pn.connect(AU.master); loop(f, 'bandpass', 0.6, g, pn); AU.sources.push({ name, pn });
  }
  AU.cicada = ctx.createGain(); AU.cicada.gain.value = 0; AU.cicada.connect(AU.master);
  { const g = loop(5200, 'bandpass', 3, 1, AU.cicada); const am = ctx.createOscillator(); am.frequency.value = 23; const ag = ctx.createGain(); ag.gain.value = 0.6; am.connect(ag).connect(g.gain); am.start(); }
  AU.cricket = ctx.createGain(); AU.cricket.gain.value = 0; AU.cricket.connect(AU.master);
  AU.chirp = ctx.createGain(); AU.chirp.gain.value = 0; AU.chirp.connect(AU.cricket);
  { const o = ctx.createOscillator(); o.frequency.value = 4300; o.connect(AU.chirp); o.start(); }
  AU.nextChirp = 0; AU.nextBird = ctx.currentTime + 1; AU.birds = 0;
}
function audioTick(day) {
  const ctx = AU.ctx; if (!ctx) return; const t = ctx.currentTime;
  AU.cicada.gain.setTargetAtTime(0.022 * day, t, 0.5);
  AU.cricket.gain.setTargetAtTime(0.03 * (1 - day), t, 0.5);
  if (t > AU.nextChirp) { for (let i = 0; i < 3; i++) { const s = t + 0.05 + i * 0.07; AU.chirp.gain.setValueAtTime(0, s); AU.chirp.gain.linearRampToValueAtTime(1, s + 0.01); AU.chirp.gain.linearRampToValueAtTime(0, s + 0.04); } AU.nextChirp = t + 0.7 + Math.random() * 0.5; }
  if (t > AU.nextBird) {
    const tr = TREES[(Math.random() * TREES.length) | 0], pos = new V3(tr.x + Math.random() * 4 - 2, tr.h, tr.z + Math.random() * 4 - 2);
    const pn = panner(ctx, pos, 3, 1); pn.connect(AU.master); const g = ctx.createGain(); g.gain.value = 0; g.connect(pn);
    const o = ctx.createOscillator(); o.type = 'sine'; o.connect(g);
    let s = t + 0.05;
    if (day > 0.3) { const n = 2 + (Math.random() * 4 | 0), base = 1800 + Math.random() * 2200; for (let i = 0; i < n; i++) { const f = base * (0.85 + Math.random() * 0.4); o.frequency.setValueAtTime(f, s); o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.5 : 0.7), s + 0.09); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.09, s + 0.015); g.gain.linearRampToValueAtTime(0, s + 0.1); s += 0.13 + Math.random() * 0.06; } AU.nextBird = t + 1.2 + Math.random() * 3; }
    else { for (let i = 0; i < 2; i++) { o.frequency.setValueAtTime(390, s); o.frequency.linearRampToValueAtTime(340, s + 0.35); g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.08, s + 0.05); g.gain.linearRampToValueAtTime(0, s + 0.4); s += 0.55; } AU.nextBird = t + 7 + Math.random() * 8; }
    o.start(t); o.stop(s + 0.2); o.onended = () => pn.disconnect(); AU.birds++;
  }
}
function sfx(kind, a = 1) {
  const ctx = AU.ctx; if (!ctx || ctx.state !== 'running') return; const t = ctx.currentTime;
  const g = ctx.createGain(); g.connect(AU.master);
  if (kind === 'tap') { const s = ctx.createBufferSource(); s.buffer = AU.nb; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; s.connect(f).connect(g); g.gain.setValueAtTime(clamp(0.03 + a * 0.03, 0.03, 0.2), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); s.start(t, Math.random() * 2, 0.1); return; }
  const o = ctx.createOscillator(); o.connect(g);
  const env = (v, d) => { g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.start(t); o.stop(t + d + 0.02); };
  if (kind === 'banana') { o.type = 'sine'; o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(1320, t + 0.12); env(0.15, 0.2); }
  else if (kind === 'tag') { o.type = 'sawtooth'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.45); env(0.15, 0.5); }
  else if (kind === 'round') { o.type = 'square'; [523, 659, 784].forEach((f, i) => o.frequency.setValueAtTime(f, t + i * 0.1)); env(0.06, 0.35); }
  else if (kind === 'finish') { o.type = 'triangle'; [523, 659, 784, 1046].forEach((f, i) => o.frequency.setValueAtTime(f, t + i * 0.09)); env(0.15, 0.5); }
  else if (kind === 'grab') { o.type = 'sine'; o.frequency.setValueAtTime(220, t); env(0.05, 0.06); }
  else { o.type = 'sine'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.15); env(0.04, 0.15); }
}
const _lp = new V3(), _lq = new Q(), _lf = new V3(), _lu = new V3();
function updateListener(cam) {
  const ctx = AU.ctx; if (!ctx) return; const l = ctx.listener; cam.getWorldPosition(_lp); cam.getWorldQuaternion(_lq);
  _lf.set(0, 0, -1).applyQuaternion(_lq); _lu.set(0, 1, 0).applyQuaternion(_lq); const p = _lp, f = _lf, u = _lu;
  if (l.positionX) { const t = ctx.currentTime; l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t); l.forwardX.setValueAtTime(f.x, t); l.forwardY.setValueAtTime(f.y, t); l.forwardZ.setValueAtTime(f.z, t); l.upX.setValueAtTime(u.x, t); l.upY.setValueAtTime(u.y, t); l.upZ.setValueAtTime(u.z, t); }
  else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
}

// ---------- proximity voice chat over the same WebRTC peers ----------
const VOICE = { enabled: true, stream: null, muted: false, denied: false, error: '' };
async function startVoice() {
  if (!VOICE.enabled || VOICE.stream) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { VOICE.denied = true; VOICE.error = 'no mic API'; hudDirty = true; return; }
  try {
    VOICE.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    setMute(VOICE.muted);
    if (NET.room) NET.room.addStream(VOICE.stream);
  } catch (e) { VOICE.denied = true; VOICE.error = e.name || String(e); console.warn('Mic unavailable, voice chat off:', VOICE.error); }
  hudDirty = wristDirty = true; setMute(VOICE.muted);
}
function setMute(m) {
  VOICE.muted = m; if (VOICE.stream) VOICE.stream.getAudioTracks().forEach(t => t.enabled = !m);
  muteBtn.material.color.set(m || !VOICE.stream ? 0xff3344 : 0x33dd55); hudDirty = true; wristDirty = true;
}
function attachVoice(stream, id) {
  const r = ensureRemote(id); if (!AU.ctx) startAudio(); const ctx = AU.ctx; if (!ctx) return;
  if (r.voice) { try { r.voice.src.disconnect(); r.voice.el.srcObject = null; } catch (e) { } }
  const el = new Audio(); el.muted = true; el.srcObject = stream; el.play().catch(() => { }); // Chrome needs the element for WebAudio to pull remote audio
  const src = ctx.createMediaStreamSource(stream);
  const pn = panner(ctx, r.headPos, 1.2, 1.6, 'HRTF'); pn.maxDistance = 30;
  const g = ctx.createGain(); g.gain.value = 1.6;
  src.connect(g).connect(pn).connect(AU.out); // voice chat is not affected by the menu's sound switch
  r.voice = { el, src, pn, g, stream };
}

// ---------- multiplayer: Trystero over public Nostr relays (signalling) + WebRTC mesh ----------
const NETLOG = []; const nlog = (...a) => { NETLOG.push(((performance.now() / 1000) | 0) + ' ' + a.join(' ')); if (NETLOG.length > 60) NETLOG.shift(); };
const NET = { room: null, selfId: 'local-' + Math.random().toString(36).slice(2, 8), remotes: new Map(), code: 'PUBLIC', status: 'offline', round: 0, infected: new Set(), resetAt: 0, clockOff: 0, send: null, mode: 'solo', lastPose: 0, lastInfo: 0, lastTick: 0, allLava: false };
const cleanName = s => String(s || '').replace(/[^\w \-.!?']/g, '').trim().slice(0, 14) || 'Monkey';
function ensureRemote(id) {
  let r = NET.remotes.get(id); if (r) return r;
  r = { id, name: 'Monkey', color: '#888888', samples: [], avatar: makeGorilla('#888888', '...'), headPos: new V3(0, -50, 0), hands: [new V3(), new V3()], bananas: 0, lastSeen: performance.now() };
  r.avatar.group.visible = false; NET.remotes.set(id, r); hudDirty = true; return r;
}
function removeRemote(id) { const r = NET.remotes.get(id); if (!r) return; r.avatar.dispose(); if (r.voice) { try { r.voice.src.disconnect(); r.voice.pn.disconnect(); r.voice.el.srcObject = null; } catch (e) { } } NET.remotes.delete(id); NET.infected.delete(id); hudDirty = true; }
const leaderId = () => [NET.selfId, ...NET.remotes.keys()].sort()[0];
const amLeader = () => leaderId() === NET.selfId;
const myInfo = () => ({ name: ME.name, color: ME.color, cos: shopCos(), t: Date.now() + NET.clockOff, lead: amLeader() });
const roundMsg = () => ({ round: NET.round, inf: [...NET.infected] });
function leaveNet() { if (NET.room) { try { NET.room.leave(); } catch (e) { } } NET.room = null; for (const id of [...NET.remotes.keys()]) removeRemote(id); NET.send = null; }
async function joinNet(code) {
  leaveNet(); NET.code = code; NET.status = 'connecting...';
  try {
    const T = window.__MM_TRANSPORT__ || await import('../vendor/trystero-nostr.js'); // test hook: tests can inject a local transport
    NET.selfId = T.selfId;
    const room = T.joinRoom({ appId: APPID, relayUrls: RELAYS }, 'mm-' + code.toLowerCase());
    NET.room = room; NET.status = 'online';
    const [sPose, gPose] = room.makeAction('pose'), [sInfo, gInfo] = room.makeAction('info'), [sRound, gRound] = room.makeAction('round'), [sTag, gTag] = room.makeAction('tag');
    NET.send = { pose: sPose, info: sInfo, round: sRound, tag: sTag };
    room.onPeerJoin(id => { ensureRemote(id); sInfo(myInfo(), id); if (amLeader()) sRound(roundMsg(), id); if (VOICE.stream) room.addStream(VOICE.stream, id); });
    room.onPeerLeave(id => removeRemote(id));
    gPose((d, id) => { if (!Array.isArray(d) || d.length < 16) return; const r = ensureRemote(id); r.samples.push({ t: performance.now(), d }); if (r.samples.length > 10) r.samples.shift(); r.lastSeen = performance.now(); r.bananas = d[14] | 0; r.avatar.setGrip(d[16] | 0); if (d[13] && d[15] === NET.round) NET.infected.add(id); });
    gInfo((d, id) => { if (!d) return; const r = ensureRemote(id); r.name = cleanName(d.name); r.color = /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#888888'; r.avatar.tag.userData.text = r.name; r.avatar.setColor(r.color); r.avatar.setCos(cleanCos(d.cos)); if (d.lead && id === leaderId() && typeof d.t === 'number') NET.clockOff = d.t - Date.now(); hudDirty = true; });
    gRound(d => applyRound(d));
    gTag((d, id) => { nlog('tag-rx', id.slice(0, 4), d && d.target.slice(0, 4), d && d.round); if (d && d.round === NET.round && !NET.infected.has(d.target)) { NET.infected.add(d.target); if (d.target === NET.selfId) sfx('tag'); } });
    room.onPeerStream((stream, id) => attachVoice(stream, id));
    if (VOICE.stream) room.addStream(VOICE.stream);
  } catch (e) { console.warn('Multiplayer unavailable, solo play:', e && e.message); NET.status = 'solo (offline)'; }
  hudDirty = true;
}
function applyRound(d) {
  if (!d || typeof d.round !== 'number' || d.round < NET.round) return;
  if (d.round > NET.round) { NET.round = d.round; NET.infected = new Set(d.inf || []); nlog('round-rx', d.round, d.inf.map(x => x.slice(0, 4))); onRoundStart(); }
  else (d.inf || []).forEach(x => NET.infected.add(x));
}
function onRoundStart() { NET.resetAt = 0; sfx('round'); hudDirty = wristDirty = true; }
function roundTick(now) {
  const ids = [NET.selfId, ...NET.remotes.keys()];
  for (const x of [...NET.infected]) if (!ids.includes(x)) NET.infected.delete(x);
  if (ids.length < 2) { NET.mode = 'solo'; NET.infected.clear(); NET.resetAt = 0; NET.allLava = false; return; }
  NET.mode = 'tag';
  const all = ids.every(x => NET.infected.has(x)); NET.allLava = all;
  if (!amLeader()) return;
  if (NET.infected.size === 0 || all) {
    if (!NET.resetAt) NET.resetAt = now + (all ? 3000 : 1200);
    if (now > NET.resetAt) { nlog('round-start', NET.round + 1, all ? 'all-lava' : 'none-it', [...NET.infected].map(x => x.slice(0, 4))); NET.round++; NET.infected = new Set([ids[(Math.random() * ids.length) | 0]]); if (NET.send) NET.send.round(roundMsg()); onRoundStart(); }
  } else NET.resetAt = 0;
}
const r3 = v => Math.round(v * 1000) / 1000;
function netSend(now, head, headQ, hl, hr) {
  if (!NET.send) return;
  if (now - NET.lastPose >= 1000 / 15 - 8) { NET.lastPose = Math.max(NET.lastPose + 1000 / 15, now - 200); /* ~15 Hz average even at uneven frame rates */ NET.send.pose([r3(head.x), r3(head.y), r3(head.z), r3(headQ.x), r3(headQ.y), r3(headQ.z), r3(headQ.w), r3(hl.x), r3(hl.y), r3(hl.z), r3(hr.x), r3(hr.y), r3(hr.z), NET.infected.has(NET.selfId) ? 1 : 0, ME.bananas, NET.round, GRIP_BITS]); MM.stats.posesSent++; }
  if (now - NET.lastInfo > 4000) { NET.lastInfo = now; NET.send.info(myInfo()); }
}
const _qa = new Q(), _qb = new Q();
function updateRemotes(now) {
  const rt = now - 110; // render ~110 ms in the past and interpolate between pose samples
  for (const r of NET.remotes.values()) {
    const s = r.samples; if (!s.length) continue;
    let a = s[0], b = s[s.length - 1];
    for (let i = 0; i < s.length; i++) { if (s[i].t <= rt) a = s[i]; else { b = s[i]; break; } }
    if (a.t > rt) b = a;
    const k = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 0, A = a.d, B = b.d, L = i => A[i] + (B[i] - A[i]) * k;
    r.headPos.set(L(0), L(1), L(2)); _qa.set(A[3], A[4], A[5], A[6]); _qb.set(B[3], B[4], B[5], B[6]); _qa.slerp(_qb, k).normalize();
    r.hands[0].set(L(7), L(8), L(9)); r.hands[1].set(L(10), L(11), L(12));
    r.avatar.group.visible = true; r.avatar.pose(r.headPos, _qa, r.hands[0], r.hands[1]);
    const it = NET.infected.has(r.id); if (it !== r.avatar.it) r.avatar.apply(it);
    if (r.voice && AU.ctx) { const t = AU.ctx.currentTime; r.voice.pn.positionX.setValueAtTime(r.headPos.x, t); r.voice.pn.positionY.setValueAtTime(r.headPos.y, t); r.voice.pn.positionZ.setValueAtTime(r.headPos.z, t); }
  }
}
function tagCheck(handsW) {
  if (NET.mode !== 'tag' || !NET.infected.has(NET.selfId) || !NET.send) return;
  for (const r of NET.remotes.values()) {
    if (NET.infected.has(r.id) || !r.avatar.group.visible) continue;
    const body = r.headPos.clone(); body.y -= BODY_OFF;
    for (const hw of handsW) if (hw.distanceTo(r.headPos) < 0.3 || hw.distanceTo(body) < BODY_R + 0.12) {
      nlog('tag-tx', r.id.slice(0, 4), hw.toArray().map(v => v.toFixed(2)), r.headPos.toArray().map(v => v.toFixed(2))); NET.infected.add(r.id); NET.send.tag({ round: NET.round, target: r.id }); sfx('tag'); MM.stats.tagsSent++; break;
    }
  }
}

// ---------- day / night (10 min cycle from a shared clock) ----------
const DAY = { phase: 0, day: 1 };
const C_SKY_D = new C3('#86c8f6'), C_SKY_N = new C3('#1b2a56'), C_DUSK = new C3('#ff9a5a'); // day: the old zenith/horizon blend as one colour; night: dark navy, never black
const _ch = new C3(), _sd = new V3();
function dayPhase() { return MM.timeOverride != null ? MM.timeOverride : ((((Date.now() + NET.clockOff) / 1000) % CYCLE) + CYCLE) % CYCLE / CYCLE; }
function updateSky(camPos) {
  const ph = dayPhase(), a = ph * Math.PI * 2, s = Math.sin(a);
  const day = sm((s + 0.08) / 0.3), dusk = clamp(1 - Math.abs(s) / 0.3, 0, 1) * 0.7;
  DAY.phase = ph; DAY.day = day;
  _sd.set(Math.cos(a), s, 0.35).normalize();
  sun.position.copy(camPos).addScaledVector(_sd, 160); moon.position.copy(camPos).addScaledVector(_sd, -160);
  sun.visible = s > -0.15; moon.visible = s < 0.15;
  _ch.copy(C_SKY_N).lerp(C_SKY_D, day).lerp(C_DUSK, dusk * 0.75);
  starMat.opacity = clamp(1 - day * 2.2, 0, 1); stars.visible = starMat.opacity > 0.01; stars.position.copy(camPos);
  scene.fog.color.copy(_ch); scene.background = scene.fog.color;
  sunLight.position.copy(_sd).multiplyScalar(s > 0 ? 30 : -30);
  sunLight.color.set(0xb8c8ff).lerp(new C3(0xfff0d0), day).lerp(C_DUSK, dusk * 0.5); sunLight.intensity = 0.35 + 1.75 * day;
  hemi.intensity = 0.3 + 0.75 * day; hemi.color.set(0x6a7ab8).lerp(new C3(0xcfeeff), day);
  ffMat.uniforms.op.value = clamp(1 - day * 1.3, 0, 1); fireflies.visible = day < 0.8;
  mistMat.color.set(0x6f80b0).lerp(new C3(0xffffff), day); mistMat.opacity = 0.16 + 0.08 * (1 - day);
  fallMat.uniforms.light.value = 0.35 + 0.65 * day; water.material.emissive.set(0x0a3a50).multiplyScalar(0.3 + 0.7 * day);
  bananaMesh.material.emissive.set(0x403000).multiplyScalar(1 + (1 - day) * 1.5);
}

// ---------- bananas, vines, canopy course ----------
const _bm = new THREE.Matrix4(), _bq = new Q(), _bs = new V3(), _bp = new V3(), _be = new THREE.Euler();
function updateBananas(t, pts) {
  BANANAS.forEach((b, i) => {
    if (!b.alive && t > b.respawn) b.alive = true;
    if (b.alive) for (const p of pts) if (p.distanceTo(b.p) < 0.35) { b.alive = false; b.respawn = t + 60; ME.bananas++; shopEarn(1); sfx('banana'); hudDirty = wristDirty = true; break; }
    _bq.setFromEuler(_be.set(0.3, t * 1.5 + i, 0)); _bs.setScalar(b.alive ? 1.6 : 0.0001);
    _bm.compose(_bp.copy(b.p).setY(b.p.y + Math.sin(t * 2 + i) * 0.06), _bq, _bs); bananaMesh.setMatrixAt(i, _bm);
  });
  bananaMesh.instanceMatrix.needsUpdate = true;
}
const _vq = new Q(), _vm = new THREE.Matrix4(), DOWN = new V3(0, -1, 0), _vs = new V3(), _vl = new V3(1, 0.5, 1), _vd = new V3(), _vv = new V3(), _vp = new V3();
function updateVines(dt, hw) {
  VINES.forEach((v, i) => {
    const hi = v.held ? PH.hands.findIndex(h => h.vine === v) : -1;
    if (hi >= 0) {
      _vd.subVectors(hw[hi], v.top); if (_vd.lengthSq() < 1e-4) _vd.set(0, -1, 0); _vd.normalize();
      v.qp.copy(v.q); v.q.copy(v.top).addScaledVector(_vd, v.L);
    } else {
      _vv.subVectors(v.q, v.qp).multiplyScalar(0.993); v.qp.copy(v.q); v.q.add(_vv); v.q.y -= GRAV * dt * dt;
      _vd.subVectors(v.q, v.top).setLength(v.L); v.q.copy(v.top).add(_vd);
    }
    _vd.subVectors(v.q, v.top).normalize();
    _vq.setFromUnitVectors(DOWN, _vd); _vm.compose(v.top, _vq, _vs.set(1, v.L, 1)); vineMesh.setMatrixAt(i, _vm);
    for (let k = 0; k < 3; k++) { _vp.copy(v.top).addScaledVector(_vd, v.L * (0.3 + k * 0.3)); _vp.x += k % 2 ? 0.07 : -0.07; _vm.compose(_vp, _vq, _vl); vineLeaf.setMatrixAt(i * 3 + k, _vm); }
  });
  vineMesh.instanceMatrix.needsUpdate = true; vineLeaf.instanceMatrix.needsUpdate = true;
}
const COURSE_S = { state: 'idle', t0: 0, last: null, best: parseFloat(LS('mm_course_best')) || null, msg: 'Climb this tree to the blue pad' };
function inPad(pad, p, up = 0.9) { const c = pad.c, h = pad.h; return Math.abs(p.x - c.x) < h.x + 0.25 && Math.abs(p.z - c.z) < h.z + 0.25 && p.y > c.y + h.y - 0.15 && p.y < c.y + h.y + up; }
function updateCourse(now, feet, hw) {
  const s = COURSE_S, onStart = inPad(COURSE.start, feet);
  const prev = s.state + s.msg;
  if (onStart && s.state !== 'running') { s.state = 'ready'; s.msg = 'GO when you leave the pad!'; }
  else if (s.state === 'ready' && !onStart) { s.state = 'running'; s.t0 = now; s.msg = 'Race to the yellow pad!'; }
  if (s.state === 'running') {
    if (inPad(COURSE.finish, feet) || hw.some(h => inPad(COURSE.finish, h, 0.25))) {
      const tm = (now - s.t0) / 1000; s.last = tm; s.state = 'done';
      if (!s.best || tm < s.best) { s.best = tm; LS('mm_course_best', tm.toFixed(2)); s.msg = 'NEW BEST!'; } else s.msg = 'Finished!';
      sfx('finish');
    } else if (feet.y < 2.5) { s.state = 'idle'; s.msg = 'You fell! Climb back up'; }
    else if (now - s.t0 > 300000) { s.state = 'idle'; s.msg = 'Too slow, try again'; }
  }
  if (prev !== s.state + s.msg) signDirty = wristDirty = hudDirty = true;
}
const fmt = t => t == null ? '--' : t.toFixed(2) + 's';
let signDirty = true, wristDirty = true, hudDirty = true;
function drawSign(now) {
  const x = signCv.getContext('2d'), s = COURSE_S;
  x.fillStyle = '#2f5d23'; x.fillRect(0, 0, 512, 256); x.strokeStyle = '#ffd23f'; x.lineWidth = 10; x.strokeRect(6, 6, 500, 244);
  x.fillStyle = '#ffd23f'; x.font = 'bold 46px system-ui,sans-serif'; x.textAlign = 'center'; x.fillText('CANOPY COURSE', 256, 62);
  x.fillStyle = '#fff'; x.font = 'bold 40px system-ui,sans-serif';
  x.fillText(s.state === 'running' ? 'Time: ' + fmt((now - s.t0) / 1000) : 'Last: ' + fmt(s.last), 256, 120);
  x.fillText('Best: ' + fmt(s.best), 256, 172); x.font = '28px system-ui,sans-serif'; x.fillStyle = '#e8ffd8'; x.fillText(s.msg, 256, 222);
  signTex.needsUpdate = true; MM.signText = [s.state === 'running' ? 'Time: ' + fmt((now - s.t0) / 1000) : 'Last: ' + fmt(s.last), 'Best: ' + fmt(s.best), s.msg];
}
function drawWrist(now) {
  const x = wristCv.getContext('2d'), it = NET.infected.has(NET.selfId);
  x.fillStyle = it ? '#7a1a00' : '#14301c'; x.fillRect(0, 0, 256, 160);
  x.fillStyle = '#ffe135'; x.font = 'bold 34px system-ui,sans-serif'; x.textAlign = 'left'; x.fillText('Bananas ' + ME.bananas, 10, 42);
  x.fillStyle = '#fff'; x.font = 'bold 26px system-ui,sans-serif';
  x.fillText(COURSE_S.state === 'running' ? 'Time ' + fmt((now - COURSE_S.t0) / 1000) : 'Best ' + fmt(COURSE_S.best), 10, 80);
  x.font = '22px system-ui,sans-serif'; x.fillText((NET.mode === 'tag' ? (it ? "YOU'RE IT!" : 'Run!') : 'Solo') + ' - ' + (1 + NET.remotes.size) + 'P', 10, 114);
  x.textAlign = 'right'; x.fillStyle = VOICE.muted || !VOICE.stream ? '#ff6677' : '#66ff88'; x.fillText(VOICE.stream ? (VOICE.muted ? 'MUTED' : 'MIC ON') : 'NO MIC', 248, 114);
  x.textAlign = 'left'; x.fillStyle = BATT.level != null && BATT.level < 0.2 && !BATT.charging ? '#ff6677' : '#cfe8ff'; x.fillText(BATT.text, 10, 148);
  wristTex.needsUpdate = true;
}
// headset battery (Battery Status API): updated on level/charging events plus a slow poll; 'Battery --' when unavailable
const BATT = { api: false, level: null, charging: false, text: 'Battery --' };
(async () => {
  try {
    if (typeof navigator.getBattery !== 'function') return;
    const b = await navigator.getBattery(); BATT.api = true;
    const up = () => { BATT.level = Number.isFinite(b.level) ? b.level : null; BATT.charging = !!b.charging; BATT.text = BATT.level == null ? 'Battery --' : 'Battery ' + Math.round(BATT.level * 100) + '%' + (BATT.charging ? ' (charging)' : ''); wristDirty = true; };
    up(); b.addEventListener('levelchange', up); b.addEventListener('chargingchange', up); setInterval(up, 60000);
  } catch (e) { BATT.text = 'Battery --'; }
})();
function drawHud(now) {
  const it = NET.infected.has(NET.selfId);
  $('hud').innerHTML = `<b>${ME.name}</b> - Bananas: ${ME.bananas}<br>Room <b>${NET.code}</b> - ${NET.status} - players ${1 + NET.remotes.size}<br>` +
    (NET.mode === 'tag' ? (NET.allLava ? 'Everyone is lava! New round...' : it ? '<span class="it">YOU ARE IT - tag someone!</span>' : 'Run from the lava monkeys!') + ` (round ${NET.round})` : 'Solo free play - waiting for monkeys') +
    `<br>Course: ${COURSE_S.state === 'running' ? fmt((now - COURSE_S.t0) / 1000) : 'best ' + fmt(COURSE_S.best)} - Mic: ${VOICE.stream ? (VOICE.muted ? 'muted (M)' : 'on (M to mute)') : (VOICE.enabled ? 'unavailable' : 'off')}`;
}

// ---------- main loop ----------
const GAME = { playing: false };
let lastT = performance.now(), uiT = 0;
const frameMs = [], clock0 = performance.now();
const MM = window.MM = {
  THREE, scene, renderer, rig, camera, PH, VINES, BANANAS, TREES, COURSE, COURSE_S, NET, VOICE, ME, DAY, ROCKS, CAVES, PLATFORMS, colliders, nearest, terrainH, GAME,
  paused: false, fake: null, timeOverride: null, stats: { tagsSent: 0, vineGrabs: 0, slips: 0, posesSent: 0 }, CLIMB_H, HALF, WALL_H, HR, BODY_OFF, BODY_R,
  frameMs, updateMs: [], RELAYS, APPID, NETLOG, birdPos: () => [...birdMesh.geometry.attributes.position.array.slice(0, 3)], butterPos: () => [...butterMesh.geometry.attributes.position.array.slice(0, 3)],
  sunVisible: () => sun.visible, moonVisible: () => moon.visible, firefliesOp: () => ffMat.uniforms.op.value, sunI: () => sunLight.intensity, fogColor: () => scene.fog.color.getHexString(),
};
const handsW = [new V3(), new V3()];
let GRIP_BITS = 0;
const _jf = new V3(), _jr = new V3(), _je = new THREE.Euler();
function jumpLaunch(inp) { // push off (on release, or automatically when the charge is full)
  const J = JUMP, P = rig.position; J.charging = false; const sp = J.speed(J.c);
  PH.V.copy(_jf).multiplyScalar(sp.h); PH.V.y = sp.u; // forward = where the head is looking (yaw only)
  if (J.onVine) { for (const h of PH.hands) { if (h.vine) { h.vine.held--; h.vine = null; } } J.noGrab = 0.4; }
  else { J.push = J.PUSH; P.y += 0.03; }
  for (const h of PH.hands) { h.anch = false; h.gripAnch = false; }
  PH.anyAnch = false; PH.hist.length = 0; J.fly = J.FLY; J.wait = true; J.count++; J.last = { c: J.c, h: sp.h, u: sp.u, t: J.t, auto: J.c >= 1, dir: [_jf.x, _jf.z] }; sfx('whoosh'); haptic(inp.hands[1], 0.3 + 0.6 * J.c, 60);
}
function jumpTick(dt, inp) {
  const J = JUMP, P = rig.position, vineHeld = PH.hands.some(h => h.vine);
  const support = PH.grounded || PH.anyAnch || vineHeld || PH.simT - (PH.lastSup ?? -9) < J.GRACE; // brief flickers (head bob) keep the charge
  _je.setFromQuaternion(inp.headQ, 'YXZ'); _jf.set(-Math.sin(_je.y), 0, -Math.cos(_je.y)); _jr.set(-_jf.z, 0, _jf.x);
  if (!(inp.aRaw ?? inp.a) && (PH.grounded || PH.anyAnch || vineHeld)) J.wait = false; // after any charged jump, A must be released on the ground (not in mid-air) before a new charge
  if (inp.a && !J.wait) {
    if (!J.charging && support && !J.push && !(J.fly > 0 && !PH.grounded && !vineHeld)) {
      J.charging = true; J.t = 0; J.c = 0; J.onVine = vineHeld;
      if (!J.onVine) { const gy = inp.head.y + P.y - BODY_OFF - BODY_R + HR; for (let i = 0; i < 2; i++) J.plant[i].copy(inp.head).add(P).addScaledVector(_jf, 0.34).addScaledVector(_jr, i ? 0.24 : -0.24).setY(gy); }
    }
    if (J.charging) {
      if (!support) { J.charging = false; if (!J.onVine) J.blend = J.BLEND; } // walked off for real: charge lost, hands ease back to the controllers (no snapping)
      else {
        J.t += dt; J.c = Math.min(1, J.t / J.FULL); if (!J.onVine) { J.sink = J.SINK * J.c; PH.V.x = 0; PH.V.z = 0; } // crouched with hands planted: you stay put
        if (J.c >= 1) { jumpLaunch(inp); J.wait = true; } // full charge (2 s): jumps by itself
      }
    }
  } else if (J.charging) jumpLaunch(inp); // released early: partial jump
  if (!J.charging) J.sink = Math.max(0, J.sink - dt * 2.0);
  J.noGrab = Math.max(0, (J.noGrab || 0) - dt);
  if (J.fly > 0) { J.fly = Math.max(0, J.fly - dt); if ((PH.grounded && J.fly < J.FLY - 0.15) || vineHeld) J.fly = 0; } // landed / caught a vine: hands work again
  // hands: planted on the ground while charging, still pressing down for a moment after take-off, then back to the controllers
  const planted = J.charging && !J.onVine;
  if (!planted && J.push > 0) { J.push = Math.max(0, J.push - dt); if (!J.push) J.blend = J.BLEND; }
  else if (!planted && J.blend > 0) J.blend = Math.max(0, J.blend - dt);
  if (planted || J.push > 0 || J.blend > 0) {
    const k = planted || J.push > 0 ? 1 : J.blend / J.BLEND;
    for (let i = 0; i < 2; i++) inp.hands[i].p.lerp(_jr.copy(J.plant[i]).sub(P), k);
    _jr.set(-_jf.z, 0, _jf.x); inp.noHands = true;
  }
  if (J.fly > 0) inp.noHands = true; // in flight: hands can still catch a vine, but don't bump into rock
  J.held = !!inp.a;
}
const _hw = new V3(), _bw = new V3();
function update(dt, frame) {
  const now = performance.now(), t = (now - clock0) / 1000, u0 = now;
  let inp = null;
  if (MM.fake) inp = readFake(); else if (renderer.xr.isPresenting || MM.xrSim) inp = readVR(frame); else inp = readDesk(dt);
  if (!inp) return;
  if (!PH.spawned) spawn(inp);
  menuInput(inp); // Y menu: toggles; while open, A / triggers / grips and hand contact are ignored
  jumpTick(dt, inp);
  physics(dt, inp, now / 1000); lastInp = inp;
  if (!renderer.xr.isPresenting) { camera.position.copy(inp.head); camera.quaternion.copy(inp.headQ); }
  const P = rig.position, headW = inp.head.clone().add(P);
  for (let i = 0; i < 2; i++) {
    handsW[i].copy(inp.hands[i].p).add(P);
    const h = PH.hands[i]; if (h.anch) handsW[i].copy(h.a);
    else if (!h.vine) { const q = nearest(handsW[i], 0.2); if (q.col && q.d < HR) handsW[i].addScaledVector(normalOf(q.col, handsW[i]), HR - q.d); }
    myHands[i].position.copy(handsW[i]); myHands[i].quaternion.copy(inp.hands[i].q);
    myHands[i].geometry = inp.hands[i].trig ? (i ? gorillaGeo.handRc : gorillaGeo.handLc) : (i ? gorillaGeo.handR : gorillaGeo.handL); // trigger closes the hand
  }
  GRIP_BITS = (inp.hands[0].trig ? 1 : 0) | (inp.hands[1].trig ? 2 : 0);
  _fpE.setFromQuaternion(inp.headQ, 'YXZ'); _fpQ.setFromEuler(_fpY.set(0, _fpE.y, 0));
  for (let i = 0; i < 2; i++) poseArm(i, myArms[i].u, myArms[i].f, null, headW, _fpQ, handsW[i], inp.hands[i].q);
  // left thumbstick click (edge) shows/hides the wrist info panel and its mic dot
  const stick = !!inp.hands[0].stick; if (stick && !MM._stickPrev) { wrist.visible = muteBtn.visible = dbgBtn.visible = !wrist.visible; wristDirty = true; } MM._stickPrev = stick;
  // wrist mute button: touch it with the right hand (only while the panel is shown)
  myHands[0].updateMatrixWorld(true); muteBtn.getWorldPosition(_bw);
  const near = muteBtn.visible && handsW[1].distanceTo(_bw) < 0.05;
  if (near && !MM._btnLatch && now - (MM._btnT || 0) > 600) { setMute(!VOICE.muted); MM._btnT = now; }
  MM._btnLatch = near;
  menuTouch(now);
  if (dbgBtn.visible) { dbgBtn.getWorldPosition(_bw); const nd = handsW[1].distanceTo(_bw) < 0.045; if (nd && !MM._dbgLatch && now - (MM._dbgT || 0) > 600) { dbgSet(!DBG.on); MM._dbgT = now; } MM._dbgLatch = nd; } // touch DEBUG with the right hand (wrist panel shown)
  const feet = headW.clone(); feet.y -= BODY_OFF + BODY_R;
  updateBananas(t, [handsW[0], handsW[1], headW]);
  shopTick(now, headW);
  updateCourse(now, feet, handsW);
  updateVines(dt, handsW);
  if (now - NET.lastTick > 500) { NET.lastTick = now; roundTick(now); }
  tagCheck(handsW);
  netSend(now, headW, inp.headQ, handsW[0], handsW[1]);
  const it = NET.infected.has(NET.selfId);
  if (it !== MM._wasIt) { MM._wasIt = it; handMat.color.set(it ? LAVA : shopLook().color); handMat.emissive.set(it ? 0xff2200 : 0); handMat.emissiveIntensity = it ? 0.6 : 0; hudDirty = wristDirty = true; }
  MM.updateMs.push(performance.now() - u0); if (MM.updateMs.length > 240) MM.updateMs.shift();
}
const _cp = new V3();
function visuals() {
  const now = performance.now(), t = (now - clock0) / 1000;
  camera.updateMatrixWorld(true); camera.getWorldPosition(_cp);
  updateSky(_cp); updateAnimals(t); updateRemotes(now);
  fallMat.uniforms.t.value = t; ffMat.uniforms.t.value = t; mist.position.x = Math.sin(t * 0.03) * 3; mist.position.z = Math.cos(t * 0.025) * 3;
  splash.scale.setScalar(1 + Math.sin(t * 6) * 0.05);
  updateMirror();
  updateCave(_cp); labelsTick(camera);
  updateListener(camera); audioTick(DAY.day);
  if (now - uiT > 250) {
    uiT = now; if (COURSE_S.state === 'running') signDirty = wristDirty = hudDirty = true;
    if (signDirty) { drawSign(now); signDirty = false; }
    if (wristDirty || NET.remotes.size) { drawWrist(now); wristDirty = false; }
    if (GAME.playing && !renderer.xr.isPresenting) drawHud(now);
  }
}
function idleCam(dt) { // landing backdrop: slow look around from the spawn point
  const t = (performance.now() - clock0) / 1000; rig.position.set(0, terrainH(0, 0) - 0.6, 0); camera.position.set(0, 1.6, 0); camera.quaternion.setFromEuler(new THREE.Euler(0.12, t * 0.05, 0, 'YXZ'));
  updateVines(dt, handsW); updateBananas(t, []);
}
function frameFn(time, frame) {
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const t0 = performance.now();
  if (GAME.playing && !MM.paused) update(dt, frame); else if (!GAME.playing) idleCam(dt);
  visuals();
  renderer.render(scene, camera);
  frameMs.push(performance.now() - t0); if (frameMs.length > 240) frameMs.shift();
  if (DBG.on) dbgFrame(now, performance.now() - t0); // DEBUG overlay: nothing at all runs here while it is off
  mtxFrame(now, performance.now() - t0);
}
renderer.setAnimationLoop(frameFn);
MM.step = (dt = 1 / 72, n = 1) => { for (let i = 0; i < n; i++) update(dt, null); };
MM.render = () => { visuals(); renderer.render(scene, camera); };
MM.outOfBounds = (x, y, z) => outOfBounds(new V3(x, y, z));
MM.respawn = () => { const inp = MM.fake ? readFake() : emptyInput(); lastInp = inp; spawn(inp); };
MM.place = (x, y, z) => { const inp = MM.fake ? readFake() : emptyInput(); rig.position.set(x - inp.head.x, y - inp.head.y, z - inp.head.z); PH.V.set(0, 0, 0); PH.hist.length = 0; PH.hands.forEach(h => { h.anch = false; if (h.vine) h.vine.held--; h.vine = null; }); PH.anyAnch = false; PH.clearFall = false; PH.spawned = true; PH.lastSup = PH.simT; JUMP.charging = false; JUMP.sink = 0; JUMP.push = 0; JUMP.blend = 0; JUMP.fly = 0; lastInp = inp; };
MM.headW = () => (lastInp ? lastInp.head.clone() : new V3(0, 1.6, 0)).add(rig.position);
MM.handsW = () => handsW.map(h => h.toArray());
MM.muteBtnW = () => { myHands[0].updateMatrixWorld(true); return muteBtn.getWorldPosition(new V3()).toArray(); };
MM.myHands = myHands; MM.BATT = BATT; MM.drawWrist = () => drawWrist(performance.now()); MM.wristShown = () => wrist.visible && muteBtn.visible; MM.skyColor = () => scene.background.getHexString(); MM.starsOp = () => (stars.visible ? starMat.opacity : 0); MM.stars = stars; MM.myArms = myArms; MM.HAND_DROP = HAND_DROP; MM.ARM = { L1: ARM_L1, L2: ARM_L2, SHOULDER, WRIST_LOCAL };
MM.setMute = setMute; MM.joinNet = joinNet; MM.startAudio = startAudio; MM.AU = AU; MM.startVoice = startVoice;
MM.renderInfo = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries });
MM.remoteList = () => [...NET.remotes.values()].map(r => ({ id: r.id, grip: r.avatar.grip, hands: r.hands.map(h => h.toArray()), name: r.name, tag: r.avatar.tag.userData.text, color: r.color, cos: r.avatar.cosKey, matColor: r.avatar.mat.color.getHexString(), visible: r.avatar.group.visible, head: r.headPos.toArray(), it: NET.infected.has(r.id), voice: !!r.voice, pannerPos: r.voice ? [r.voice.pn.positionX.value, r.voice.pn.positionY.value, r.voice.pn.positionZ.value] : null }));
MM.addTestRemote = (id, head, color) => { const r = ensureRemote(id); r.name = 'Test'; r.color = color || '#c87838'; r.samples = []; r.headPos.set(head[0], head[1], head[2]); r.hands[0].set(head[0] - 0.27, head[1] - 0.55, head[2] - 0.15); r.hands[1].set(head[0] + 0.27, head[1] - 0.55, head[2] - 0.15); r.avatar.group.visible = true; r.avatar.setColor(r.color); r.avatar.pose(r.headPos, new Q(), r.hands[0], r.hands[1]); return r.id; };
MM.moveTestRemote = (id, head) => { const r = NET.remotes.get(id); if (!r) return; r.samples = []; r.headPos.set(head[0], head[1], head[2]); r.hands[0].set(head[0] - 0.27, head[1] - 0.55, head[2] - 0.15); r.hands[1].set(head[0] + 0.27, head[1] - 0.55, head[2] - 0.15); r.avatar.group.visible = true; r.avatar.pose(r.headPos, new Q(), r.hands[0], r.hands[1]); };
MM.removeTestRemote = id => removeRemote(id);

// ---------- landing page / session ----------
const params = new URLSearchParams(location.search);
const roomDefault = cleanName(params.get('room') || LS('mm_room') || 'PUBLIC').toUpperCase().replace(/\s/g, '');
$('nameIn').value = ME.name; $('roomIn').value = roomDefault; $('roomCode').textContent = roomDefault;
$('roomIn').addEventListener('input', () => { $('roomCode').textContent = cleanName($('roomIn').value).toUpperCase().replace(/\s/g, '') || 'PUBLIC'; });
function readLanding() {
  ME.name = cleanName($('nameIn').value); LS('mm_name', ME.name); $('nameIn').value = ME.name;
  const code = cleanName($('roomIn').value).toUpperCase().replace(/\s/g, '') || 'PUBLIC'; LS('mm_room', code);
  VOICE.enabled = $('voiceIn').checked; return code;
}
function showLanding() { GAME.playing = false; $('landing').classList.remove('hidden'); $('hud').classList.remove('on'); $('hint').classList.remove('on'); PH.spawned = false; }
async function beginPlay(vr) {
  const code = readLanding(); startAudio();
  if (vr) {
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      await renderer.xr.setSession(session);
      session.addEventListener('end', showLanding);
    } catch (e) { $('note').textContent = 'Could not start VR: ' + (e.message || e); return; }
  } else { $('hud').classList.add('on'); $('hint').classList.add('on'); }
  $('landing').classList.add('hidden'); PH.spawned = false; GAME.playing = true; lastInp = null;
  if (NET.code !== code || !NET.room) joinNet(code); else if (NET.send) NET.send.info(myInfo());
  startVoice();
}
MM.beginPlay = beginPlay;
$('enterVR').onclick = () => beginPlay(true);
$('playDesk').onclick = () => beginPlay(false);
(async () => {
  let ok = false; try { ok = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch (e) { }
  const b = $('enterVR'); b.disabled = !ok; b.textContent = ok ? 'ENTER VR' : 'VR not available here';
  if (!ok) $('note').textContent = 'Open this link in the Meta Quest Browser to play in VR. You can try it here with mouse + keyboard.';
})();
const cv = renderer.domElement; let drag = null;
cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; if (GAME.playing && !renderer.xr.isPresenting && cv.requestPointerLock) { try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (err) { } } });
addEventListener('pointerup', () => drag = null);
addEventListener('pointermove', e => {
  if (!GAME.playing) return; let dx = 0, dy = 0;
  if (document.pointerLockElement === cv) { dx = e.movementX; dy = e.movementY; } else if (drag) { dx = e.clientX - drag.x; dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; } else return;
  DESK.yaw -= dx * 0.0035; DESK.pitch = clamp(DESK.pitch - dy * 0.0035, -1.4, 1.4);
});
addEventListener('keydown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  DESK.keys.add(e.code); if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyM' && GAME.playing) setMute(!VOICE.muted);
  if (MENU.open && /^Digit[1-6]$/.test(e.code)) menuDo(MENU_ITEMS[+e.code.slice(5) - 1].id);
  if (e.code === 'KeyL' && GAME.playing) labelsSet(!LABELS.on);
  if (e.code === 'Backquote') dbgSet(!DBG.on); // ` toggles the DEBUG overlay (test build)
  if (e.code === 'Escape' && GAME.playing && !renderer.xr.isPresenting) showLanding();
});
addEventListener('keyup', e => DESK.keys.delete(e.code));
addEventListener('blur', () => DESK.keys.clear());
setMute(false);


// ---------- mirror near spawn (Gorilla Tag style): see your own gorilla ----------
// Built last so the seeded world/animal layout above is unchanged. The local avatar lives on layer 5:
// the player's camera never sees it (first person), only the mirror's reflection camera does.
const MIRROR_LAYER = 5, MIRROR_RANGE = 14;
const MIRROR = { c: new V3(-5.2, 0, 0.6), w: 2.2, h: 2.4, bottom: 0.25 };
{
  const gy = terrainH(MIRROR.c.x, MIRROR.c.z); MIRROR.c.y = gy;
  const fr = new Merger(), cx = MIRROR.c.x, cz = MIRROR.c.z, y0 = gy + MIRROR.bottom, y1 = y0 + MIRROR.h, hw = MIRROR.w / 2 + 0.12;
  const A = (y, z) => new V3(cx - 0.05, y, cz + z);
  const logs = [[A(gy - 0.1, -hw), A(y1 + 0.25, -hw), 0.13], [A(gy - 0.1, hw), A(y1 + 0.25, hw), 0.13], [A(y1 + 0.12, -hw - 0.25), A(y1 + 0.12, hw + 0.25), 0.12], [A(y0 - 0.1, -hw), A(y0 - 0.1, hw), 0.1]];
  for (const [a, b, r] of logs) { cylAB(fr, a, b, r, r * 0.9, '#8b5a33', 6, 0); capColl(a, b, r, 'mirrorframe'); } // frame logs are climbable like branches
  fr.add(new THREE.BoxGeometry(0.06, MIRROR.h + 0.1, MIRROR.w + 0.1), '#3a2a1c', M4(new V3(cx - 0.09, y0 + MIRROR.h / 2, cz)), 0);
  for (const z of [-hw, hw]) fr.add(new THREE.IcosahedronGeometry(0.45, 0), '#4fbf3f', M4(new V3(cx - 0.05, y1 + 0.3, cz + z), null, new V3(1, 0.6, 1)), 0);
  fr.add(new THREE.IcosahedronGeometry(0.35, 0), '#ffe135', M4(new V3(cx - 0.05, y1 + 0.42, cz), null, new V3(1.2, 0.5, 0.5)), 0);
  const frame = new THREE.Mesh(fr.build(), worldMat); scene.add(frame);
  // the glass itself is smooth: a thin non-climbable collider so you can't walk through it
  addCol('mirror', p => sdBox(p, new V3(cx - 0.05, y0 + MIRROR.h / 2, cz), new V3(0.06, MIRROR.h / 2, MIRROR.w / 2)), new V3(cx, y0 + MIRROR.h / 2, cz), 2, false);
  const mirror = new Reflector(new THREE.PlaneGeometry(MIRROR.w, MIRROR.h), { textureWidth: 512, textureHeight: 560, color: 0xc8d0d8, multisample: 2, clipBias: 0.003 });
  mirror.position.set(cx, y0 + MIRROR.h / 2, cz); mirror.rotation.y = Math.PI / 2; // faces +x, toward the spawn point
  mirror.camera.layers.enable(MIRROR_LAYER); scene.add(mirror);
  MIRROR.mesh = mirror; MIRROR.normal = new V3(1, 0, 0);
  MIRROR.avatar = makeGorilla(ME.color, ME.name);
  MIRROR.avatar.group.traverse(o => o.layers.set(MIRROR_LAYER)); MIRROR.avatar.group.visible = false; // chest name tag reads reversed, like a real mirror
}
const _mp = new V3(), _mq = new Q();
function updateMirror() {
  camera.getWorldPosition(_mp);
  const toCam = _mp.clone().sub(MIRROR.mesh.position);
  const near = toCam.length() < MIRROR_RANGE && toCam.dot(MIRROR.normal) > 0.05;
  MIRROR.mesh.visible = near; // reflection pass only runs when close, in front, and (via frustum culling) on screen
  const nearShop = updateShopMirror(_mp);
  const av = MIRROR.avatar;
  av.group.visible = (near || nearShop) && GAME.playing;
  if (!av.group.visible) return;
  camera.getWorldQuaternion(_mq);
  const look = shopLook(); if (MM.mirrorTestColor) look.color = MM.mirrorTestColor; /* test hook: tint the reflection for pixel checks */ if (av.color.getHexString() !== new C3(look.color).getHexString()) av.setColor(look.color); av.setCos(look.cos);
  const it = NET.infected.has(NET.selfId); if (it !== av.it) av.apply(it);
  if (av.tag.userData.text !== ME.name) av.tag.userData.set(ME.name, av.it);
  av.setGrip(GRIP_BITS);
  av.pose(_mp, _mq, handsW[0], handsW[1], myHands[0].quaternion, myHands[1].quaternion);
}
MM.MIRROR = MIRROR; MM.MIRROR_LAYER = MIRROR_LAYER;

// ---------- cosmetics shop "MONKEY MART" on the walls of the lower waterfall cave ----------
// Bananas you pick up go into a persistent wallet (localStorage); the per-session banana count is unchanged.
// Touch an item to try it on (see it in the shop mirror), press the big button to BUY / EQUIP / take off.
// Built last, without the seeded rnd, so the world layout above is unchanged. No new colliders: the cave climbs as before.
const COS = [
  { id: 'party', slot: 'hat', name: 'Party Hat', price: 5 },
  { id: 'shades', slot: 'face', name: 'Sunglasses', price: 10 },
  { id: 'lei', slot: 'body', name: 'Flower Lei', price: 15 },
  { id: 'bananahat', slot: 'hat', name: 'Banana Hat', price: 25 },
  { id: 'scarf', slot: 'body', name: 'Scarf', price: 30 },
  { id: 'goggles', slot: 'face', name: 'Goggles', price: 40 },
  { id: 'propeller', slot: 'hat', name: 'Propeller Cap', price: 60 },
  { id: 'tophat', slot: 'hat', name: 'Top Hat', price: 90 },
  { id: 'chain', slot: 'body', name: 'Gold Chain', price: 120 },
  { id: 'crown', slot: 'hat', name: 'Crown', price: 200 },
];
const FURS = [
  { id: 'fur-charcoal', name: 'Charcoal', color: '#34343a', price: 0 }, { id: 'fur-brown', name: 'Brown', color: '#6b4226', price: 5 },
  { id: 'fur-red', name: 'Red', color: '#b8322a', price: 10 }, { id: 'fur-blue', name: 'Blue', color: '#2f5fd0', price: 10 },
  { id: 'fur-green', name: 'Green', color: '#2f9a45', price: 15 }, { id: 'fur-purple', name: 'Purple', color: '#7a3fc0', price: 20 },
  { id: 'fur-pink', name: 'Pink', color: '#e0609a', price: 20 }, { id: 'fur-gold', name: 'Golden', color: '#d9a520', price: 40 },
];
FURS.forEach(f => { f.slot = 'fur'; });
const COS_BY = Object.fromEntries([...COS, ...FURS].map(i => [i.id, i]));
function cleanCos(c) { const o = {}; if (c && typeof c === 'object') for (const sl of ['hat', 'face', 'body']) { const it = COS_BY[c[sl]]; if (it && it.slot === sl) o[sl] = it.id; } return o; }
const COS_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }); // shared by every cosmetic on every gorilla + the shop display
const COS_GEO = (() => {
  const G = {}, mk = (seed, f) => { const b = new GorillaBuilder(); b.h = seed; f(b); return b.build(); };
  const cyl = (rt, rb, h, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const RX = (a) => new Q().setFromAxisAngle(new V3(1, 0, 0), a);
  const seg = (b, a, c, r, col) => { const d = c.clone().sub(a); b.add(cyl(r, r, d.length(), 5, true), col, M4(a.clone().add(c).multiplyScalar(0.5), qFromTo(UP, d)), 1, 0); };
  // head-local (gorilla head: top ~0.26 m above the eyes, face front ~ -0.22 m z); body-local (torso centre, neck ~0.3 m up)
  G.party = mk(11, b => { b.add(new THREE.ConeGeometry(0.09, 0.26, 8), '#ff4fa3', M4(new V3(0, 0.34, 0.01)), 1, 0.06); b.add(cyl(0.062, 0.072, 0.035, 8, true), '#ffe14a', M4(new V3(0, 0.3, 0.01)), 1, 0); b.add(new THREE.IcosahedronGeometry(0.032, 0), '#5fd0ff', M4(new V3(0, 0.475, 0.01)), 1, 0); });
  G.crown = mk(12, b => {
    b.add(cyl(0.125, 0.115, 0.085, 8, true), '#ffc928', M4(new V3(0, 0.245, 0.01)), 1, 0.05);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.add(new THREE.ConeGeometry(0.024, 0.065, 4), '#ffd84a', M4(new V3(Math.sin(a) * 0.12, 0.318, 0.01 + Math.cos(a) * 0.12)), 1, 0.05); }
    b.add(new THREE.DodecahedronGeometry(0.026, 0), '#e8203a', M4(new V3(0, 0.245, -0.118)), 1, 0); for (const sx of [-1, 1]) b.add(new THREE.DodecahedronGeometry(0.02, 0), '#2a7bff', M4(new V3(sx * 0.118, 0.245, 0.01)), 1, 0);
  });
  G.bananahat = mk(13, b => { b.add(new THREE.TorusGeometry(0.2, 0.045, 6, 12, Math.PI * 0.85).rotateZ(Math.PI * 0.075), '#ffd93a', M4(new V3(0, 0.105, 0.0)), 1, 0.05); for (const sx of [-1, 1]) b.add(new THREE.DodecahedronGeometry(0.03, 0), '#6b4a1a', M4(new V3(sx * 0.19, 0.152, 0)), 1, 0); });
  G.tophat = mk(14, b => { b.add(cyl(0.19, 0.19, 0.02, 14), '#18181b', M4(new V3(0, 0.215, 0.01)), 1, 0.03); b.add(cyl(0.12, 0.125, 0.22, 14), '#18181b', M4(new V3(0, 0.33, 0.01)), 1, 0.04); b.add(cyl(0.128, 0.128, 0.04, 14, true), '#c8283a', M4(new V3(0, 0.245, 0.01)), 1, 0); });
  G.propeller = mk(15, b => {
    ['#e8303a', '#ffd93a', '#2f6fe0', '#2fae4a'].forEach((c, i) => b.add(new THREE.SphereGeometry(0.165, 4, 3, i * Math.PI / 2, Math.PI / 2, 0, Math.PI / 2), c, M4(new V3(0, 0.13, 0.01), null, new V3(1, 0.9, 1)), 1, 0.03));
    b.add(new THREE.BoxGeometry(0.17, 0.014, 0.11), '#e8303a', M4(new V3(0, 0.2, -0.19), RX(0.25)), 1, 0); b.add(cyl(0.008, 0.008, 0.07, 5), '#888888', M4(new V3(0, 0.3, 0.01)), 1, 0);
    b.add(new THREE.BoxGeometry(0.32, 0.012, 0.045), '#ffd93a', M4(new V3(0, 0.337, 0.01), new Q().setFromAxisAngle(UP, 0.4)), 1, 0);
  });
  G.shades = mk(16, b => { for (const sx of [-1, 1]) { b.add(new THREE.BoxGeometry(0.09, 0.055, 0.016), '#121214', M4(new V3(sx * 0.068, 0.03, -0.232)), 1, 0); b.add(new THREE.BoxGeometry(0.03, 0.012, 0.004), '#8fb8ff', M4(new V3(sx * 0.068 - 0.02, 0.045, -0.241)), 1, 0); b.add(new THREE.BoxGeometry(0.012, 0.012, 0.2), '#121214', M4(new V3(sx * 0.218, 0.04, -0.13)), 1, 0); } b.add(new THREE.BoxGeometry(0.05, 0.012, 0.012), '#121214', M4(new V3(0, 0.045, -0.232)), 1, 0); });
  G.goggles = mk(17, b => { for (const sx of [-1, 1]) { b.add(cyl(0.052, 0.052, 0.045, 10), '#7a4a22', M4(new V3(sx * 0.07, 0.035, -0.222), RX(Math.PI / 2)), 1, 0.04); b.add(cyl(0.04, 0.04, 0.05, 10), '#5fd0ff', M4(new V3(sx * 0.07, 0.035, -0.226), RX(Math.PI / 2)), 1, 0); } b.add(new THREE.TorusGeometry(0.229, 0.016, 4, 18).rotateX(Math.PI / 2), '#5a3418', M4(new V3(0, 0.035, 0.02)), 1, 0.04); });
  G.scarf = mk(18, b => { b.add(new THREE.TorusGeometry(0.26, 0.06, 6, 12).rotateX(Math.PI / 2), '#d8323a', M4(new V3(0, 0.3, -0.01), null, new V3(1, 1, 0.88)), 1, 0.06); b.add(new THREE.BoxGeometry(0.1, 0.26, 0.045), '#d8323a', M4(new V3(0.12, 0.17, -0.285), new Q().setFromEuler(new THREE.Euler(-0.2, 0, 0.12))), 1, 0.04); b.add(new THREE.BoxGeometry(0.104, 0.03, 0.05), '#ffffff', M4(new V3(0.125, 0.12, -0.292), new Q().setFromEuler(new THREE.Euler(-0.2, 0, 0.12))), 1, 0); });
  G.lei = mk(19, b => { const cols = ['#ff5fa8', '#ffe14a', '#ffffff', '#ff8a2a']; for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, c = Math.cos(a); b.add(new THREE.DodecahedronGeometry(0.045, 0), cols[i % 4], M4(new V3(Math.sin(a) * 0.28, 0.31 - 0.14 * Math.max(0, c), -c * 0.26 - 0.03 * Math.max(0, c))), 1, 0.05); } });
  G.chain = mk(20, b => {
    const g = '#ffcf30', P = [new V3(-0.2, 0.31, -0.17), new V3(-0.12, 0.21, -0.34), new V3(0, 0.12, -0.385), new V3(0.12, 0.21, -0.34), new V3(0.2, 0.31, -0.17)];
    for (let i = 0; i < P.length - 1; i++) seg(b, P[i], P[i + 1], 0.016, g);
    b.add(new THREE.TorusGeometry(0.2, 0.016, 4, 10, Math.PI).rotateX(-Math.PI / 2), g, M4(new V3(0, 0.31, -0.17)), 1, 0);
    b.add(cyl(0.058, 0.058, 0.018, 10), g, M4(new V3(0, 0.1, -0.39), RX(Math.PI / 2)), 1, 0.03); b.add(new THREE.TorusGeometry(0.025, 0.009, 4, 8, Math.PI * 0.8), '#ffe14a', M4(new V3(0, 0.1, -0.402)), 1, 0);
  });
  return G;
})();

const LSJ = (k, d) => { try { const v = JSON.parse(LS(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
const SHOP = {
  cave: CAVES[0], wallet: Math.max(0, LSJ('mm_wallet', 0) | 0), owned: new Set(LSJ('mm_owned', []).filter(id => COS_BY[id])),
  eq: Object.assign({ hat: null, face: null, body: null, fur: 'fur-charcoal' }, LSJ('mm_equipped', {})),
  sel: null, msg: '', touch: [null, null], btnTouch: [false, false], btnT: 0, spots: [], near: false,
};
for (const sl of ['hat', 'face', 'body']) if (SHOP.eq[sl] && !(SHOP.owned.has(SHOP.eq[sl]) && COS_BY[SHOP.eq[sl]].slot === sl)) SHOP.eq[sl] = null;
if (!COS_BY[SHOP.eq.fur] || !(COS_BY[SHOP.eq.fur].price === 0 || SHOP.owned.has(SHOP.eq.fur))) SHOP.eq.fur = 'fur-charcoal';
const isOwned = it => it.price === 0 || SHOP.owned.has(it.id);
const isWorn = it => SHOP.eq[it.slot] === it.id;
function shopCos() { return cleanCos(SHOP.eq); }
function shopLook() { // what your own gorilla shows: equipped items, plus a try-on preview of a selected item you don't own yet
  const look = { color: COS_BY[SHOP.eq.fur].color, cos: shopCos() }, it = SHOP.sel && COS_BY[SHOP.sel];
  if (it && !isOwned(it)) { if (it.slot === 'fur') look.color = it.color; else look.cos[it.slot] = it.id; }
  return look;
}
function shopSave() { LS('mm_wallet', String(SHOP.wallet)); LS('mm_owned', JSON.stringify([...SHOP.owned])); LS('mm_equipped', JSON.stringify(SHOP.eq)); }
function shopEarn(n) { SHOP.wallet += n; LS('mm_wallet', String(SHOP.wallet)); shopDirty = true; }
function shopLookChanged() {
  ME.color = COS_BY[SHOP.eq.fur].color;
  if (!NET.infected.has(NET.selfId)) handMat.color.set(shopLook().color);
  shopDirty = true;
}
function shopSelect(id) { if (!COS_BY[id]) return; SHOP.sel = id; SHOP.msg = ''; sfx('tap', 1); shopLookChanged(); }
function shopPress() {
  const it = SHOP.sel && COS_BY[SHOP.sel];
  if (!it) { SHOP.msg = 'Touch an item first'; shopDirty = true; return 'none'; }
  let r;
  if (!isOwned(it)) {
    if (SHOP.wallet < it.price) { SHOP.msg = 'Need ' + (it.price - SHOP.wallet) + ' more bananas'; shopDirty = true; return 'poor'; }
    SHOP.wallet -= it.price; SHOP.owned.add(it.id); SHOP.eq[it.slot] = it.id; SHOP.msg = 'Bought ' + it.name + '!'; sfx('banana'); r = 'bought';
  } else if (isWorn(it)) {
    if (it.slot === 'fur') { SHOP.msg = 'Already wearing ' + it.name; shopDirty = true; return 'worn'; }
    SHOP.eq[it.slot] = null; SHOP.msg = 'Took off ' + it.name; r = 'unequipped';
  } else { SHOP.eq[it.slot] = it.id; SHOP.msg = 'Wearing ' + it.name; r = 'equipped'; }
  sfx('round'); shopSave(); shopLookChanged();
  if (NET.send) { NET.lastInfo = performance.now(); NET.send.info(myInfo()); } // others see the change right away
  return r;
}
let shopDirty = true;
function drawBananaIcon(x, cx, cy, r) { x.save(); x.strokeStyle = '#e8b800'; x.lineWidth = r * 0.55; x.lineCap = 'round'; x.beginPath(); x.arc(cx, cy - r * 0.55, r, Math.PI * 0.2, Math.PI * 0.8); x.stroke(); x.strokeStyle = '#ffe14a'; x.lineWidth = r * 0.3; x.stroke(); x.fillStyle = '#5a3a10'; x.fillRect(cx + r * 0.75, cy - r * 0.05, r * 0.22, r * 0.22); x.restore(); }

// ----- shop build: display wall (back), fur colour board (left), mirror + panel + big button (right), lanterns, sign
const SHOP_G = new THREE.Group(); scene.add(SHOP_G);
{
  const k = SHOP.cave, zb = k.c.z - k.h.z, xl = k.c.x - k.h.x, xr = k.c.x + k.h.x, fl = k.floor;
  SHOP.c = new V3(k.c.x, fl + 1.2, k.c.z);
  const st = new GorillaBuilder(), glow = new GorillaBuilder(); st.h = 4321; glow.h = 99;
  const ROT = (x, y, z) => new Q().setFromEuler(new THREE.Euler(x, y, z));
  // back wall plank board + shelves; items face out of the wall (+z)
  st.add(new THREE.BoxGeometry(2.9, 1.95, 0.04), '#8a5a32', M4(new V3(k.c.x, fl + 1.12, zb + 0.02)), 1, 0.06);
  for (const y of [fl + 0.62, fl + 1.42]) st.add(new THREE.BoxGeometry(2.86, 0.05, 0.05), '#6b4423', M4(new V3(k.c.x, y, zb + 0.06)), 1, 0.04);
  const rows = [['party', 'bananahat', 'propeller', 'tophat', 'crown'], ['shades', 'goggles', 'lei', 'scarf', 'chain']];
  const tagCells = []; // [itemId, centre, normal-yaw]
  rows.forEach((row, ri) => row.forEach((id, ci) => {
    const x = k.c.x - 1.1 + ci * 0.55, it = COS_BY[id], g = COS_GEO[id]; g.computeBoundingBox(); const bb = g.boundingBox, ctr = bb.getCenter(new V3()), sz = bb.getSize(new V3());
    const body = it.slot === 'body', s = body ? 0.78 : 1, y = ri === 0 ? fl + 1.55 + sz.y * 0.5 * s - 0.1 : fl + 0.92;
    const anchor = new V3(x, y, zb + 0.2);
    const m = new THREE.Matrix4().compose(anchor, body ? ROT(-1.15, Math.PI, 0) : ROT(0, Math.PI, 0), new V3(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-ctr.x, -ctr.y, -ctr.z));
    const gg = g.clone(); gg.applyMatrix4(m); const p = gg.attributes.position.array, n = gg.attributes.normal.array, c = gg.attributes.color.array;
    for (let i = 0; i < p.length; i++) { st.p.push(p[i]); st.n.push(n[i]); st.c.push(c[i]); } for (let i = 0; i < p.length / 3; i++) st.f.push(1); gg.dispose();
    if (ri === 0) st.add(new THREE.BoxGeometry(0.42, 0.03, 0.26), '#6b4423', M4(new V3(x, y - sz.y * 0.5 - 0.015, zb + 0.15)), 1, 0.05); // little shelf
    else st.add(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 5), '#3a2a1c', M4(new V3(x, y + 0.02, zb + 0.1), ROT(Math.PI / 2, 0, 0)), 1, 0); // peg
    SHOP.spots.push({ id, p: anchor.clone() });
    tagCells.push([id, new V3(x, ri === 0 ? fl + 1.3 : fl + 0.5, zb + 0.05), 0]);
  }));
  // fur colour board on the left wall (faces +x)
  st.add(new THREE.BoxGeometry(0.04, 1.25, 2.15), '#8a5a32', M4(new V3(xl + 0.02, fl + 1.02, k.c.z - 0.6)), 1, 0.06);
  FURS.forEach((f, i) => {
    const z = k.c.z - 1.35 + (i % 4) * 0.5, y = i < 4 ? fl + 1.38 : fl + 0.83;
    st.add(new THREE.BoxGeometry(0.05, 0.27, 0.27), '#3a2a1c', M4(new V3(xl + 0.05, y, z)), 1, 0);
    st.add(new THREE.BoxGeometry(0.04, 0.23, 0.23), f.color, M4(new V3(xl + 0.08, y, z)), 1, 0.03);
    SHOP.spots.push({ id: f.id, p: new V3(xl + 0.16, y, z) });
    tagCells.push([f.id, new V3(xl + 0.045, y - 0.215, z), Math.PI / 2]);
  });
  // right wall: shop mirror frame, panel board, big button
  const mz = k.c.z - 0.95, bz = k.c.z + 0.4;
  st.add(new THREE.BoxGeometry(0.06, 1.12, 0.9), '#6b4423', M4(new V3(xr - 0.03, fl + 1.1, mz)), 1, 0.05);
  st.add(new THREE.BoxGeometry(0.05, 0.5, 0.82), '#6b4423', M4(new V3(xr - 0.025, fl + 1.7, bz)), 1, 0.05);
  st.add(new THREE.CylinderGeometry(0.17, 0.19, 0.06, 12), '#3a2a1c', M4(new V3(xr - 0.03, fl + 1.02, bz), ROT(0, 0, Math.PI / 2)), 1, 0);
  // lanterns (back corners) + torches either side of the entrance outside
  const lamps = [new V3(xl + 0.28, fl + 2.05, zb + 0.22), new V3(xr - 0.28, fl + 2.05, zb + 0.22)];
  for (const L of lamps) { st.add(new THREE.BoxGeometry(0.16, 0.03, 0.16), '#2a2018', M4(L.clone().add(new V3(0, 0.13, 0))), 1, 0); st.add(new THREE.BoxGeometry(0.16, 0.03, 0.16), '#2a2018', M4(L.clone().add(new V3(0, -0.13, 0))), 1, 0); glow.add(new THREE.BoxGeometry(0.12, 0.23, 0.12), '#ffb347', M4(L), 1, 0.05); glow.add(new THREE.OctahedronGeometry(0.05, 0), '#fff2a0', M4(L), 1, 0); }
  for (const sx of [-1, 1]) {
    const T = new V3(k.c.x + sx * (CAVE_ARCH.hw + 0.9), fl + 1.2, -HALF + 0.18);
    st.add(new THREE.CylinderGeometry(0.035, 0.03, 0.5, 5), '#5a3a1e', M4(T, ROT(0.35, 0, 0)), 1, 0);
    glow.add(new THREE.OctahedronGeometry(0.09, 0), '#ff8a2a', M4(T.clone().add(new V3(0, 0.3, 0.09)), null, new V3(1, 1.5, 1)), 1, 0); glow.add(new THREE.OctahedronGeometry(0.05, 0), '#ffe680', M4(T.clone().add(new V3(0, 0.33, 0.11)), null, new V3(1, 1.4, 1)), 1, 0);
  }
  const stMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x3a2610, side: THREE.DoubleSide }); // warm lantern-lit look without a real light
  SHOP_G.add(new THREE.Mesh(st.build(), stMat), new THREE.Mesh(glow.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
  // price tags: one canvas atlas, one mesh
  const TC = document.createElement('canvas'); TC.width = 512; TC.height = 512; const ttex = new THREE.CanvasTexture(TC); ttex.colorSpace = THREE.SRGBColorSpace;
  const TW = 0.27, TH = 0.085, cols = 4, cw = 128, ch = 512 / 5, pos = [], uv = [];
  tagCells.forEach(([id, c, yaw], i) => {
    const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch, u0 = cx / 512, u1 = (cx + cw) / 512, v1 = 1 - cy / 512, v0 = 1 - (cy + ch) / 512;
    const q = new Q().setFromAxisAngle(UP, yaw), P = (dx, dy) => new V3(dx, dy, 0).applyQuaternion(q).add(c);
    const a = P(-TW / 2, -TH / 2), b = P(TW / 2, -TH / 2), d = P(TW / 2, TH / 2), e = P(-TW / 2, TH / 2);
    pos.push(...a.toArray(), ...b.toArray(), ...d.toArray(), ...a.toArray(), ...d.toArray(), ...e.toArray()); uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  });
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  SHOP_G.add(new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ map: ttex, fog: false })));
  SHOP.drawTags = () => {
    const x = TC.getContext('2d');
    tagCells.forEach(([id], i) => {
      const it = COS_BY[id], cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch, sel = SHOP.sel === id;
      x.fillStyle = sel ? '#ffe680' : '#f3e2b8'; x.fillRect(cx + 2, cy + 2, cw - 4, ch - 4); x.strokeStyle = '#5a3a1e'; x.lineWidth = 4; x.strokeRect(cx + 4, cy + 4, cw - 8, ch - 8);
      x.fillStyle = '#3a2410'; x.textAlign = 'center'; x.font = 'bold 19px system-ui,sans-serif'; x.fillText(it.name, cx + cw / 2, cy + 36);
      const worn = isWorn(it), own = isOwned(it);
      x.font = 'bold 30px system-ui,sans-serif'; x.fillStyle = worn ? '#1f8f3a' : own ? '#2a5aa8' : '#7a4a00';
      if (worn || own) x.fillText(worn ? 'WORN' : it.price ? 'OWNED' : 'FREE', cx + cw / 2, cy + 78);
      else { const t = String(it.price), w = x.measureText(t).width; x.fillText(t, cx + cw / 2 - 14, cy + 78); drawBananaIcon(x, cx + cw / 2 - 14 + w / 2 + 18, cy + 70, 13); }
    });
    ttex.needsUpdate = true;
  };
  // panel above the big button
  const PC = document.createElement('canvas'); PC.width = 512; PC.height = 300; const ptex = new THREE.CanvasTexture(PC); ptex.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.445), new THREE.MeshBasicMaterial({ map: ptex, fog: false }));
  panel.position.set(xr - 0.055, fl + 1.7, bz); panel.rotation.y = -Math.PI / 2; SHOP_G.add(panel);
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.1, 14), new THREE.MeshBasicMaterial({ color: 0x33cc55, fog: false }));
  btn.position.set(xr - 0.1, fl + 1.02, bz); btn.rotation.z = Math.PI / 2; SHOP_G.add(btn);
  SHOP.btnP = new V3(xr - 0.18, fl + 1.02, bz); SHOP.btn = btn;
  SHOP.drawPanel = () => {
    const x = PC.getContext('2d'), it = SHOP.sel && COS_BY[SHOP.sel];
    x.fillStyle = '#2a1a0c'; x.fillRect(0, 0, 512, 300); x.strokeStyle = '#ffcf30'; x.lineWidth = 8; x.strokeRect(6, 6, 500, 288);
    x.textAlign = 'center'; x.fillStyle = '#ffcf30'; x.font = 'bold 44px system-ui,sans-serif'; x.fillText('MONKEY MART', 256, 58);
    x.fillStyle = '#ffe680'; x.font = 'bold 34px system-ui,sans-serif'; x.fillText('Wallet: ' + SHOP.wallet + ' bananas', 256, 110);
    let act = 'Touch an item to try it on', col = '#cccccc';
    if (it) {
      x.fillStyle = '#ffffff'; x.font = 'bold 36px system-ui,sans-serif'; x.fillText(it.name + (isOwned(it) ? '' : '  -  ' + it.price + ' bananas'), 256, 165);
      if (!isOwned(it)) { const ok = SHOP.wallet >= it.price; act = ok ? 'Press button to BUY' : 'Need ' + (it.price - SHOP.wallet) + ' more bananas'; col = ok ? '#66ff88' : '#ff7777'; }
      else if (isWorn(it)) { act = it.slot === 'fur' ? 'EQUIPPED' : 'EQUIPPED - press to take off'; col = '#66ff88'; }
      else { act = 'Press button to EQUIP'; col = '#66ccff'; }
    }
    x.fillStyle = col; x.font = 'bold 30px system-ui,sans-serif'; x.fillText(act, 256, 220);
    if (SHOP.msg) { x.fillStyle = '#ffcf30'; x.font = '26px system-ui,sans-serif'; x.fillText(SHOP.msg, 256, 268); }
    ptex.needsUpdate = true;
    const can = it && (isOwned(it) ? !(isWorn(it) && it.slot === 'fur') : SHOP.wallet >= it.price);
    btn.material.color.set(can ? 0x33cc55 : it ? 0x995544 : 0x777777);
  };
  // small shop mirror on the right wall (renders only when you are in the cave, facing it)
  const sm = new Reflector(new THREE.PlaneGeometry(0.8, 1.02), { textureWidth: 256, textureHeight: 320, color: 0xc8d0d8, multisample: 0, clipBias: 0.003 });
  sm.position.set(xr - 0.065, fl + 1.1, mz); sm.rotation.y = -Math.PI / 2; sm.camera.layers.enable(MIRROR_LAYER); sm.visible = false; SHOP_G.add(sm);
  SHOP.mirror = sm; SHOP.mirrorN = new V3(-1, 0, 0);
  // "MONKEY MART" sign above the cave entrance (outside, always visible)
  const SC = document.createElement('canvas'); SC.width = 512; SC.height = 128; const sx2 = SC.getContext('2d');
  sx2.fillStyle = '#6b4423'; sx2.fillRect(0, 0, 512, 128); sx2.strokeStyle = '#ffcf30'; sx2.lineWidth = 10; sx2.strokeRect(5, 5, 502, 118);
  sx2.fillStyle = '#ffe14a'; sx2.font = 'bold 66px system-ui,sans-serif'; sx2.textAlign = 'center'; sx2.textBaseline = 'middle'; sx2.fillText('MONKEY MART', 256, 68); drawBananaIcon(sx2, 40, 70, 20); drawBananaIcon(sx2, 472, 70, 20);
  const stex = new THREE.CanvasTexture(SC); stex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.475), new THREE.MeshBasicMaterial({ map: stex }));
  sign.position.set(k.c.x, fl + CAVE_ARCH.wallH + CAVE_ARCH.hw + 0.95, -HALF + 0.48); scene.add(sign); SHOP.sign = sign;
}
function updateShopMirror(camPos) {
  const toCam = _sp.copy(camPos).sub(SHOP.mirror.position);
  const near = SHOP_G.visible && toCam.length() < 5 && toCam.dot(SHOP.mirrorN) > 0.05;
  SHOP.mirror.visible = near; return near;
}
const _sp = new V3();
function shopTick(now, headW) {
  const d = headW.distanceTo(SHOP.c);
  SHOP_G.visible = d < 18; // details only render when you're near the cave
  SHOP.near = d < 4.5;
  if (!SHOP.near) { if (SHOP.sel && d > 8) { SHOP.sel = null; SHOP.msg = ''; shopLookChanged(); } SHOP.touch[0] = SHOP.touch[1] = null; SHOP.btnTouch[0] = SHOP.btnTouch[1] = false; }
  else for (let i = 0; i < 2; i++) {
    const h = handsW[i]; let hit = null;
    for (const s of SHOP.spots) if (h.distanceTo(s.p) < 0.15) { hit = s.id; break; }
    if (hit && hit !== SHOP.touch[i]) shopSelect(hit);
    SHOP.touch[i] = hit;
    const onBtn = h.distanceTo(SHOP.btnP) < 0.17;
    if (onBtn && !SHOP.btnTouch[i] && now - SHOP.btnT > 450) { SHOP.btnT = now; shopPress(); }
    SHOP.btnTouch[i] = onBtn;
  }
  if (shopDirty && SHOP_G.visible) { shopDirty = false; SHOP.drawTags(); SHOP.drawPanel(); }
}
shopLookChanged(); SHOP.drawTags(); SHOP.drawPanel();
MM.SHOP = SHOP; MM.COS = COS; MM.FURS = FURS; MM.shopPress = shopPress; MM.shopSelect = shopSelect; MM.shopLook = shopLook; MM.shopCos = shopCos;
MM.handMat = handMat; MM.LAVA = LAVA; MM.SHOP_G = SHOP_G; MM.shopTick = shopTick;
MM.shopSetWallet = n => { SHOP.wallet = n; shopSave(); shopDirty = true; };

// ---------- cave system build (test build): rendered only when near, like the shop ----------
// Own seeded noise (not rnd), so nothing above changes. Rock is flat-shaded vertex-coloured, double-sided (you see it from inside).
const cxHash = (i, j, s) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 982451653)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function cxNoise(x, y, s = 1) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const a = cxHash(i, j, s), b = cxHash(i + 1, j, s), c = cxHash(i, j + 1, s), d = cxHash(i + 1, j + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
const cxFbm = (x, y, s = 1) => 0.55 * cxNoise(x / 9, y / 9, s) + 0.3 * cxNoise(x / 3.5, y / 3.5, s + 7) + 0.15 * cxNoise(x / 1.3, y / 1.3, s + 13);
class CxB {
  constructor(seed) { this.p = []; this.c = []; this.h = seed; }
  rnd() { this.h = (this.h * 16807) % 2147483647; return this.h / 2147483647; }
  add(geo, color, m, vary = 0.08, colorFn) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); geo.dispose(); if (m) g.applyMatrix4(m);
    const p = g.attributes.position.array; this.tri(p, color, vary, colorFn); g.dispose(); return this;
  }
  tri(p, color, vary = 0.08, colorFn) {
    const base = new C3(color), cc = new C3();
    for (let i = 0; i < p.length; i += 9) {
      if (colorFn) cc.set(colorFn((p[i] + p[i + 3] + p[i + 6]) / 3, (p[i + 1] + p[i + 4] + p[i + 7]) / 3, (p[i + 2] + p[i + 5] + p[i + 8]) / 3)); else cc.copy(base);
      const k = 1 + (this.rnd() - 0.5) * 2 * vary; for (let j = 0; j < 3; j++) this.c.push(cc.r * k, cc.g * k, cc.b * k);
    }
    for (const v of p) this.p.push(v);
  }
  grid(nu, nv, pos, color, vary, colorFn, skip) { // pos(i, j) -> V3 for i<=nu, j<=nv
    const P = []; for (let i = 0; i <= nu; i++) { P.push([]); for (let j = 0; j <= nv; j++) P[i].push(pos(i, j)); }
    const out = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      if (skip && skip(i, j)) continue;
      const a = P[i][j], b = P[i + 1][j], c = P[i + 1][j + 1], d = P[i][j + 1];
      out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    }
    this.tri(out, color, vary, colorFn); return this;
  }
  build() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.computeVertexNormals(); g.computeBoundingSphere(); return g; }
}
const cxMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
// inside the mountain the fog always fades to BLACK (never to the sky colour), so the caves read dark from any distance at any time of day
const cxMatIn = cxMat.clone(); cxMatIn.customProgramCacheKey = () => 'cxMatIn-blackfog';
cxMatIn.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', '#ifdef USE_FOG\n#ifdef FOG_EXP2\nfloat fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );\n#else\nfloat fogFactor = smoothstep( fogNear, fogFar, vFogDepth );\n#endif\ngl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.0 ), fogFactor );\n#endif'); };
const CXG = { in: new THREE.Group(), rt: new THREE.Group(), out: new THREE.Group(), top: new THREE.Group() }; // cave + chasm | chamber + side tunnel | cliff | shaft + mountain-top clearing
for (const g of Object.values(CXG)) { g.visible = false; scene.add(g); }
const ROCK_C = '#4d443c', ROCK_F = '#57493d', CLIFF = '#b9b3a9';
function archProfile(hw, wallH, n = 9) { const pr = [[-hw, 0], [-hw, wallH * 0.5], [-hw, wallH]]; for (let i = 1; i < n; i++) { const t = Math.PI - Math.PI * i / n; pr.push([hw * Math.cos(t), wallH + hw * Math.sin(t)]); } pr.push([hw, wallH], [hw, wallH * 0.5], [hw, 0]); return pr; }
function archTube(b, a, alongX, len0, len1, segs) { // rounded-roof tunnel; jitter pushes rock outward only a little so the collider matches
  const pr = archProfile(a.hw, a.wallH);
  const pos = (i, j) => {
    const [u, v] = pr[i], s = len0 + (len1 - len0) * j / segs, n = v > a.wallH ? new THREE.Vector2(u, v - a.wallH).normalize() : new THREE.Vector2(Math.sign(u), 0);
    const end = j === 0 || j === segs ? 0 : 1, e = (v === 0 ? 0 : 0.14 * cxNoise(i * 1.7, s * 1.3, 5)) * end;
    return alongX ? new V3(s, CXF + v + n.y * e, a.z - u - n.x * e) : new V3(a.x + u + n.x * e, CXF + v + n.y * e, s);
  };
  b.grid(pr.length - 1, segs, pos, ROCK_C, 0.12);
  // floor
  b.grid(1, segs, (i, j) => { const s = len0 + (len1 - len0) * j / segs, u = i ? a.hw : -a.hw; return alongX ? new V3(s, CXF, a.z - u) : new V3(a.x + u, CXF, s); }, ROCK_F, 0.08);
}
function archPortal(b, cu, cv0, w, h, a, place) { // flat plate with an arch-shaped hole; place(u, v) -> V3
  const sh = new THREE.Shape(); sh.moveTo(cu - w / 2, cv0); sh.lineTo(cu + w / 2, cv0); sh.lineTo(cu + w / 2, cv0 + h); sh.lineTo(cu - w / 2, cv0 + h); sh.closePath();
  const hole = new THREE.Path(), pr = archProfile(a.hw, a.wallH, 12); hole.moveTo(cu + pr[0][0], cv0 + pr[0][1]); for (const [u, v] of pr.slice(1)) hole.lineTo(cu + u, cv0 + v); hole.closePath(); sh.holes.push(hole);
  const g = new THREE.ShapeGeometry(sh).toNonIndexed(), p = g.attributes.position.array, out = [];
  for (let i = 0; i < p.length; i += 3) { const v = place(p[i], p[i + 1]); out.push(v.x, v.y, v.z); }
  b.tri(out, ROCK_C, 0.1); g.dispose();
}
{
  // ===== tunnel + big domed cave + chasm pillars (CXG.in) =====
  const b = new CxB(4242), t = CX.tun;
  archTube(b, t, false, t.vz0 + 0.02, t.vz1, 6);
  archPortal(b, t.x, CXF, CAVE_ARCH.hw * 2 + 0.5, CAVE_ARCH.wallH + CAVE_ARCH.hw + 0.35, t, (u, v) => new V3(u, v, t.vz0 + 0.01)); // seals the alcove back wall around the tunnel mouth
  const dc = CX.dome.c, dr = CX.dome.r;
  { // dome: upper half ellipsoid, open toward the chasm, hole where the tunnel comes in
    const g = new THREE.SphereGeometry(1, 30, 13, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed(), p = g.attributes.position.array, out = [];
    for (let i = 0; i < p.length; i += 3) { const x = p[i], y = p[i + 1], z = p[i + 2], e = y < 0.02 ? 0 : 0.05 * cxFbm((x + 2) * 3.4, (z + 2) * 3.4 + y * 2.5, 9); p[i] = dc.x + x * dr.x * (1 + e); p[i + 1] = dc.y + y * dr.y * (1 + e); p[i + 2] = dc.z + z * dr.z * (1 + e); }
    for (let i = 0; i < p.length; i += 9) {
      const cx = (p[i] + p[i + 3] + p[i + 6]) / 3, cy = (p[i + 1] + p[i + 4] + p[i + 7]) / 3, cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
      if (cz < CX.ledgeZ - 0.4) continue;                                                    // open side: the drop into the dark
      if (Math.abs(cx - t.x) < t.hw + 0.35 && cy < CXF + t.wallH + t.hw + 0.4 && cz > t.vz1 - 1.5) continue; // tunnel mouth
      if (cy > CXF + 5.2 && Math.hypot(cx - CX.SHAFT.c.x, cz - CX.SHAFT.c.z) < CX.SHAFT.r + 0.22) continue; // ceiling shaft
      for (let k = 0; k < 9; k++) out.push(p[i + k]);
    }
    b.tri(out, ROCK_C, 0.12, (x, y) => { const n = cxNoise(x * 0.7, y * 0.55, 19); return y > CXF + 5.5 ? (n > 0.62 ? '#2e2823' : '#3c342e') : n > 0.7 ? '#3a332c' : n < 0.22 ? '#5a5046' : ROCK_C; }); g.dispose();
  }
  { // floor: the ellipse cut off at the ledge
    const T = Math.acos((CX.ledgeZ - dc.z) / dr.z), sh = new THREE.Shape();
    for (let i = 0; i <= 28; i++) { const a = -T + 2 * T * i / 28, x = dc.x + dr.x * Math.sin(a), z = dc.z + dr.z * Math.cos(a); if (i) sh.lineTo(x, -z); else sh.moveTo(x, -z); }
    sh.closePath(); b.add(new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), ROCK_F, M4(new V3(0, CXF, 0)), 0.1, (x, y, z) => z < CX.ledgeZ + CX.slipRun ? '#4a4a50' : ROCK_F); // smooth dark rock near the edge
    const hx = dr.x * Math.sqrt(1 - ((CX.ledgeZ - dc.z) / dr.z) ** 2) + 0.4;
    b.grid(8, 10, (i, j) => new V3(dc.x - hx + 2 * hx * i / 8, CXF - 30 * (j / 10) ** 1.5, CX.ledgeZ - (j ? 0.32 * cxNoise(i * 2.3, j * 1.9, 3) : 0)), ROCK_C, 0.1); // ledge face, dropping away
  }
  // a brighter pool of daylight on the floor under the shaft (the rest of the cave stays dark)
  b.add(new THREE.CircleGeometry(2.4, 14).rotateX(-Math.PI / 2), '#c8b889', M4(new V3(CX.SHAFT.c.x, CXF + 0.015, CX.SHAFT.c.z)), 0.04);
  // stalagmites around the walls, a few out of the way (never on the slick strip or the walk path)
  for (let i = 0; i < 13; i++) { const a = 0.4 + i * 0.45, r = 0.82 + 0.12 * cxNoise(i, 1, 2); const x = dc.x + dr.x * r * Math.sin(a + 1.2), z = dc.z + dr.z * r * Math.cos(a + 1.2); if (z < CX.ledgeZ + 2.2 || z > t.vz1 - 2) continue; const h = 0.55 + 1.35 * cxNoise(i, 4, 2); b.add(new THREE.ConeGeometry(0.2 + 0.12 * h, h, 5), '#5a5048', M4(new V3(x, CXF + h / 2, z))); }
  // stalactites hanging from the dome, kept above head height and off the ledge
  for (let i = 0; i < 16; i++) {
    const a = i * 0.41 + 0.15, r = 0.4 + 0.45 * cxNoise(i, 3, 8);
    const x = dc.x + dr.x * r * Math.sin(a), z = dc.z + dr.z * r * Math.cos(a);
    if (z < CX.ledgeZ + 2.4 || z > t.vz1 - 1.2) continue;
    if (Math.hypot(x - CX.SHAFT.c.x, z - CX.SHAFT.c.z) < CX.SHAFT.r + 0.7) continue; // keep the shaft opening clear
    const h = 0.45 + 1.1 * cxNoise(i, 6, 8), rr0 = 0.1 + 0.08 * h;
    const y1 = dc.y + dr.y * Math.sqrt(Math.max(0.15, 1 - r * r)) - 0.15, y0 = Math.max(y1 - h, CXF + 2.3);
    if (y0 >= y1 - 0.2) continue;
    b.add(new THREE.ConeGeometry(rr0, y1 - y0, 5), '#4a433c', M4(new V3(x, (y0 + y1) / 2, z), EUL(Math.PI, 0, 0)));
  }
  // a few ceiling drips in the arrival tunnel (high, so they never block walking)
  for (let i = 0; i < 4; i++) {
    const z = t.vz0 - 1.1 - i * 1.35, h = 0.18 + 0.12 * cxNoise(i, 9, 11);
    b.add(new THREE.ConeGeometry(0.07, h, 5), '#3f3934', M4(new V3(t.x + (i % 2 ? 0.25 : -0.2), CXF + t.wallH + t.hw - h / 2 - 0.05, z), EUL(Math.PI, 0, 0)));
  }
  // pillars rising out of the dark, tops level with the ledge
  for (const pc of CX.pillars) {
    const g = new THREE.CylinderGeometry(CX.PR, CX.PR * 1.4, 60, 9, 10, true).toNonIndexed(), p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) { const y = p[i + 1]; if (y < 29.9) { const a = Math.atan2(p[i + 2], p[i]), e = 1 + 0.12 * cxNoise(a * 2.5 + 3, y * 0.4, 21); p[i] *= e; p[i + 2] *= e; } }
    b.add(g, '#5c544c', M4(new V3(pc.x, CXF - 30, pc.z)), 0.12, (x, y) => y < CXF - 22 ? '#3f3a34' : (cxNoise(x * 1.4, y * 0.25, 21) > 0.72 ? '#4a453e' : '#5c544c'));
    b.add(new THREE.CircleGeometry(CX.PR, 9).rotateX(-Math.PI / 2), '#b3a894', M4(new V3(pc.x, CXF + 0.004, pc.z)), 0.1);
    addCol('rock', p => { const dxz = Math.hypot(p.x - pc.x, p.z - pc.z) - CX.PR * (1 + 0.4 * clamp((CXF - p.y) / 60, 0, 1)), dy = Math.max(p.y - CXF, CXF - 60 - p.y); return Math.min(Math.max(dxz, dy), 0) + Math.hypot(Math.max(dxz, 0), Math.max(dy, 0)); }, new V3(pc.x, CXF - 30, pc.z), 31, true, { cave: 'pillar' }); // rock like any other: walk on the top, grab the sides and climb back up (radius follows the mesh's taper; no lip at the top edge)
  }
  const m = new THREE.Mesh(b.build(), cxMatIn); CXG.in.add(m); CX.inTris = m.geometry.attributes.position.count / 3;
  // glowing crystals so the big cave reads
  const gb = new CxB(77);
  for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.3, x = dc.x + dr.x * 0.9 * Math.sin(a), z = dc.z + dr.z * 0.88 * Math.cos(a); if (z < CX.ledgeZ + 1.5 || z > t.vz1 - 1.5) continue; for (let k = 0; k < 3; k++) gb.add(new THREE.OctahedronGeometry(0.12 + 0.06 * k, 0).scale(0.6, 1.8, 0.6), i % 2 ? '#7fe8ff' : '#c49bff', M4(new V3(x + 0.15 * (k - 1), CXF + 0.25 + 0.05 * k, z), EUL(0.2 * (k - 1), 0, 0.25 * (k - 1))), 0.1); }
  CXG.in.add(new THREE.Mesh(gb.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
}
{
  // ===== ledge chamber after the 3rd pillar + the 4 m side tunnel to the right (CXG.rt) =====
  const b = new CxB(5151), e = CX.end, x0 = e.c.x - e.h.x, x1 = e.c.x + e.h.x, z0 = CX.endEdge, z1 = e.c.z - e.h.z, yt = CXF + e.h.y * 2;
  const jit = (i, j, s) => 0.12 * cxNoise(i * 1.9, j * 2.1, s);
  b.grid(8, 6, (i, j) => new V3(x0 + (x1 - x0) * i / 8, CXF, z0 + (z1 - z0) * j / 6), ROCK_F, 0.08);                              // floor
  b.grid(8, 6, (i, j) => new V3(x0 + (x1 - x0) * i / 8, yt + jit(i, j, 1), z0 + (z1 - z0) * j / 6), ROCK_C, 0.12);             // ceiling
  b.grid(8, 5, (i, j) => new V3(x0 + (x1 - x0) * i / 8, CXF + (yt - CXF) * j / 5, z1 - (j ? jit(i, j, 2) : 0)), ROCK_C, 0.12); // back wall
  b.grid(6, 5, (i, j) => new V3(x0 - (j ? jit(i, j, 3) : 0), CXF + (yt - CXF) * j / 5, z0 + (z1 - z0) * i / 6), ROCK_C, 0.12); // left wall
  archPortal(b, -CX.rt.z, CXF, z0 - z1, yt - CXF, CX.rt, (u, v) => new V3(x1, v, -u));                                            // right wall with the tunnel
  b.grid(10, 8, (i, j) => new V3(-3.6 + 13.2 * i / 10, CXF - 30 * (j / 8) ** 1.5, CX.endEdge + (j ? 0.3 * cxNoise(i * 2.1, j, 4) : 0)), ROCK_C, 0.1); // ledge face below
  b.grid(8, 3, (i, j) => new V3(-3.6 + 13.2 * i / 8, CXF + 7 * j / 3, CX.endEdge - 0.05), ROCK_C, 0.12, null, (i, j) => j < 2 && i >= 3 && i < 5); // rock around the chamber opening
  archTube(b, CX.rt, true, CX.rt.vx0 - 0.01, CX.rt.vx1, 6);
  // stalactites along the chamber sides and a couple in the exit tunnel — clear of the landing and the vine later
  for (let i = 0; i < 8; i++) {
    const x = i < 4 ? x0 + 0.45 + 0.35 * (i % 2) : x1 - 0.45 - 0.35 * (i % 2);
    const z = z0 + 0.8 + (z1 - z0 - 1.4) * ((i % 4) + 0.3) / 4, h = 0.35 + 0.5 * cxNoise(i, 7, 15);
    b.add(new THREE.ConeGeometry(0.1 + 0.05 * h, h, 5), '#4a433c', M4(new V3(x, yt - h / 2 - 0.05, z), EUL(Math.PI, 0, 0)));
  }
  for (let i = 0; i < 3; i++) {
    const x = CX.rt.vx0 + 0.8 + i * 1.0, h = 0.2 + 0.12 * cxNoise(i, 8, 17);
    b.add(new THREE.ConeGeometry(0.07, h, 5), '#3f3934', M4(new V3(x, CXF + CX.rt.wallH + CX.rt.hw - h / 2 - 0.05, CX.rt.z + (i % 2 ? 0.2 : -0.18)), EUL(Math.PI, 0, 0)));
  }
  const m = new THREE.Mesh(b.build(), cxMatIn); CXG.rt.add(m);
  // pitch-black shell around the chasm + chamber: looking into the void from anywhere (cave, tunnel, cliff mouth) shows black, never sky
  const vb = new CxB(1), X0 = CX.chasm.c.x - CX.chasm.h.x - 0.1, X1 = CX.chasm.c.x + CX.chasm.h.x + 0.1, Y0 = CXF - 61, Y1 = CXF + 7.2, Z0 = CX.ledgeZ, Z1 = z1 - 0.7;
  const q = (a, b, c, d) => vb.tri([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z], '#000000', 0);
  q(new V3(X0, Y0, Z0), new V3(X0, Y1, Z0), new V3(X0, Y1, Z1), new V3(X0, Y0, Z1));                       // left side
  q(new V3(X0, Y1, Z0), new V3(X1, Y1, Z0), new V3(X1, Y1, Z1), new V3(X0, Y1, Z1));                       // top
  q(new V3(X0, Y0, Z0), new V3(X1, Y0, Z0), new V3(X1, Y0, Z1), new V3(X0, Y0, Z1));                       // bottom
  q(new V3(X0, Y0, Z1), new V3(X1, Y0, Z1), new V3(X1, Y1, Z1), new V3(X0, Y1, Z1));                       // far end
  const rz0 = CX.rt.z - CX.rt.hw - 0.1, rz1 = CX.rt.z + CX.rt.hw + 0.1, ry1 = CXF + CX.rt.wallH + CX.rt.hw + 0.1; // right side, with the side tunnel through it
  q(new V3(X1, Y0, Z0), new V3(X1, Y1, Z0), new V3(X1, Y1, rz1), new V3(X1, Y0, rz1));
  q(new V3(X1, Y0, rz0), new V3(X1, Y1, rz0), new V3(X1, Y1, Z1), new V3(X1, Y0, Z1));
  q(new V3(X1, Y0, rz1), new V3(X1, CXF - 0.05, rz1), new V3(X1, CXF - 0.05, rz0), new V3(X1, Y0, rz0));
  q(new V3(X1, ry1, rz1), new V3(X1, Y1, rz1), new V3(X1, Y1, rz0), new V3(X1, ry1, rz0));
  CXG.rt.add(new THREE.Mesh(vb.build(), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, side: THREE.DoubleSide })));
}
{
  // ===== outside: the cliff (very tall), ledges, overhang + vine, ocean far below (CXG.out) =====
  const b = new CxB(6161), FZ = CX.faceZ, FX = CX.faceX, TOP = 230, BOT = CX.ocean - 5;
  const ys = []; for (let i = 24; i >= 1; i--) ys.push(CXF - (CXF - BOT) * (i / 24) ** 2); ys.push(CXF - 0.2); for (let i = 0; i <= 18; i++) ys.push(CXF + 2.7 + (TOP - CXF - 2.7) * (i / 18) ** 2);
  const cliffCol = (x, y) => {
    if (y < CX.ocean + 25) return '#8a8378';
    if (y > CXF + 120) return '#c9c4bb';
    const band = Math.sin(y * 0.07 + 0.45 * cxNoise((x || 0) * 0.04, y * 0.04, 41));
    return band > 0.6 ? '#8a8278' : band < -0.55 ? '#6a655c' : CLIFF;
  };
  // face A: runs off to the LEFT of the exit (along +x), the rock mass is behind it (-z)
  const xs = []; for (let j = 0; j <= 56; j++) xs.push(FX + 1300 * (j / 56) ** 2.3);
  const ampA = (x, y) => Math.min(1, (x - FX) / 3) * Math.min(26, 0.3 + 0.06 * Math.max(0, Math.hypot(x - 18, (y - CXF) * 0.8) - 10));
  b.grid(xs.length - 1, ys.length - 1, (j, i) => { const x = xs[j], y = ys[i]; return new V3(x, y, FZ - 0.00008 * (x - FX) ** 2 - ampA(x, y) * cxFbm(x, y, 31)); }, CLIFF, 0.1, cliffCol);
  // face B: the mountain side you come out of (x = 10), with the cave mouth in it; extends to your right/behind
  const zs = [FZ, FZ + 1, FZ + 2, FZ + 3]; for (let j = 1; j <= 40; j++) zs.push(FZ + 3 + 330 * (j / 40) ** 2.2);
  const iMouth = ys.indexOf(CXF - 0.2);
  const ampB = (z, y) => Math.min(1, (z - FZ) / 3) * Math.min(26, 0.25 + 0.06 * Math.max(0, Math.hypot(z - CX.rt.z, y - CXF) - 6));
  b.grid(zs.length - 1, ys.length - 1, (j, i) => { const z = zs[j], y = ys[i]; return new V3(FX - 0.00008 * (z - FZ) ** 2 - ampB(z, y) * cxFbm(z + 500, y, 37), y, z); }, CLIFF, 0.1, cliffCol, (j, i) => j < 3 && i === iMouth);
  archPortal(b, -CX.rt.z, CXF - 0.2, 3.0, 2.9, CX.rt, (u, v) => new V3(FX + 0.01, v < CXF ? CXF : v, -u)); // cave mouth rim
  // mouth lip, ledges, overhang (all stick out of face A)
  const slab = (c, h, col) => { b.add(new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2), col, M4(c), 0.1); b.add(new THREE.ConeGeometry(Math.min(h.x, h.z) * 1.2, 1.0, 4, 1).rotateY(Math.PI / 4), col, M4(new V3(c.x, c.y - h.y - 0.45, c.z), EUL(Math.PI, 0, 0), new V3(h.x / Math.min(h.x, h.z), 1, h.z / Math.min(h.x, h.z))), 0.1); };
  slab(CX.lip.c, CX.lip.h, '#9d968b');
  for (const l of CX.ledges) slab(l.c, l.h, l.long ? '#a49c90' : '#aaa296');
  b.add(new THREE.DodecahedronGeometry(1, 0), '#9a9387', M4(CX.overhang.c, null, CX.overhang.h.clone().multiplyScalar(1.15)), 0.1);
  // embedded boulders and shallow shelves on the cliff, kept clear of the lip, ledges, jump path and vine
  for (let i = 0; i < 18; i++) {
    const u = cxNoise(i, 1, 61), v = cxNoise(i, 2, 61);
    const x = FX + 10 + 90 * u, y = BOT + 8 + (TOP - BOT - 16) * v;
    if (x < 32 && y > CXF - 8 && y < CXF + 14) continue; // gameplay band
    const s = 1.3 + 2.4 * cxNoise(i, 3, 61);
    const z = FZ - 0.00008 * (x - FX) ** 2 - ampA(x, y) * cxFbm(x, y, 31) + 0.35;
    b.add(new THREE.DodecahedronGeometry(1, 0), i % 3 ? '#8a8378' : '#756f66', M4(new V3(x, y, z), null, new V3(s, s * 0.7, s * 0.85)), 0.12);
  }
  for (let i = 0; i < 6; i++) {
    const x = FX + 36 + i * 14, y = CXF - 18 - (i % 3) * 16;
    const z = FZ - 0.00008 * (x - FX) ** 2 - ampA(x, y) * cxFbm(x, y, 31) + 0.2;
    b.add(new THREE.BoxGeometry(1, 1, 1), '#7a746c', M4(new V3(x, y, z), null, new V3(5.5 + i, 0.45, 1.6)), 0.06);
  }
  for (const bx of [CX.lip, ...CX.ledges, CX.overhang]) addCol('rock', p => sdBox(p, bx.c, bx.h), bx.c, bx.h.length() + 0.1, true, { cave: 'ledge' });
  const m = new THREE.Mesh(b.build(), cxMat); CXG.out.add(m); CX.outTris = m.geometry.attributes.position.count / 3;
  // ocean is the always-on oceanWorld (covers the exit cliff and the south/west drops; one plane, no z-fight)
}
// ===== shaft + mountain-top clearing (CXG.top); local RNG so jungle trees/bananas stay put =====
{
  const rng = (() => { let x = 20261121; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; })();
  const rrL = (a, b) => a + rng() * (b - a);
  const rocks = ['#7d6a58', '#8a7663', '#6f5f50', '#958068', '#6a5848', '#82705e'];
  const greens = ['#5cbf4a', '#4fae40', '#69c957', '#58b84a', '#3fae3a'];
  const leafC2 = ['#3fae3a', '#5ccc3f', '#2f9a3a', '#7ad94a'];
  const Y = CX.CLR_Y, sc = CX.SHAFT.c, sr = CX.SHAFT.r;
  const topM = new Merger();
  const cylABR = (mg, a, b, r0, r1, color, seg, vary) => {
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
    mg.add(g, color, M4(a.clone().add(b).multiplyScalar(0.5), qFromTo(UP, d)), vary, null, rng);
  };
  // grass plateau with a hole for the shaft
  {
    const nx = 26, nz = 16, x0 = -HALF + 0.15, x1 = HALF - 0.15, z0 = -51.2, z1 = -HALF - 0.2;
    const posOf = (i, j) => {
      const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz;
      const e = (rng() - 0.5) * 0.06;
      return new V3(x, Y + e, z);
    };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = posOf(i, j), b = posOf(i + 1, j), c = posOf(i, j + 1), d = posOf(i + 1, j + 1);
      const mid = new V3((a.x + d.x) / 2, Y, (a.z + d.z) / 2);
      if (Math.hypot(mid.x - sc.x, mid.z - sc.z) < sr + 0.35) continue; // shaft hole
      const col = (mid.x < -6 || mid.z < -47) ? '#4a8a38' : greens[(rng() * 5) | 0];
      const tri = (p, q, r) => topM.add(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z], 3)), col, null, 0.04, null, rng);
      tri(a, b, c); tri(b, d, c);
    }
  }
  // shaft tube (rock lining) from the dome ceiling up to the clearing, hole already cut in the dome mesh
  {
    const y0 = CX.SHAFT.y0 - 0.05, y1 = Y + 0.02, h = y1 - y0;
    const tube = new THREE.CylinderGeometry(sr + 0.08, sr + 0.08, h, 12, 1, true);
    topM.add(tube, '#5a5046', M4(new V3(sc.x, (y0 + y1) / 2, sc.z)), 0.08, null, rng);
    // a slightly raised stone rim around the hole
    topM.add(new THREE.TorusGeometry(sr + 0.22, 0.12, 6, 14), '#6a5c50', M4(new V3(sc.x, Y + 0.04, sc.z), new Q().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))), 0.06, null, rng);
  }
  // the vine's tree at the rim (west-ish, so the vine hangs in the shaft centre)
  {
    const tx = sc.x - 1.15, tz = sc.z - 0.15, th = 3.4;
    const base = new V3(tx, Y - 0.2, tz), top = new V3(tx, Y + th, tz);
    cylABR(topM, base, top, 0.28, 0.18, '#7a4f2c', 7, 0.05);
    capColl(base, top, 0.26, 'trunk', 0.18);
    topM.add(new THREE.IcosahedronGeometry(1.5, 0), leafC2[(rng() * 4) | 0], M4(top.clone().add(new V3(0, 0.5, 0)), null, new V3(1.15, 0.7, 1.15)), 0.1, null, rng);
    topM.add(new THREE.IcosahedronGeometry(1.0, 0), leafC2[(rng() * 4) | 0], M4(top.clone().add(new V3(-0.5, 0.9, 0.3)), null, new V3(1, 0.7, 1)), 0.1, null, rng);
    // a branch over the shaft the vine hangs from
    const ba = new V3(tx, Y + 2.9, tz), bb = new V3(sc.x, Y + 2.5, sc.z);
    cylABR(topM, ba, bb, 0.12, 0.08, '#8b5a33', 5, 0.05);
    capColl(ba, bb, 0.11, 'branch', 0.08);
  }
  // trees to the left (west, -X) and north (-Z), thickening to a solid tree wall
  const clrTrees = [];
  const plantTree = (x, z, r, h, wall) => {
    const base = new V3(x, Y - 0.25, z), top = new V3(x, Y + h, z);
    cylABR(topM, base, top, r * 1.1, r * 0.65, '#7a4f2c', 6, 0.05);
    capColl(base, top, r * 1.05, 'trunk', r * 0.68);
    topM.add(new THREE.IcosahedronGeometry(r * 2.6, 0), leafC2[(rng() * 4) | 0], M4(top.clone().add(new V3(0, 0.5, 0)), null, new V3(1.15, 0.7, 1.15)), 0.1, null, rng);
    topM.add(new THREE.IcosahedronGeometry(r * 1.7, 0), leafC2[(rng() * 4) | 0], M4(top.clone().add(new V3(rrL(-1.1, 1.1), 1.1, rrL(-1.1, 1.1))), null, new V3(1, 0.7, 1)), 0.1, null, rng);
    clrTrees.push({ x, z, r, h, wall });
  };
  // west thicket, denser toward x = -22
  for (let i = 0; i < 16; i++) {
    const x = -8 - rng() * 15, z = -28 - rng() * 22;
    if (Math.hypot(x - sc.x, z - sc.z) < 4.5) continue;
    if (x < -HALF + 0.8 || z > -HALF - 0.8 || z < -51) continue;
    plantTree(x, z, 0.45 + rng() * 0.35, 3.2 + rng() * 2.4, x < -16);
  }
  // north thicket, denser toward z = -50
  for (let i = 0; i < 14; i++) {
    const x = -18 + rng() * 36, z = -47 - rng() * 4;
    if (Math.hypot(x - sc.x, z - sc.z) < 4.5) continue;
    if (x > 20) continue; // leave the NE open so the exit ledges stay visible
    plantTree(x, z, 0.5 + rng() * 0.3, 3.4 + rng() * 2.2, z < -49);
  }
  // impassable tree wall along the west and north rims
  const wallPts = [];
  for (let z = -28; z > -51; z -= 1.35) wallPts.push([-22.6, z]);
  for (let x = -22; x < 16; x += 1.4) wallPts.push([x, -50.4]);
  for (const [x, z] of wallPts) {
    if (Math.hypot(x - sc.x, z - sc.z) < 5) continue;
    plantTree(x + rrL(-0.3, 0.3), z + rrL(-0.25, 0.25), 0.7, 4.2 + rng() * 1.2, true);
  }
  CXG.top.add(new THREE.Mesh(topM.build(), worldMat));
  // cheap daylight shaft: one spot + an unlit cone (culled with the group)
  const spot = new THREE.SpotLight(0xfff2c4, 3.4, 16, 0.32, 0.55, 1.1);
  spot.position.set(sc.x, Y + 0.6, sc.z); spot.target.position.set(sc.x, CXF, sc.z);
  CXG.top.add(spot); CXG.top.add(spot.target); CX.shaftLight = spot;
  const coneH = Y - CXF, cone = new THREE.Mesh(
    new THREE.ConeGeometry(2.5, coneH, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide, fog: false })
  );
  cone.position.set(sc.x, CXF + coneH / 2, sc.z); cone.rotation.x = Math.PI; CXG.top.add(cone);
  scene.add(CXG.top);
  // walkable clearing (hole at the shaft) + shaft walls
  addCol('ground', p => {
    if (p.y < Y - 0.5 || !inClrXZ(p) || inShaftXZ(p, 0.02)) return 50; // thin plateau only — the cave underneath must stay hollow
    return (p.y - Y) * 0.95;
  }, new V3(0, Y, -38), 16, true, { clr: true });
  addCol('shaft', p => {
    if (p.y < CX.SHAFT.y0 - 0.3 || p.y > Y + 0.25) return 99;
    return CX.SHAFT.r - Math.hypot(p.x - sc.x, p.z - sc.z);
  }, new V3(sc.x, (CX.SHAFT.y0 + Y) / 2, sc.z), 4, false);
  CX.clrTrees = clrTrees;
}

// wall cave (cave 2, right of the waterfall) lined in fog-free near-black: one inside-out box (floor, ceiling, sides, back; no front face),
// so every sightline into the opening, from any angle or distance, ends on black. Its back face plugs the tunnel only while the tunnel is culled.
const CAVE2_DARK = (() => {
  const k = CAVES[1], back = k.c.z - k.h.z, front = -HALF, e = 0.012;
  const lin = new THREE.MeshBasicMaterial({ color: 0x050506, fog: false, side: THREE.DoubleSide });
  const plugMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, side: THREE.DoubleSide });
  const pack = (...geos) => { // one mesh / one draw for the lining, floor and collar
    const pos = [];
    for (const g of geos) { const gg = g.index ? g.toNonIndexed() : g, a = gg.attributes.position.array; for (const v of a) pos.push(v); if (gg !== g) gg.dispose(); g.dispose(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  };
  const tube = makeArchTubeGeo(front + 0.32, back - 0.01, 6, e); // lining reaches the front of the stone frame so the soffit reads black from every angle
  tube.applyMatrix4(new THREE.Matrix4().makeTranslation(k.c.x, k.floor, 0));
  const floor = new THREE.PlaneGeometry(CAVE_ARCH.hw * 2 - 2 * e, (front - back) - 0.03).rotateX(-Math.PI / 2);
  floor.applyMatrix4(new THREE.Matrix4().makeTranslation(k.c.x, k.floor + e, (front + back) / 2));
  const W = CAVE_ARCH.hw + 2.6, H0 = 1.8, H1 = CAVE_ARCH.wallH + CAVE_ARCH.hw + 2.4, sh = new THREE.Shape();
  sh.moveTo(-W, -H0); sh.lineTo(W, -H0); sh.lineTo(W, H1); sh.lineTo(-W, H1); sh.lineTo(-W, -H0);
  const hole = new THREE.Path(), pr = caveArchProf(14);
  hole.moveTo(pr[0][0], pr[0][1]); for (const [u, v] of pr.slice(1)) hole.lineTo(u, v); hole.closePath(); sh.holes.push(hole);
  const collarG = new THREE.ShapeGeometry(sh);
  collarG.applyMatrix4(new THREE.Matrix4().makeTranslation(k.c.x, k.floor, front - 0.05));
  const m = new THREE.Mesh(pack(tube, floor, collarG), lin); m.renderOrder = -1; scene.add(m);
  const plugMesh = new THREE.Mesh(makeArchCapGeo(14, e), plugMat);
  plugMesh.position.set(k.c.x, k.floor, back); plugMesh.renderOrder = -1; scene.add(plugMesh);
  return { mesh: m, plug: plugMesh, collar: m, plugMat };
})();
// zone fog: jungle -> dim tunnel -> dark cave -> pitch-black chasm (each pillar barely visible from the one before) -> daylight cliff
const FOG_CAVE = new C3('#07080b'), FOG_CHASM = new C3('#000000'), _fc = new C3();
const FOGS = { base: [18, 75], cave: [3, 24], chasm: [0.5, 5.8], out: [220, 2700] };
const CX_MOUTH = new V3(CX.tun.x, CXF + 1.2, CX.tun.vz0);
let JUNGLE = null; const _hid = new Set();
const CX_STATE = { zone: 'jungle', dark: 0 };
// ---------- numbered labels (test build): off by default, zero cost when off (no updates, hidden) ----------
const LABELS_KEY = 'mmcave_labels';
const LABELS = { on: LS(LABELS_KEY) === '1', group: new THREE.Group(), items: [], ready: false };
LABELS.group.visible = false; scene.add(LABELS.group);
function labelsMake() {
  if (LABELS.ready) return;
  const list = [
    [1, 'Wall 1', new V3(0, 8, -24.15)],
    [2, 'Wall 2', new V3(24.15, 8, 0)],
    [3, 'Wall 3', new V3(0, -8, 25.6)],
    [4, 'Wall 4', new V3(-25.6, -8, 0)],
    [5, 'Shop cave', CAVES[0].c.clone().add(new V3(0, 1.2, 0.6))],
    [6, 'Parkour cave', CAVES[1].c.clone().add(new V3(0, 1.4, 0.6))],
    [7, 'Tunnel', new V3(3, CXF + 2.2, -31)],
    [8, 'Wide cave', new V3(3, CXF + 3.2, -42.3)],
    [9, 'First ledge', new V3(3, CXF + 2.0, CX.ledgeZ + 1.2)],
    [10, 'Pillar 1', CX.pillars[0].clone().add(new V3(0, 2.0, 0))],
    [11, 'Pillar 2', CX.pillars[1].clone().add(new V3(0, 2.0, 0))],
    [12, 'Pillar 3', CX.pillars[2].clone().add(new V3(0, 2.0, 0))],
    [13, 'Pillar 4', CX.pillars[3].clone().add(new V3(0, 2.0, 0))],
    [14, 'Chamber', new V3(3, CXF + 2.2, -72)],
    [15, 'Exit tunnel', new V3(8, CXF + 2.0, -72)],
    [16, 'Cliff lip', CX.lip.c.clone().add(new V3(0, 2.0, 0.4))],
    [17, 'Cliff ledge 1', CX.ledges[0].c.clone().add(new V3(0, 1.6, 0.3))],
    [18, 'Cliff ledge 2', CX.ledges[1].c.clone().add(new V3(0, 1.6, 0.3))],
    [19, 'Long ledge', CX.ledges[2].c.clone().add(new V3(0, 1.6, 0.3))],
    [20, 'Cliff vine', CX.vine.top.clone().add(new V3(0, -2.2, 0.5))],
    [21, 'Shaft', new V3(3, 14.0, -42.3)],
    [22, 'Shaft vine', new V3(3, 10.4, -42.3)],
    [23, 'Top clearing', new V3(6.2, CX.CLR_Y + 2.2, -39.5)],
    [24, 'Spawn clearing', new V3(0, 3.2, 4)],
  ];
  LABELS.list = list.map(([n, name]) => ({ n, name }));
  for (const [n, name, pos] of list) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
    const x = cv.getContext('2d');
    x.clearRect(0, 0, 256, 96);
    x.fillStyle = 'rgba(6,14,10,0.78)'; x.beginPath(); x.roundRect(4, 8, 248, 80, 12); x.fill();
    x.strokeStyle = '#ffd23f'; x.lineWidth = 3; x.stroke();
    x.fillStyle = '#ffd23f'; x.font = 'bold 44px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(n), 48, 48);
    x.fillStyle = '#f4fff4'; x.font = 'bold 28px system-ui,sans-serif';
    x.fillText(name, 156, 48);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.43), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    m.position.copy(pos); m.renderOrder = 6; m.userData = { n, name };
    LABELS.group.add(m); LABELS.items.push(m);
  }
  LABELS.ready = true; LABELS.group.visible = !!LABELS.on;
}
function labelsSet(on, save = true) {
  on = !!on; LABELS.on = on; if (save) LS(LABELS_KEY, on ? '1' : '0');
  if (on) labelsMake();
  LABELS.group.visible = on;
  if (MENU.open) menuDraw();
}
function labelsTick(cam) { // billboard only while on — skipped entirely when off
  if (!LABELS.on || !LABELS.ready) return;
  const q = cam.quaternion;
  for (const m of LABELS.items) m.quaternion.copy(q);
}
MM.LABELS = LABELS; MM.labelsSet = labelsSet; MM.LABELS_KEY = LABELS_KEY;
if (LABELS.on) labelsMake();

function updateCave(h) {
  if (!JUNGLE) { const keep = new Set([rig, hemi, sunLight, sunLight.target, sun, moon, stars, vineMesh, vineLeaf, CXG.in, CXG.rt, CXG.out, CXG.top, oceanWorld, LABELS.group, ...myHands, ...myArms.flatMap(a => [a.u, a.f])]); JUNGLE = scene.children.filter(o => !keep.has(o) && !o.isLight); }
  const x = h.x, z = h.z, sky = scene.fog.color; let n = FOGS.base[0], f = FOGS.base[1], dark = 0, zone = 'jungle';
  _fc.copy(sky);
  const mix = (c, nf, t) => { _fc.lerp(c, t); n += (nf[0] - n) * t; f += (nf[1] - f) * t; };
  const set = (c, nf) => { _fc.copy(c); n = nf[0]; f = nf[1]; };
  const onTop = h.y > CX.CLR_Y - 0.9 && z < -HALF - 0.1;
  const inShaftNow = inShaftXZ(h, 0.15) && h.y > CXF + 5 && h.y < CX.CLR_Y + 3;
  const inside = !onTop && !inShaftNow && z < CX.tun.vz0 && x > -22 && x < CX.faceX + 0.8;
  if (onTop) { zone = 'clearing'; n = 22; f = 90; }
  else if (inShaftNow) { zone = 'shaft'; set(FOG_CAVE, FOGS.cave); mix(sky, FOGS.base, 0.45); dark = 0.4; }
  else if (!inside && !(x >= CX.faceX + 0.8 && z < -49)) { /* jungle */ }
  else if (x >= CX.faceX + 0.8) { zone = 'out'; n = FOGS.out[0]; f = FOGS.out[1]; }
  else if (z > CX.tun.vz1) { zone = 'tunnel'; const t = sm((CX.tun.vz0 - z) / (CX.tun.vz0 - CX.tun.vz1)); mix(FOG_CAVE, FOGS.cave, t); dark = t; }
  else if (z > CX.ledgeZ + 4) { zone = 'cave'; set(FOG_CAVE, FOGS.cave); dark = 1; }
  else if (z > CX.ledgeZ) { zone = 'ledge'; set(FOG_CAVE, FOGS.cave); mix(FOG_CHASM, FOGS.chasm, sm((CX.ledgeZ + 4 - z) / 3)); dark = 1; } // fully pitch-black fog from 1 m before the edge
  else if (x < 7.4) { zone = z < CX.endEdge ? 'end' : 'chasm'; set(FOG_CHASM, FOGS.chasm); dark = 1; }
  else { zone = 'sidetunnel'; const t = sm((x - 7.4) / (CX.faceX + 0.8 - 7.4)); set(FOG_CHASM, FOGS.chasm); _fc.lerp(sky, t); n += (FOGS.out[0] - n) * t * t; f += (FOGS.out[1] - f) * t * t * t; dark = 1 - t; }
  sky.copy(_fc); scene.fog.near = n; scene.fog.far = f; CX_STATE.zone = zone; CX_STATE.dark = dark;
  if (dark > 0.25) { stars.visible = false; sun.visible = false; moon.visible = false; }
  // culling: each part only when you're near it
  CXG.in.visible = h.distanceTo(CX_MOUTH) < 18 || (inside && z > CX.endEdge - 1 && x < 7.6) || (onTop && inShaftXZ(h, 8));
  CXG.rt.visible = CXG.in.visible || (z < -58 && x > -6 && x < 80);
  CAVE2_DARK.plug.visible = !CXG.in.visible; // tunnel culled: black back wall instead of seeing through to the sky
  CXG.out.visible = (z < -64 && x > 2) || (x > CX.faceX - 1 && z < -49) || (onTop && x > 4 && z < -36);
  CXG.top.visible = onTop || inShaftNow || (z < -28 && z > -55 && Math.abs(x - 3) < 12 && h.y > CXF - 1) || (h.y > 10 && z < -16);
  if (CX.shaftLight) CX.shaftLight.intensity = CXG.top.visible || CXG.in.visible ? 3.4 : 0;
  // deep in the mountain the jungle can't be seen: skip drawing it (not on the clearing — you look down at wall 1 and the start)
  const deep = !onTop && !inShaftNow && z < CX.tun.vz1 - 0.5 && x > -22;
  if (deep) { for (const o of JUNGLE) if (o.visible) { o.visible = false; _hid.add(o); } }
  else if (_hid.size) { for (const o of _hid) o.visible = true; _hid.clear(); }
}
MM.CX = CX; MM.CXG = CXG; MM.CX_STATE = CX_STATE; MM.updateCave = updateCave; MM.JUMP = JUMP; MM.cxInterior = p => cxInterior(new V3(...p)); MM.gorillaGeo = gorillaGeo; MM.GRIP = () => GRIP_BITS;
MM.CAVE2_DARK = CAVE2_DARK; MM.fogInfo = () => ({ near: scene.fog.near, far: scene.fog.far, color: scene.fog.color.getHexString(), zone: CX_STATE.zone });
MM.CAVE_ARCH = CAVE_ARCH; MM.sdCaveArch = (p, i) => sdCaveArch(new V3(...p), CAVES[i]);

// ---------- DEBUG overlay (test build only) ----------
// Off by default. ?debug=1 / ?debug=0 force it on / off (and are remembered); otherwise the last choice is remembered in localStorage ('mmcave_debug').
// While off: no overlay objects exist, no canvas/texture updates, no renderer.info reads, no stats work (only a boolean check per frame + the tiny error hook).
const DBG_KEY = 'mmcave_debug';
const DBG = { on: false, slice: [], hist: [], n: 0, maxMs: 0, sumMs: 0, cpuMs: 0, t0: 0, updates: 0, mesh: null, cv: null, tex: null, el: null, text: '', lines: [] };
function dbgArea(h) {
  const z = CX_STATE.zone, F = CX.F, x = h.x, y = h.y;
  if (z === 'clearing') return 'top clearing';
  if (z === 'shaft') return 'ceiling shaft';
  if (z === 'tunnel') return 'tunnel';
  if (z === 'cave') return 'big cave';
  if (z === 'ledge') return 'big cave ledge';
  if (z === 'end') return y < F - 0.5 ? 'chasm (falling)' : 'ledge chamber';
  if (z === 'chasm') { if (y < F - 0.5) return 'chasm (falling)'; for (let i = 0; i < CX.pillars.length; i++) { const q = CX.pillars[i]; if (Math.hypot(x - q.x, h.z - q.z) < CX.PR + 0.25) return 'pillar ' + (i + 1); } return 'chasm'; }
  if (z === 'sidetunnel') return 'side tunnel';
  if (z === 'out') return PH.hands.some(q => q.vine) ? 'cliff vine' : y < F - 5 ? 'cliff (falling)' : x < 12 ? 'cliff lip' : y > F + 3 ? 'cliff long ledge' : 'cliff ledges';
  if (sdCaveArch(h, CAVES[0]) < 0.3) return 'shop cave';
  if (sdCaveArch(h, CAVES[1]) < 0.3) return 'wall cave';
  return Math.hypot(x, h.z) < 8 ? 'spawn' : 'jungle';
}
const dbgFmtN = n => n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(n);
function dbgBuildLines(w) { // w = max chars per error line
  const ri = renderer.info, pm = performance.memory, a = DBG.slice, n = a.reduce((s, q) => s + q.n, 0), dt = a.reduce((s, q) => s + q.dt, 0);
  const fps = dt > 0 ? n / dt : 0, avg = n ? dt / n * 1000 : 0, worst = Math.max(DBG.maxMs, ...DBG.hist), cpu = n ? a.reduce((s, q) => s + q.cpu, 0) / n : 0;
  const h = _cp, area = dbgArea(h);
  const L = [
    'DEBUG  ' + DBG_BUILD,
    'FPS ' + fps.toFixed(0) + '   frame ' + avg.toFixed(1) + ' ms   cpu ' + cpu.toFixed(1) + ' ms',
    'worst frame (last 5 s): ' + worst.toFixed(1) + ' ms',
    'JS heap: ' + (pm && pm.usedJSHeapSize ? (pm.usedJSHeapSize / 1048576).toFixed(1) + ' / ' + (pm.jsHeapSizeLimit / 1048576).toFixed(0) + ' MB' : 'n/a'),
    'textures ' + ri.memory.textures + '  geometries ' + ri.memory.geometries + '  programs ' + (ri.programs ? ri.programs.length : 0),
    'draw calls ' + ri.render.calls + '  triangles ' + dbgFmtN(ri.render.triangles),
    'area: ' + area + '  (' + h.x.toFixed(1) + ', ' + h.y.toFixed(1) + ', ' + h.z.toFixed(1) + ')',
    DBG_ERRS.length ? 'recent errors (' + DBG_ERRS.length + '):' : 'recent errors: none',
  ];
  for (const e of DBG_ERRS) L.push(' ! ' + (e.length > w ? e.slice(0, w - 1) + '…' : e));
  return L;
}
function dbgDraw() { // rebuilds the text (a few times a second) and pushes it to the VR panel and the flat-page box
  DBG.updates++;
  const vr = DBG.mesh && wrist.visible, flat = DBG.el && !renderer.xr.isPresenting;
  if (!vr && !flat) return;
  if (vr) {
    const L = dbgBuildLines(40), x = DBG.cv.getContext('2d'); DBG.lines = L;
    x.fillStyle = '#020804'; x.fillRect(0, 0, 512, 368);
    x.fillStyle = 'rgba(0,40,10,0.45)';
    for (let c = 0; c < 18; c++) { const xx = 10 + c * 28, g = 80 + ((c * 37) % 120); x.fillStyle = 'rgba(0,' + g + ',20,0.18)'; for (let r = 0; r < 12; r++) x.fillText(['0','1','7','A','#'][(c + r) % 5], xx, 18 + r * 30); }
    x.fillStyle = 'rgba(0,8,4,0.72)'; x.fillRect(6, 6, 500, 356);
    x.strokeStyle = '#39ff14'; x.lineWidth = 3; x.strokeRect(2, 2, 508, 364);
    x.font = 'bold 21px ui-monospace,Menlo,Consolas,monospace'; x.textAlign = 'left';
    L.forEach((t, i) => { x.fillStyle = i === 0 ? '#7CFF6B' : t.startsWith(' !') ? '#ff8c8c' : t.startsWith('recent errors (') ? '#ffb4b4' : '#39ff14'; x.fillText(t, 12, 30 + i * 25); });
    DBG.tex.needsUpdate = true;
  }
  if (flat) { const L = vr ? DBG.lines : dbgBuildLines(100); if (!vr) DBG.lines = L; DBG.el.textContent = L.join('\n'); }
}
function dbgFrame(now, cpu) { // per-frame bookkeeping while ON: interval + worst frame; the text refresh runs ~4x/s
  if (!DBG.t0) { DBG.t0 = now; DBG.last = now; return; }
  const iv = now - DBG.last; DBG.last = now; DBG.n++; DBG.sumMs += iv; DBG.cpuMs += cpu; if (iv > DBG.maxMs) DBG.maxMs = iv;
  if (now - DBG.t0 >= 250) {
    DBG.slice.push({ n: DBG.n, dt: (now - DBG.t0) / 1000, cpu: DBG.cpuMs }); if (DBG.slice.length > 4) DBG.slice.shift(); // last ~1 s for FPS / average
    DBG.hist.push(DBG.maxMs); if (DBG.hist.length > 20) DBG.hist.shift(); // 20 x 250 ms = last 5 s for the worst frame
    DBG.n = 0; DBG.sumMs = 0; DBG.cpuMs = 0; DBG.maxMs = 0; DBG.t0 = now;
    dbgDraw();
  }
}
function dbgPaintBtn() {
  const x = dbgBtnCv.getContext('2d'); x.fillStyle = DBG.on ? '#1f8f4a' : '#3a3a40'; x.fillRect(0, 0, 128, 56); x.strokeStyle = DBG.on ? '#9bffc0' : '#8a8a92'; x.lineWidth = 5; x.strokeRect(3, 3, 122, 50);
  x.fillStyle = '#fff'; x.font = 'bold 30px system-ui,sans-serif'; x.textAlign = 'center'; x.fillText('DEBUG', 64, 38); dbgBtnTex.needsUpdate = true;
}
function dbgSet(on, save = true) {
  on = !!on; DBG.on = on; if (save) LS(DBG_KEY, on ? '1' : '0');
  DBG.slice.length = DBG.hist.length = 0; DBG.n = DBG.maxMs = DBG.sumMs = DBG.cpuMs = DBG.t0 = 0;
  if (on && !DBG.mesh) { // VR panel floating just beyond the wrist panel, tilted to face the viewer; flat-page box
    DBG.cv = document.createElement('canvas'); DBG.cv.width = 512; DBG.cv.height = 368; DBG.tex = new THREE.CanvasTexture(DBG.cv); DBG.tex.colorSpace = THREE.SRGBColorSpace;
    DBG.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.1869), new THREE.MeshBasicMaterial({ map: DBG.tex, fog: false, transparent: true }));
    DBG.mesh.position.set(0, 0.2, 0.08); wrist.add(DBG.mesh); // child of the wrist panel: shows whenever the wrist panel is shown
    DBG.el = document.createElement('pre'); DBG.el.id = 'dbgBox';
    DBG.el.style.cssText = 'position:fixed;right:8px;top:8px;z-index:9;margin:0;padding:8px 10px;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#39ff14;background:rgba(0,8,4,.86);border:1px solid #39ff14;border-radius:4px;pointer-events:none;white-space:pre-wrap;max-width:min(560px,70vw);overflow:hidden;text-shadow:0 0 8px #00ff41';
    document.body.appendChild(DBG.el); DBG.updates = 0; dbgDraw();
  } else if (!on && DBG.mesh) {
    wrist.remove(DBG.mesh); DBG.mesh.geometry.dispose(); DBG.mesh.material.dispose(); DBG.tex.dispose(); DBG.el.remove();
    DBG.mesh = DBG.cv = DBG.tex = DBG.el = null; DBG.lines = [];
  }
  dbgPaintBtn(); const lb = $('dbgLand'), fb = $('dbgFlat'); const t = 'DEBUG: ' + (on ? 'ON' : 'OFF'); if (lb) lb.textContent = t + ' (tap to toggle)'; if (fb) fb.textContent = t;
}
{
  const q = new URLSearchParams(location.search).get('debug'), saved = LS(DBG_KEY);
  dbgSet(q === '1' ? true : q === '0' ? false : saved === '1', q === '1' || q === '0'); // only an explicit ?debug= overrides and re-saves
  for (const id of ['dbgLand', 'dbgFlat']) { const el = $(id); if (el) el.onclick = () => dbgSet(!DBG.on); }
}
MM.DBG = DBG; MM.dbgSet = dbgSet; MM.dbgArea = () => dbgArea(_cp); MM.DBG_ERRS = DBG_ERRS; MM.DBG_BUILD = DBG_BUILD; MM.dbgBtn = dbgBtn; MM.dbgKey = DBG_KEY;

// ---------- Y menu (test build): Music, Debug, Labels, Restart, Exit, Resume ----------
// Y on the left controller opens/closes a panel floating in front of you (placed where you look when it opens, 0.55 m away). Touch a button with either hand.
// There is no music track in the game, so "Music" switches all game sound (ambience + effects) on/off; voice chat is not affected. Remembered in localStorage.
const MUSIC = { on: LS('mmcave_music') !== '0' };
const MENU_ITEMS = [{ id: 'music' }, { id: 'debug' }, { id: 'labels' }, { id: 'restart' }, { id: 'exit' }, { id: 'resume' }];
const MENU = { open: false, yPrev: false, mesh: null, cv: null, tex: null, latch: [false, false], t: 0, last: null, count: 0, W: 0.46, H: 0.48, CH: 520 };
function menuLabel(id) { return id === 'music' ? 'Sound: ' + (MUSIC.on ? 'ON' : 'OFF') : id === 'debug' ? 'Debug: ' + (DBG.on ? 'ON' : 'OFF') : id === 'labels' ? 'Labels: ' + (LABELS.on ? 'ON' : 'OFF') : id === 'restart' ? 'Restart' : id === 'exit' ? 'Exit VR' : 'Resume'; }
function menuDraw() {
  const x = MENU.cv.getContext('2d'), W = 512, H = MENU.CH;
  x.fillStyle = 'rgba(14,22,16,0.94)'; x.fillRect(0, 0, W, H); x.strokeStyle = '#ffd23f'; x.lineWidth = 6; x.strokeRect(3, 3, W - 6, H - 6);
  x.fillStyle = '#ffd23f'; x.font = 'bold 32px system-ui,sans-serif'; x.textAlign = 'center'; x.fillText('MENU', W / 2, 40);
  MENU_ITEMS.forEach((it, i) => { const y = 52 + i * 70; x.fillStyle = it.id === 'exit' ? '#7a2a22' : it.id === 'resume' ? '#2a6a3a' : '#2c3a4a'; x.fillRect(40, y, W - 80, 58); x.strokeStyle = '#e8f0ff'; x.lineWidth = 3; x.strokeRect(40, y, W - 80, 58); x.fillStyle = '#fff'; x.font = 'bold 30px system-ui,sans-serif'; x.fillText(menuLabel(it.id), W / 2, y + 40); });
  x.fillStyle = '#cfe8cf'; x.font = '20px system-ui,sans-serif'; x.fillText('touch a button · Y closes · 1-6', W / 2, H - 12);
  MENU.tex.needsUpdate = true;
}
function menuSetOpen(open, inp) {
  MENU.open = open; MENU.latch = [true, true]; MENU.t = PH.simT; // simulation clock (seconds)
  if (open) {
    if (!MENU.mesh) { MENU.cv = document.createElement('canvas'); MENU.cv.width = 512; MENU.cv.height = MENU.CH; MENU.tex = new THREE.CanvasTexture(MENU.cv); MENU.tex.colorSpace = THREE.SRGBColorSpace; MENU.mesh = new THREE.Mesh(new THREE.PlaneGeometry(MENU.W, MENU.H), new THREE.MeshBasicMaterial({ map: MENU.tex, fog: false })); MENU.mesh.renderOrder = 5; }
    const e = new THREE.Euler().setFromQuaternion(inp.headQ, 'YXZ'), fw = new V3(-Math.sin(e.y), 0, -Math.cos(e.y));
    MENU.mesh.position.copy(inp.head).addScaledVector(fw, 0.55); MENU.mesh.position.y -= 0.12; MENU.mesh.rotation.set(-0.2, e.y, 0, 'YXZ'); // head-locked at open time, in the rig (moves with you)
    rig.add(MENU.mesh); menuDraw();
    if (JUMP.charging) { JUMP.charging = false; JUMP.blend = JUMP.BLEND; } // opening the menu cancels a charge (no jump)
  } else if (MENU.mesh) rig.remove(MENU.mesh);
}
function menuInput(inp) {
  if (inp.y && !MENU.yPrev) menuSetOpen(!MENU.open, inp); MENU.yPrev = !!inp.y;
  if (!MENU.open) return;
  inp.aRaw = inp.a; inp.a = false; JUMP.wait = true; // no jump / charge while the menu is up (and none right after closing until A is released)
  inp.hands.forEach((h, i) => { if (!PH.hands[i].vine) { h.grip = false; h.trig = false; } }); inp.noHands = true; // hands don't push off, climb or grab while choosing
}
const _mh = new V3();
function menuTouch(now) { // either hand pressing into a button (from the front) selects it; edge-triggered per hand
  if (!MENU.open || !MENU.mesh) return;
  MENU.mesh.updateMatrixWorld(true);
  for (let i = 0; i < 2; i++) {
    MENU.mesh.worldToLocal(_mh.copy(handsW[i]));
    let hit = null;
    if (Math.abs(_mh.z) < 0.07 && Math.abs(_mh.x) < MENU.W / 2 * (432 / 512)) { const py = (0.5 - _mh.y / MENU.H) * MENU.CH; MENU_ITEMS.forEach((it, k) => { const y = 52 + k * 70; if (py >= y && py <= y + 58) hit = it.id; }); }
    if (hit && !MENU.latch[i] && PH.simT - MENU.t > 0.35) { MENU.t = PH.simT; haptic(lastInp && lastInp.hands[i], 0.4, 30); menuDo(hit); }
    MENU.latch[i] = !!hit;
    if (!MENU.open) return;
  }
}
function menuDo(id) {
  MENU.last = id; MENU.count++; sfx('tap', 1);
  if (id === 'music') { MUSIC.on = !MUSIC.on; LS('mmcave_music', MUSIC.on ? '1' : '0'); if (AU.master) AU.master.gain.value = MUSIC.on ? 0.9 : 0; menuDraw(); }
  else if (id === 'debug') { dbgSet(!DBG.on); menuDraw(); }
  else if (id === 'labels') { labelsSet(!LABELS.on); }
  else if (id === 'restart') { menuSetOpen(false); const inp = lastInp || (MM.fake ? readFake() : emptyInput()); spawn(inp); PH.lastSup = PH.simT; MM.stats.restarts = (MM.stats.restarts || 0) + 1; }
  else if (id === 'exit') { menuSetOpen(false); const ses = renderer.xr.getSession(); if (ses) ses.end().catch(() => showLanding()); else showLanding(); }
  else if (id === 'resume') menuSetOpen(false);
}
MM.MENU = MENU; MM.MUSIC = MUSIC; MM.menuDo = menuDo; MM.MENU_ITEMS = MENU_ITEMS;
MM.menuBtnW = id => { const k = MENU_ITEMS.findIndex(it => it.id === id); const py = 52 + k * 70 + 29; MENU.mesh.updateMatrixWorld(true); return MENU.mesh.localToWorld(new V3(0, (0.5 - py / MENU.CH) * MENU.H, 0)).toArray(); };


// ---------- Matrix debug rain on the cave-test start screen only (cheap canvas 2D, throttled) ----------
const MTX = { last: 0, cols: [], cv: null, st: { n: 0, t0: 0, cpu: 0, max: 0, last: 0, slice: [] }, lines: [] };
function mtxInit() {
  MTX.cv = $('matrix'); if (!MTX.cv) return;
  const resize = () => {
    MTX.cv.width = innerWidth; MTX.cv.height = innerHeight;
    const n = Math.ceil(MTX.cv.width / 14);
    MTX.cols = Array.from({ length: n }, () => ({ y: Math.random() * MTX.cv.height, speed: 8 + Math.random() * 16 }));
  };
  addEventListener('resize', resize); resize();
}
function mtxBuildLines() {
  const ri = renderer.info, pm = performance.memory, a = MTX.st.slice, n = a.reduce((s, q) => s + q.n, 0), dt = a.reduce((s, q) => s + q.dt, 0);
  const fps = dt > 0 ? n / dt : 0, avg = n ? dt / n * 1000 : 0, worst = Math.max(0, ...a.map(q => q.max), MTX.st.max);
  const h = _cp, area = dbgArea(h);
  const L = [
    'DEBUG  ' + DBG_BUILD,
    'FPS ' + fps.toFixed(0) + '   frame ' + avg.toFixed(1) + ' ms',
    'worst frame: ' + worst.toFixed(1) + ' ms',
    'JS heap: ' + (pm && pm.usedJSHeapSize ? (pm.usedJSHeapSize / 1048576).toFixed(1) + ' / ' + (pm.jsHeapSizeLimit / 1048576).toFixed(0) + ' MB' : 'n/a'),
    'textures ' + ri.memory.textures + '  geometries ' + ri.memory.geometries + '  programs ' + (ri.programs ? ri.programs.length : 0),
    'draw calls ' + ri.render.calls + '  triangles ' + dbgFmtN(ri.render.triangles),
    'area: ' + area + '  (' + h.x.toFixed(1) + ', ' + h.y.toFixed(1) + ', ' + h.z.toFixed(1) + ')',
    DBG_ERRS.length ? 'recent errors (' + DBG_ERRS.length + '):' : 'recent errors: none',
  ];
  for (const e of DBG_ERRS) L.push(' ! ' + (e.length > 80 ? e.slice(0, 79) + '…' : e));
  return L;
}
function mtxDraw(now) {
  const land = $('landing'); if (!MTX.cv || !land || land.classList.contains('hidden')) return;
  if (now - MTX.last < 90) return; MTX.last = now;
  const x = MTX.cv.getContext('2d'), W = MTX.cv.width, H = MTX.cv.height;
  x.fillStyle = 'rgba(0, 0, 0, 0.22)'; x.fillRect(0, 0, W, H);
  x.font = '15px ui-monospace,Menlo,Consolas,monospace';
  const glyphs = '01アイウエオカキクケコサシスセソ0123456789ABCDEF#$*<>ｦｧｨｩｪｫ';
  for (let i = 0; i < MTX.cols.length; i++) {
    const c = MTX.cols[i], ch = glyphs[(Math.random() * glyphs.length) | 0];
    x.fillStyle = Math.random() < 0.14 ? '#c8ffc8' : '#00ff41';
    x.fillText(ch, i * 14, c.y);
    c.y += c.speed;
    if (c.y > H + 24) c.y = -30 * Math.random();
  }
  const L = mtxBuildLines(); MTX.lines = L;
  const bx = 24, by = Math.max(110, Math.min(H * 0.48, H - 28 * L.length - 40)), bw = Math.min(660, W - 48), bh = 22 * L.length + 28;
  x.fillStyle = 'rgba(0, 8, 4, 0.78)'; x.fillRect(bx, by, bw, bh);
  x.strokeStyle = '#39ff14'; x.lineWidth = 2; x.strokeRect(bx, by, bw, bh);
  x.font = 'bold 15px ui-monospace,Menlo,Consolas,monospace'; x.textAlign = 'left';
  L.forEach((line, i) => { x.fillStyle = i === 0 ? '#7CFF6B' : line.startsWith(' !') ? '#ff8c8c' : '#39ff14'; x.fillText(line, bx + 12, by + 24 + i * 22); });
}
function mtxFrame(now, cpu) {
  const land = $('landing'); if (!land || land.classList.contains('hidden')) return;
  if (!MTX.st.t0) { MTX.st.t0 = now; MTX.st.last = now; return; }
  const iv = now - MTX.st.last; MTX.st.last = now; MTX.st.n++; MTX.st.cpu += cpu; if (iv > MTX.st.max) MTX.st.max = iv;
  if (now - MTX.st.t0 >= 250) {
    MTX.st.slice.push({ n: MTX.st.n, dt: (now - MTX.st.t0) / 1000, max: MTX.st.max }); if (MTX.st.slice.length > 4) MTX.st.slice.shift();
    MTX.st.n = MTX.st.cpu = MTX.st.max = 0; MTX.st.t0 = now;
  }
  mtxDraw(now);
}
mtxInit();
MM.MTX = MTX;
