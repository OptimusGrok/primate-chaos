// Cave TEST build suite (/cave-test/). Run alone: flock /workspace/.browser-test.lock node test/cave.js
const { chromium } = require('/workspace/strike/node_modules/playwright');
const fs = require('fs');
const URL = process.env.MM_CAVE_URL || 'http://127.0.0.1:8765/cave-test/index.html';
const SHOTS = __dirname + '/../shots/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const tsrc = fs.readFileSync(__dirname + '/t.js', 'utf8');
const LOCAL_TRANSPORT = eval('(' + tsrc.split('const LOCAL_TRANSPORT = ')[1].split('\n};\n')[0] + '\n})');
const HELPERS = () => {
  const T3 = MM.THREE;
  window.C = {
    F: MM.CX.F, yaw: 0,
    q(yaw, pitch = 0) { return new T3.Quaternion().setFromEuler(new T3.Euler(pitch, yaw, 0, 'YXZ')).toArray(); },
    rot(o, yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); return [o[0] * c + o[2] * s, o[1], -o[0] * s + o[2] * c]; },
    idle(yaw = C.yaw, pitch = 0) { C.yaw = yaw; MM.fake = { head: [0, 1.6, 0], headQ: C.q(yaw, pitch), hands: [{ p: C.rot([-0.27, 0.98, -0.2], yaw) }, { p: C.rot([0.27, 0.98, -0.2], yaw) }], a: false }; },
    run(sec, fn) { const n = Math.round(sec * 72); for (let i = 0; i < n; i++) { if (fn && fn(i / 72) === false) return false; MM.step(1 / 72); } return true; },
    spawns() { return MM.stats.spawns || 0; },
    stand(x, z, yaw = 0, y = C.F) { C.idle(yaw); MM.place(x, y + 1.3, z); C.run(0.8); },
    head() { return MM.headW(); },
    jump(hold, fn) { MM.fake.a = true; C.run(hold, fn); MM.fake.a = false; },
    // run until landed (grounded, not moving) or respawned
    land(maxSec = 3.5) { const s0 = C.spawns(); let t = 0, still = 0; while (t < maxSec) { MM.step(1 / 72); t += 1 / 72; if (C.spawns() > s0) return { spawned: true, t }; if (MM.PH.grounded && MM.PH.V.length() < 0.05) { if (++still > 20) break; } else still = 0; } const h = C.head(); return { spawned: false, t, x: h.x, y: h.y, z: h.z }; },
    handTo(i, w) { const P = MM.rig.position; MM.fake.hands[i].p = [w[0] - P.x, w[1] - P.y + MM.HAND_DROP, w[2] - P.z]; },
    vine() { return MM.VINES.find(v => v.trig); },
    resetVine() { const v = C.vine(); v.q.copy(v.top).y -= v.L; v.qp.copy(v.q); },
    vinePt(y) { const v = C.vine(), t = Math.min(1, Math.max(0, (v.top.y - y) / Math.max(0.01, v.top.y - v.q.y))); return v.top.clone().lerp(v.q, t).toArray(); },
  };
};
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const vp = { width: 640, height: 400 };
  const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto(URL); await p.waitForFunction(() => !!window.MM, null, { timeout: 30000 }); await p.evaluate(HELPERS);
  ok(await p.evaluate(() => document.title.includes('CAVE TEST') && document.querySelector('.sub').textContent.includes('CAVE TEST') && MM.APPID === 'optimusgrok-monkey-mayhem-cavetest-v1'), 'test build: own title/banner and its own multiplayer namespace (appId ' + await p.evaluate(() => MM.APPID) + ')');
  await p.evaluate(() => { document.getElementById('roomIn').value = 'CAVE' + Math.random().toString(36).slice(2, 6); document.getElementById('voiceIn').checked = false; });
  await p.click('#playDesk'); await p.waitForTimeout(600);
  await p.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('hint').style.display = 'none'; MM.paused = true; MM.timeOverride = 0.25; });
  ok(errs.length === 0, 'loads and starts with no console errors ' + JSON.stringify(errs.slice(0, 3)));
  // ---------- 1. jump charge ----------
  const ch = await p.evaluate(() => {
    const r = {}, J = MM.JUMP; r.curve = [0, 0.5, 0.9, 1].map(c => { const s = J.speed(c); return [c, +s.h.toFixed(2), +s.u.toFixed(2)]; });
    C.stand(0, 4, 0, MM.terrainH(0, 4)); const y0 = C.head().y; MM.fake.a = true;
    const samp = []; C.run(2.97, t => { if ([0.5, 1.5, 2.5, 2.95].some(s => Math.abs(t - s) < 0.007)) { const h = MM.handsW(); samp.push({ t: +t.toFixed(2), c: +J.c.toFixed(3), sink: +(y0 - C.head().y).toFixed(3), handY: +((h[0][1] + h[1][1]) / 2 - MM.terrainH(0, 3.6)).toFixed(3), hand0: h[0] }); } });
    r.samp = samp; r.planted = Math.hypot(samp[1].hand0[0] - samp[3].hand0[0], samp[1].hand0[2] - samp[3].hand0[2]) < 0.02;
    r.vel0 = MM.PH.V.length();
    const n0 = J.count; let tl = 0; while (J.count === n0 && tl < 0.2) { MM.step(1 / 72); tl += 1 / 72; } r.autoT = +(2.97 + tl).toFixed(3); r.autoHeld = MM.fake.a; // A still held: launches by itself at 3 s
    const h0 = MM.handsW(), hy0 = C.head().y; r.launch = { c: J.last.c, h: J.last.h, u: J.last.u, vy: MM.PH.V.y, auto: J.last.auto };
    MM.step(1 / 72, 7); const h1 = MM.handsW(); r.push = { headUp: C.head().y - hy0, handMoved: Math.hypot(h1[0][0] - h0[0][0], h1[0][1] - h0[0][1], h1[0][2] - h0[0][2]) };
    const l = C.land(); r.land = l; r.jumpDist = Math.hypot(l.x - 0, l.z - 4);
    C.run(1.5); r.heldAfter = { charging: J.charging, count: J.count - n0 }; // still holding A after landing: no new charge
    MM.fake.a = false; C.run(0.1); MM.fake.a = true; C.run(0.5); r.recharge = { charging: J.charging, c: +J.c.toFixed(2) }; MM.fake.a = false; C.run(0.05); C.land();
    C.stand(0, 4, 0, MM.terrainH(0, 4)); C.jump(0.1); r.tap = C.land(); r.tapDist = Math.hypot(r.tap.x, r.tap.z - 4);
    return r;
  });
  console.log('INFO charge samples', JSON.stringify(ch.samp.map(s => ({ t: s.t, c: s.c, sink: s.sink, handY: s.handY }))));
  ok(ch.samp[0].c > 0.15 && ch.samp[0].c < 0.18 && Math.abs(ch.samp[1].c - 0.5) < 0.01 && Math.abs(ch.samp[2].c - 0.833) < 0.01 && ch.samp[3].c > 0.97, `holding A charges linearly in seconds (c ${ch.samp.map(s => s.c).join(' / ')} at ${ch.samp.map(s => s.t).join(' / ')} s)`);
  ok(ch.autoHeld && ch.launch.auto && ch.launch.c === 1 && Math.abs(ch.autoT - 3.0) < 0.03, `full charge jumps BY ITSELF at 3 s while A is still held (launched at ${ch.autoT} s, c ${ch.launch.c})`);
  ok(ch.heldAfter.charging === false && ch.heldAfter.count === 1 && ch.recharge.charging && ch.recharge.c > 0.1, 'after the auto-jump, keeping A held does not start a new charge; release and press again charges ' + JSON.stringify([ch.heldAfter, ch.recharge]));
  ok(ch.curve[0][1] < 1.5 && ch.curve[3][1] > 4 && ch.curve[2][1] / ch.curve[3][1] < 0.88, 'launch speed curve: small hop on a tap, steepest near full charge ' + JSON.stringify(ch.curve));
  ok(ch.samp[3].sink > 0.27 && ch.samp[3].sink < 0.33 && ch.samp[0].sink < ch.samp[1].sink && ch.samp[1].sink < ch.samp[3].sink, `camera sinks slowly while charging (${ch.samp.map(s => s.sink).join(' → ')} m)`);
  ok(ch.samp.every(s => Math.abs(s.handY - 0.07) < 0.06) && ch.planted && ch.vel0 < 0.01, 'hands stay planted on the ground while charging and the body stays put');
  ok(ch.push.headUp > 0.25 && ch.push.handMoved < 0.03 && ch.launch.vy > 4, `release: pushes off with both hands still on the ground (head +${ch.push.headUp.toFixed(2)} m in 0.1 s, hands moved ${ch.push.handMoved.toFixed(3)} m), then lifts off`);
  ok(!ch.land.spawned && ch.jumpDist > 3.5 && ch.tapDist < 0.9, `works anywhere: full jump in the jungle travels ${ch.jumpDist.toFixed(2)} m, a tap is a ${ch.tapDist.toFixed(2)} m hop`);
  // ---------- 2. pillar gaps ----------
  const gaps = await p.evaluate(() => {
    const r = { full: [], short: [] }, CX = MM.CX, edges = [CX.ledgeZ, ...CX.pillars.map(pc => pc.z - CX.PR)], targets = [...CX.pillars.map(pc => pc.z + CX.PR), CX.endEdge];
    edges.forEach((ez, i) => { C.stand(3, ez, 0); C.jump(3.1); const l = C.land(); r.full.push({ from: ez, ok: !l.spawned && l.z < targets[i] - 0.05 && Math.abs(l.y - (CX.F + 0.9)) < 0.1, z: l.z && +l.z.toFixed(2) }); });
    for (const hold of [2.8, 2.6, 2.0]) { C.stand(3, CX.ledgeZ, 0); C.jump(hold); const l = C.land(); r.short.push({ hold, c: +MM.JUMP.last.c.toFixed(3), spawned: l.spawned }); }
    C.stand(3, CX.pillars[0].z - CX.PR, 0); C.jump(2.75); const l = C.land(); r.short.push({ from: 'pillar1', hold: 2.75, spawned: l.spawned });
    // full traversal without teleporting: ledge -> 3 pillars -> ledge, small hops to reach each far edge
    C.stand(3, CX.ledgeZ, 0); const s0 = C.spawns(); r.chain = [];
    for (let i = 0; i < 4; i++) {
      C.jump(3.1); let l = C.land(); r.chain.push(l.spawned ? 'fell' : +l.z.toFixed(2)); if (l.spawned) break;
      if (i < 3) { const far = CX.pillars[i].z - CX.PR; let hops = 0; while (C.head().z - far > 0.45 && hops < 8) { C.jump(C.head().z - far > 1.0 ? 1.59 : 0.1); l = C.land(); hops++; if (l.spawned) break; } r.chain.push('hops' + hops + '@' + (C.head().z - far).toFixed(2)); }
    }
    r.chainOk = C.spawns() === s0 && C.head().z < CX.endEdge;
    return r;
  });
  ok(gaps.full.every(g => g.ok), 'a full 3 s charge from the very edge clears every gap (ledge → pillar 1 → 2 → 3 → far ledge): ' + JSON.stringify(gaps.full.map(g => g.z)));
  ok(gaps.short.every(g => g.spawned), 'any lesser charge falls short into the dark: ' + JSON.stringify(gaps.short));
  ok(gaps.chainOk, 'whole crossing in one go, small hops to each far edge: ' + JSON.stringify(gaps.chain));
  // ---------- 2b. charged jump on a real headset: head bob / drift, the real WebXR input path (xr-standard right controller, button 4) ----------
  const hs = await p.evaluate(() => {
    const r = { bob: [] }, CX = MM.CX, F = CX.F, J = MM.JUMP, T = MM.THREE;
    for (const [amp, freq, drift] of [[0.005, 1.5, 0], [0.012, 2.2, 0], [0, 0, 0.03], [0.02, 0.7, -0.05]]) { // real heads never hold still
      C.stand(3, CX.ledgeZ, 0); MM.fake.a = true; let maxC = 0, drops = 0, prevT = 0;
      C.run(3.4, t => { MM.fake.head = [0, 1.6 + amp * Math.sin(t * freq * 6.283) + drift * t / 3, 0]; if (J.charging) { if (J.t < prevT - 0.05) drops++; prevT = J.t; } maxC = Math.max(maxC, J.c); });
      MM.fake.a = false; MM.fake.head = [0, 1.6, 0]; const l = C.land(); r.bob.push({ amp, drift, maxC: +maxC.toFixed(2), drops, c: J.last.c, landZ: l.z && +l.z.toFixed(2), spawned: l.spawned });
    }
    // scripted XRFrame + inputSources: readVR() is the code that runs on the Quest
    const btn = () => ({ pressed: false, touched: false, value: 0 });
    const S = { head: [0, 1.6, 0], headQ: [0, 0, 0, 1], hands: [[-0.27, 0.98, -0.2], [0.27, 0.98, -0.2]] };
    const src = (hand, i) => ({ handedness: hand, gripSpace: { hand }, targetRaySpace: {}, profiles: ['oculus-touch-v3', 'generic-trigger-squeeze-thumbstick'], gamepad: { mapping: 'xr-standard', buttons: [0, 1, 2, 3, 4, 5, 6].map(btn), axes: [0, 0, 0, 0], hapticActuators: [] }, i });
    const L = src('left', 0), R = src('right', 1), pose = (p, q) => ({ transform: { position: { x: p[0], y: p[1], z: p[2] }, orientation: { x: q[0], y: q[1], z: q[2], w: q[3] } } });
    const frame = { getViewerPose: () => pose(S.head, S.headQ), getPose: (space) => pose(S.hands[space.hand === 'left' ? 0 : 1], [0, 0, 0, 1]) };
    const xr = { ref: {}, session: { inputSources: [R, L] }, frame }; // right listed first: order must not matter
    const A = on => { R.gamepad.buttons[4].pressed = on; R.gamepad.buttons[4].value = on ? 1 : 0; };
    const xrStand = (x, z, yaw = 0, pitch = 0, y) => { MM.fake = null; MM.xrSim = xr; S.headQ = C.q(yaw, pitch); S.head = [0, 1.6, 0]; MM.place(x, (y ?? F) + 1.3, z); C.run(0.8); };
    const xrLand = () => { let t = 0, s0 = C.spawns(), still = 0; while (t < 4) { MM.step(1 / 72); t += 1 / 72; if (C.spawns() > s0) return { spawned: true }; if (MM.PH.grounded && MM.PH.V.length() < 0.05) { if (++still > 20) break; } else still = 0; } const h = C.head(); return { spawned: false, x: h.x, y: h.y, z: h.z }; };
    xrStand(3, CX.ledgeZ); A(true); const n0 = J.count; let tAuto = -1; C.run(3.3, t => { S.head = [0, 1.6 + 0.006 * Math.sin(t * 9), 0]; if (tAuto < 0 && J.count > n0) tAuto = t; }); r.xrA = MM.JUMP.held; A(false);
    r.xrFull = { tAuto: +tAuto.toFixed(2), c: J.last.c, auto: J.last.auto, land: xrLand() };
    xrStand(3, CX.ledgeZ); A(true); C.run(2.0); A(false); r.xrPartial = { c: +J.last.c.toFixed(2), land: xrLand() };
    // distance grows with the hold (jungle, flat ground in front of spawn)
    r.dist = [];
    for (const hold of [0.5, 1.5, 2.2, 2.7, 3.2]) { const z0 = 8; xrStand(0, z0, 0, 0, MM.terrainH(0, z0)); A(true); C.run(hold); A(false); const l = xrLand(); r.dist.push({ hold, c: +J.last.c.toFixed(2), d: l.spawned ? null : +Math.hypot(l.x, l.z - z0).toFixed(2) }); }
    // forward = where the head looks (yaw), even looking steeply down at the edge
    xrStand(-6, 6, Math.PI / 2, -1.0, MM.terrainH(-6, 6)); A(true); C.run(1.2); A(false); C.run(0.05); r.dir = J.last.dir.map(v => +v.toFixed(2));
    MM.xrSim = null; C.idle(0);
    return r;
  });
  ok(hs.bob.every(b => b.maxC === 1 && b.drops === 0 && !b.spawned && b.landZ < -52.3), 'head bob / slow drift while holding A (a real headset) no longer resets the charge: full charge every time and lands on pillar 1 ' + JSON.stringify(hs.bob));
  ok(hs.xrFull.c === 1 && hs.xrFull.auto && Math.abs(hs.xrFull.tAuto - 3.0) < 0.05 && !hs.xrFull.land.spawned && hs.xrFull.land.z < -52.5, `real WebXR input path (xr-standard right controller, buttons[4] = A, scripted XRFrame): 3 s hold from the ledge edge auto-launches at ${hs.xrFull.tAuto} s and lands ${(-48 - 4 - hs.xrFull.land.z).toFixed(2)} m onto pillar 1`);
  ok(hs.xrPartial.land.spawned, `same path, a 2 s hold (c ${hs.xrPartial.c}) falls short into the chasm`);
  ok(hs.dist.every((d, i) => d.d != null && (i === 0 || d.d > hs.dist[i - 1].d + 0.1)) && hs.dist[4].d - hs.dist[3].d > 1, 'each longer hold jumps clearly further: ' + JSON.stringify(hs.dist));
  ok(Math.abs(hs.dir[0] + 1) < 0.02 && Math.abs(hs.dir[1]) < 0.02, 'jump direction = where the head looks (yaw), also while looking steeply down: ' + JSON.stringify(hs.dir));
  // ---------- 2c. while charging only the two planted arms show (no extra arm on the controller holding A) ----------
  const arms = await p.evaluate(() => {
    const r = {}, CX = MM.CX, G = MM.gorillaGeo, T = MM.THREE, cam = MM.camera;
    const kinds = new Map([[G.upper, 'upper'], [G.fore, 'fore'], [G.handL, 'handL'], [G.handLc, 'handL'], [G.handR, 'handR'], [G.handRc, 'handR']]);
    const visibleFP = () => { const out = []; MM.scene.traverse(o => { if (!o.isMesh || !kinds.has(o.geometry) || !(o.layers.mask & cam.layers.mask)) return; let v = true; for (let a = o; a; a = a.parent) if (!a.visible) v = false; if (v) out.push({ k: kinds.get(o.geometry), p: o.getWorldPosition(new T.Vector3()) }); }); return out; };
    C.stand(3, -40, 0); const raised = [0.3, 1.45, -0.45]; MM.fake.hands[1].p = raised; MM.fake.hands[1].trig = false; C.run(0.3);
    const rw = () => new T.Vector3(...raised).add(MM.rig.position);
    r.before = visibleFP().map(m => m.k).sort().join(',');
    MM.fake.a = true; C.run(1.5); MM.render(); const during = visibleFP(), pl = MM.JUMP.plant;
    r.during = during.map(m => m.k).sort().join(',');
    r.handsOnPlant = during.filter(m => m.k.startsWith('hand')).every(m => Math.min(m.p.distanceTo(pl[0]), m.p.distanceTo(pl[1])) < 0.12);
    r.nearRaised = during.filter(m => m.p.distanceTo(rw()) < 0.35).map(m => m.k);
    r.mirrorHands = MM.MIRROR.avatar.hands.map(h => +h.getWorldPosition(new T.Vector3()).distanceTo(rw()).toFixed(2));
    const n0 = MM.JUMP.count; MM.fake.a = false; C.run(0.6); r.after = { launched: MM.JUMP.count === n0 + 1, kinds: visibleFP().map(m => m.k).sort().join(','), rightOnController: visibleFP().some(m => m.k === 'handR' && m.p.distanceTo(new T.Vector3(...raised).add(MM.rig.position).add(new T.Vector3(0, -MM.HAND_DROP, 0))) < 0.2) };
    C.land(); C.idle(0); return r;
  });
  ok(arms.during === 'fore,fore,handL,handR,upper,upper' && arms.handsOnPlant && arms.nearRaised.length === 0, `while charging exactly 2 arms + 2 hands are visible, both planted on the ground; nothing follows the raised right controller (${arms.during}; near controller: ${JSON.stringify(arms.nearRaised)})`);
  ok(arms.after.launched && arms.after.kinds === arms.before && arms.after.rightOnController, 'after take-off the normal controller-following arms come back (same 2 + 2 meshes)');
  // ---------- 2d. the chasm holds nothing: walking (room-scale head movement) or arm-pushing off the ledge = fall, respawn 2 s later ----------
  const walk = await p.evaluate(() => {
    const r = { walks: [], pushes: [] }, CX = MM.CX, F = CX.F, T = MM.THREE;
    const overVoid = h => h.z < CX.ledgeZ - 0.4 && h.z > CX.endEdge + 0.4 && !CX.pillars.some(pc => Math.hypot(h.x - pc.x, h.z - pc.z) < CX.PR + 0.4);
    const run = (secs, drive) => { const s0 = C.spawns(), f0 = MM.stats.fallResets || 0; let held = 0, worstHeld = 0; for (let i = 0; i < secs * 72; i++) { drive(i / 72); MM.step(1 / 72); const h = C.head(); if (C.spawns() > s0) return { spawned: true, t: +(i / 72).toFixed(2), fallTimer: (MM.stats.fallResets || 0) > f0, fallFor: +MM.lastFall.toFixed(2), worstHeld: +worstHeld.toFixed(2) }; if (overVoid(h) && h.y > F + 0.5) { held += 1 / 72; worstHeld = Math.max(worstHeld, held); } else held = 0; } const h = C.head(); return { spawned: false, at: [+h.x.toFixed(2), +h.y.toFixed(2), +h.z.toFixed(2)], worstHeld }; };
    // walk the head forward 3 m at 0.8 m/s: hands hanging, hands dragging on the floor, arms swinging; centre, both sides, diagonal
    for (const [x, yaw, handY, swing, z0] of [[3, 0, 0.98, 0, CX.ledgeZ + 1], [3, 0, 0.75, 0, CX.ledgeZ + 1], [-1.5, 0.3, 0.75, 1, CX.ledgeZ + 1], [7.5, -0.3, 0.98, 1, CX.ledgeZ + 1], [3, 0, 0.75, 1, CX.pillars[0].z], [3, -Math.PI / 2, 0.75, 0, CX.pillars[1].z], [3, 0, 0.75, 0, CX.pillars[2].z]]) {
      C.stand(x, z0, yaw); const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const res = run(6, t => { const d = Math.min(3, t * 0.8), ph = swing ? Math.sin(t * 6) * 0.3 : 0; MM.fake.head = [fx * d, 1.6, fz * d];
        for (const [i, s] of [[0, -1], [1, 1]]) { const k = s * ph; MM.fake.hands[i].p = [rx * 0.27 * s + fx * (d - 0.2 + k), handY - (swing ? Math.max(0, s * Math.sin(t * 6)) * 0.25 : 0), rz * 0.27 * s + fz * (d - 0.2 + k)]; } });
      r.walks.push(Object.assign({ x, z0, yaw: +yaw.toFixed(2), handY, swing }, res));
    }
    // gorilla arm-push run from the grippy floor straight at the edge (and at an angle)
    for (const yaw of [0, 0.35, -0.35]) {
      C.stand(3, CX.ledgeZ + 4.6, yaw); const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const res = run(8, t => { const cyc = (t % 0.5) / 0.5, down = cyc < 0.45; // hands plant forward on the floor, sweep back hard, lift, return
        const off = down ? 0.45 - 1.0 * (cyc / 0.45) : -0.55 + 1.0 * ((cyc - 0.45) / 0.55), y = down ? 0.62 : 0.95;
        for (const [i, s] of [[0, -1], [1, 1]]) MM.fake.hands[i].p = [rx * 0.3 * s + fx * off, t < 2.5 ? y : 0.98, rz * 0.3 * s + fz * off]; });
      r.pushes.push(Object.assign({ yaw }, res));
    }
    // no collider anywhere in the chasm (away from pillars and walls) or in the cliff air
    let n = 0, hits = 0; const v = new T.Vector3();
    for (let x = -3.0; x <= 9.0; x += 0.3) for (let z = CX.ledgeZ - 0.45; z >= CX.endEdge + 0.5; z -= 0.3) for (let y = F - 2; y <= F + 2.5; y += 0.3) { if (CX.pillars.some(pc => Math.hypot(x - pc.x, z - pc.z) < CX.PR + 0.45)) continue; v.set(x, y, z); n++; if (MM.nearest(v).d < 0.4) hits++; }
    for (let x = 11.5; x <= 40; x += 0.7) for (let z = CX.faceZ + 0.6; z <= -50.5; z += 0.7) for (let y = F - 6; y <= F + 8; y += 0.7) { if ([...CX.ledges, CX.lip, CX.overhang].some(b => Math.abs(x - b.c.x) < b.h.x + 0.5 && Math.abs(y - b.c.y) < b.h.y + 0.5 && Math.abs(z - b.c.z) < b.h.z + 0.5)) continue; v.set(x, y, z); n++; if (MM.nearest(v).d < 0.4) hits++; }
    r.scan = { n, hits }; C.idle(0); return r;
  });
  ok(walk.walks.every(w => w.spawned && w.fallTimer && w.fallFor >= 1.99 && w.fallFor < 2.7 && w.worstHeld < 0.35), 'walking off the ledge / off each pillar (head moving room-scale; hands hanging, dragging on the floor or swinging; centre, sides, diagonal, sideways): nothing holds you up, you fall and respawn 2 s after your last footing (a hand sliding off the edge can add a moment) ' + JSON.stringify(walk.walks.map(w => [w.x, w.z0, w.handY, w.swing, w.spawned ? w.t : w.at, w.worstHeld, w.fallFor, w.fallTimer])));
  ok(walk.pushes.every(w => w.spawned ? w.fallTimer && w.worstHeld < 0.6 : w.at[2] > MM_LEDGE_Z - 0.3), 'gorilla arm-push runs at the edge: you either stop on the cave floor or fall and respawn; never stand on the chasm ' + JSON.stringify(walk.pushes.map(w => [w.yaw, w.spawned ? 'fell@' + w.t : w.at])));
  ok(walk.scan.hits === 0, `no invisible collider anywhere in the chasm (between and past the pillars) or in the cliff air: ${walk.scan.n} probe points, ${walk.scan.hits} hits`);
  // ---------- 2e. gorilla arm locomotion on the REAL WebXR input path (readVR via scripted XRFrame/inputSources): controllers pushing on ground / walls move you ----------
  const arm = await p.evaluate(() => {
    const r = {}, CX = MM.CX, F = CX.F, J = MM.JUMP;
    const btn = () => ({ pressed: false, touched: false, value: 0 });
    const mk = hand => ({ handedness: hand, gripSpace: { hand }, targetRaySpace: {}, profiles: ['oculus-touch-v3'], gamepad: { mapping: 'xr-standard', buttons: [0, 1, 2, 3, 4, 5, 6].map(btn), axes: [0, 0, 0, 0], hapticActuators: [] } });
    const Ls = mk('left'), Rs = mk('right'), S = { head: [0, 1.6, 0], hands: [[-0.27, 0.98, -0.2], [0.27, 0.98, -0.2]] };
    const pose = p => ({ transform: { position: { x: p[0], y: p[1], z: p[2] }, orientation: { x: 0, y: 0, z: 0, w: 1 } } });
    MM.fake = null; MM.xrSim = { ref: {}, session: { inputSources: [Ls, Rs] }, frame: { getViewerPose: () => pose(S.head), getPose: s => pose(S.hands[s.hand === 'left' ? 0 : 1]) } };
    const set = (b, i, on) => { b.gamepad.buttons[i].pressed = on; b.gamepad.buttons[i].value = on ? 1 : 0; };
    const rest = () => { S.hands = [[-0.27, 0.98, -0.2], [0.27, 0.98, -0.2]]; };
    const settle = () => { rest(); let t = 0, still = 0; while (t < 4) { MM.step(1 / 72); t += 1 / 72; if (MM.PH.grounded && MM.PH.V.length() < 0.05) { if (++still > 20) break; } else still = 0; } };
    // both controllers sweep down onto the ground, push back (front -> behind), lift and swing forward again: 2 s of strokes
    const groundPush = () => { const h0 = C.head(); let anch = 0;
      C.run(2.0, t => { const cyc = (t % 0.5) / 0.5, down = cyc < 0.45, off = down ? -0.45 + 0.9 * (cyc / 0.45) : 0.45 - 0.9 * ((cyc - 0.45) / 0.55), y = down ? 0.62 : 0.95; S.hands = [[-0.3, y, off], [0.3, y, off]]; if (MM.PH.anyAnch) anch++; });
      const h1 = C.head(); settle(); return { moved: +(h0.z - h1.z).toFixed(2), sideways: +Math.abs(h1.x - h0.x).toFixed(2), anch }; };
    // right controller on the tunnel wall at chest height, sweeping along it front -> behind; left hand hanging free
    const wallPush = () => { const h0 = C.head(); let anch = 0;
      C.run(2.0, t => { const cyc = (t % 0.5) / 0.5, on = cyc < 0.45, off = on ? -0.4 + 0.8 * (cyc / 0.45) : 0.4 - 0.8 * ((cyc - 0.45) / 0.55); S.hands = [[-0.25, 1.1, -0.1], [on ? 1.3 : 0.6, 1.3, off]]; if (MM.PH.anyAnch) anch++; });
      const h1 = C.head(); settle(); return { moved: +(h0.z - h1.z).toFixed(2), anch }; };
    const stand = (x, z, y) => { S.head = [0, 1.6, 0]; rest(); MM.place(x, y + 1.3, z); settle(); };
    const gy = (x, z) => MM.terrainH(x, z);
    stand(0, 4, gy(0, 4)); r.ground = groundPush();
    stand(3, -40, F); r.cave = groundPush();
    stand(3.6, -29, F); r.wall = wallPush();
    // after a charged jump (1.2 s hold of A = right buttons[4])
    stand(0, 8, gy(0, 8)); const n0 = J.count; set(Rs, 4, true); C.run(1.2); set(Rs, 4, false); settle(); r.jumped = J.count - n0; r.afterJump = groundPush();
    stand(0, 14, gy(0, 14)); set(Rs, 4, true); C.run(3.2); set(Rs, 4, false); settle(); r.autoJumped = J.last.auto; r.afterAutoJump = groundPush();
    // after opening and closing the Y menu (left buttons[5]); pushes while open do nothing
    stand(0, 4, gy(0, 4)); set(Ls, 5, true); C.run(0.1); set(Ls, 5, false); C.run(0.1); r.menuOpened = MM.MENU.open; r.menuOpen = groundPush();
    set(Ls, 5, true); C.run(0.1); set(Ls, 5, false); C.run(0.1); r.menuClosed = !MM.MENU.open; r.afterMenu = groundPush();
    // after a respawn (walked off the ledge into the chasm, 2 s fall, back at spawn)
    const s0 = C.spawns(); S.head = [0, 1.6, 0]; rest(); MM.place(3, F - 2, CX.ledgeZ - 1.2); let t = 0; while (C.spawns() === s0 && t < 5) { MM.step(1 / 72); t += 1 / 72; } r.respawned = C.spawns() > s0; settle(); r.afterRespawn = groundPush();
    MM.xrSim = null; C.idle(0);
    return r;
  });
  const armOk = m => m && m.moved > 1.5 && m.anch > 20;
  ok(armOk(arm.ground) && armOk(arm.cave), `real WebXR input path: both controllers pushing back on the ground move you forward (jungle ${arm.ground.moved} m, big cave ${arm.cave.moved} m in 2 s of strokes)`);
  ok(arm.wall.moved > 0.5 && arm.wall.anch > 10, `real WebXR input path: one controller pushing along the tunnel wall moves you (${arm.wall.moved} m)`);
  ok(arm.jumped === 1 && arm.autoJumped && armOk(arm.afterJump) && armOk(arm.afterAutoJump), `arm movement still works after a charged jump and after the 3 s auto-jump (${arm.afterJump.moved} m / ${arm.afterAutoJump.moved} m)`);
  ok(arm.menuOpened && arm.menuOpen.moved < 0.05 && arm.menuClosed && armOk(arm.afterMenu), `Y menu open: pushes do nothing (${arm.menuOpen.moved} m); after closing it arm movement works again (${arm.afterMenu.moved} m)`);
  ok(arm.respawned && armOk(arm.afterRespawn), `after a fall + respawn arm movement works (${arm.afterRespawn.moved} m) ` + JSON.stringify(arm));
  // ---------- 3. falling = 2 s, then spawn ----------
  const fall = await p.evaluate(() => {
    const r = [], CX = MM.CX;
    for (const [x, z, yaw, name] of [[3, CX.ledgeZ + 0.3, 0, 'chasm'], [10.9, -72, -Math.PI / 2, 'cliff (lip)'], [21.5, -72.4, -Math.PI / 2, 'long ledge']]) {
      C.stand(x, z, yaw, name === 'long ledge' ? CX.F + 3 : CX.F); const s0 = C.spawns(), f0 = MM.stats.fallResets || 0;
      MM.place(...(name === 'chasm' ? [3, CX.F + 1, CX.ledgeZ - 1.5] : name === 'cliff (lip)' ? [11.9, CX.F + 1, -71.5] : [21.5, CX.F + 4, -71.6])); // step off the edge
      let t = 0, minY = 99; while (C.spawns() === s0 && t < 4) { MM.step(1 / 72); t += 1 / 72; if (C.spawns() === s0) minY = Math.min(minY, C.head().y); }
      const h = C.head(); r.push({ name, t: +t.toFixed(2), fell: +(CX.F + 1 - minY).toFixed(1), atSpawn: Math.hypot(h.x, h.z) < 2 && h.y < 2, timer: (MM.stats.fallResets || 0) > f0 });
    }
    return r;
  });
  ok(fall.every(f => Math.abs(f.t - 2.0) < 0.05 && f.fell > 15 && f.atSpawn && f.timer), 'falling into a void (chasm, off the cliff, off the long ledge) = 2 s of falling, then back at spawn: ' + JSON.stringify(fall));
  // ---------- 4. play area: standing anywhere in the cave system never respawns ----------
  const stay = await p.evaluate(() => {
    const CX = MM.CX, spots = [[3, -27.5, 0], [3, -31, 0], [3, -40, 0], [5, -44, 0], [3, CX.ledgeZ + 0.2, 0], [3, CX.pillars[1].z, 0], [3, -72.5, 0], [8, -72, -Math.PI / 2], [10.6, -72, -Math.PI / 2], [13.3, -72.9, -Math.PI / 2], [15.9, -72.9, -Math.PI / 2], [23, -72.9, -Math.PI / 2, CX.F + 3]];
    const s0 = C.spawns(), bad = [];
    for (const [x, z, yaw, y] of spots) { C.stand(x, z, yaw, y ?? CX.F); C.run(2); const h = C.head(); if (Math.hypot(h.x - x, h.z - z) > 0.4 || Math.abs(h.y - ((y ?? CX.F) + 0.9)) > 0.15) bad.push([x, z, +h.x.toFixed(2), +h.y.toFixed(2), +h.z.toFixed(2)]); }
    return { spawns: C.spawns() - s0, bad, oob: [MM.outOfBounds(3, CX.F + 1, -40), MM.outOfBounds(3, CX.F - 20, -59), MM.outOfBounds(30, CX.F - 100, -60), MM.outOfBounds(3, CX.F + 1, -90), MM.outOfBounds(-15, CX.F + 1, -40)] };
  });
  ok(stay.spawns === 0 && stay.bad.length === 0, 'tunnel, big cave, ledge, pillar top, ledge chamber, side tunnel, cliff lip and all ledges are solid play area (2 s each, no respawn, no drift) ' + JSON.stringify(stay.bad));
  ok(stay.oob.join() === 'false,false,false,true,true', 'out-of-bounds: cave system, chasm and cliff air are in bounds; solid rock beyond them is out ' + stay.oob);
  // ---------- 5. reachability by jumping only (no teleports): cave 2 -> tunnel -> big cave; chamber -> side tunnel -> cliff lip -> ledges ----------
  const reach = await p.evaluate(() => {
    const CX = MM.CX, r = {}; C.stand(3, -25.6, 0); const s0 = C.spawns(); let n = 0;
    while (C.head().z > CX.ledgeZ + 4 && n < 40) { C.jump(1.82); C.land(); n++; }
    MM.render(); r.cave = { hops: n, z: +C.head().z.toFixed(2), spawns: C.spawns() - s0, zone: MM.CX_STATE.zone, jungleHidden: !MM.CXG.in.parent.children.find(o => o.isMesh && o.geometry.attributes.position.count > 100000)?.visible };
    C.stand(3, -71.5, -Math.PI / 2); n = 0; const s1 = C.spawns();
    while (C.head().x < 10.9 && n < 30) { C.jump(1.64); C.land(); n++; }
    MM.render(); r.exit = { hops: n, x: +C.head().x.toFixed(2), spawns: C.spawns() - s1, zone: MM.CX_STATE.zone };
    // lip -> ledge 1 -> ledge 2 with medium charges
    C.stand(11.15, -72.9, -Math.PI / 2); const s2 = C.spawns(); r.ledges = [];
    for (const [hold, target] of [[2.31, CX.ledges[0]], [2.31, CX.ledges[1]]]) { C.jump(hold); const l = C.land(); r.ledges.push(l.spawned ? 'fell' : +l.x.toFixed(2)); if (!l.spawned && Math.abs(l.x - target.c.x) < 0.8) { MM.place(target.c.x + target.h.x - 0.05, CX.F + 1.3, -72.9); C.run(0.5); } }
    r.ledgesOk = C.spawns() === s2 && r.ledges.every((x, i) => Math.abs(x - CX.ledges[i].c.x) < 0.8);
    return r;
  });
  ok(reach.cave.spawns === 0 && reach.cave.z < MM_LEDGE_Z + 4.5 && /cave|ledge/.test(reach.cave.zone), 'the big cave is reachable from the wall cave through the arched tunnel (jumping only): ' + JSON.stringify(reach.cave));
  ok(reach.exit.spawns === 0 && reach.exit.x > 10.6, 'from the ledge chamber the 4 m side tunnel to the right leads out onto the cliff lip: ' + JSON.stringify(reach.exit));
  ok(reach.ledgesOk, 'cliff: jump forward from the lip onto the 1x1 ledge, then the second 1x1 ledge (medium charges): ' + JSON.stringify(reach.ledges));
  // ---------- 6. vine: either trigger grabs, one hand holds, hand-over-hand climb 3 m, jump to the long ledge ----------
  const vine = await p.evaluate(() => {
    const CX = MM.CX, r = {}, v = C.vine(), F = CX.F;
    // grip alone does not grab the cliff vine; right trigger does (on a jump from ledge 2)
    C.resetVine(); C.stand(16.35, -72.8, -Math.PI / 2); MM.fake.hands[1].p = C.rot([0.18, 1.55, -0.6], -Math.PI / 2); MM.fake.hands[1].grip = true; C.run(0.2);
    MM.fake.a = true; C.run(2.03); MM.fake.a = false; let grabbedGrip = false; C.run(0.6, () => { if (MM.PH.hands.some(h => h.vine === v)) grabbedGrip = true; }); r.gripOnly = grabbedGrip;
    C.resetVine(); C.stand(16.35, -72.8, -Math.PI / 2); MM.fake.hands[1].p = C.rot([0.18, 1.55, -0.6], -Math.PI / 2); MM.fake.hands[1].trig = true; C.run(0.2);
    MM.fake.a = true; C.run(2.03); MM.fake.a = false; let tg = -1; C.run(1.0, t => { if (tg < 0 && MM.PH.hands[1].vine === v) tg = t; });
    r.rightGrab = tg >= 0; r.closedR = MM.myHands[1].geometry === MM.gorillaGeo.handRc && MM.myHands[0].geometry === MM.gorillaGeo.handL;
    // hang with ONE hand for 3 s
    const s0 = C.spawns(), yA = C.head().y; let lo = 99, hi = -99; C.run(3, () => { const y = C.head().y; lo = Math.min(lo, y); hi = Math.max(hi, y); });
    r.oneHand = { spawns: C.spawns() - s0, swing: +(hi - lo).toFixed(2), sag: +(yA - C.head().y).toFixed(2), y: +yA.toFixed(2), holding: MM.PH.hands[1].vine === v && !MM.PH.hands[0].vine }; // swings like a pendulum, never falls
    // left trigger grabs too
    C.handTo(0, C.vinePt(MM.handsW()[1][1] + 0.4)); MM.fake.hands[0].trig = true; C.run(0.1); r.leftGrab = MM.PH.hands[0].vine === v; r.closedBoth = MM.myHands[0].geometry === MM.gorillaGeo.handLc && MM.GRIP() === 3;
    // climb hand over hand: free hand reaches 0.45 m up the vine and grips, the other lets go, then pull down
    const y0 = C.head().y; let hand = 0, steps = 0; MM.fake.hands[1].trig = false; C.run(0.1);
    while (C.head().y - y0 < 3.05 && steps < 20) {
      const P = MM.rig.position, start = MM.fake.hands[hand].p.slice();
      C.run(0.4, t => { MM.fake.hands[hand].p = [start[0], start[1] - 0.5 * t / 0.4, start[2]]; }); // pull
      const o = 1 - hand; C.handTo(o, C.vinePt(MM.handsW()[hand][1] + 0.45)); MM.fake.hands[o].trig = true; C.run(0.08);
      if (MM.PH.hands[o].vine !== v) { r.miss = steps; break; }
      MM.fake.hands[hand].trig = false; C.run(0.05); hand = o; steps++;
    }
    r.climb = { rose: +(C.head().y - y0).toFixed(2), steps, spawns: C.spawns() - s0 };
    // one-hand pull also raises you
    const yp = C.head().y, st = MM.fake.hands[hand].p.slice(); C.run(0.4, t => { MM.fake.hands[hand].p = [st[0], st[1] - 0.4 * t / 0.4, st[2]]; }); r.onePull = +(C.head().y - yp).toFixed(2);
    C.run(0.6); r.afterPull = +(C.head().y - yp).toFixed(2); // still held up there, one hand
    r.vineHead = C.head().toArray().map(x => +x.toFixed(2));
    // charged jump off the vine onto the 6 m ledge
    MM.fake.a = true; C.run(2.61); MM.fake.a = false; MM.fake.hands[0].trig = MM.fake.hands[1].trig = false; MM.fake.hands[0].p = C.rot([-0.27, 0.98, -0.2], -Math.PI / 2); MM.fake.hands[1].p = C.rot([0.27, 0.98, -0.2], -Math.PI / 2);
    const l = C.land(); const L = CX.ledges[2]; r.longLedge = { ...l, on: !l.spawned && Math.abs(l.x - L.c.x) < L.h.x && Math.abs(l.y - (F + 3.9)) < 0.15 };
    // let go of the vine with both hands = fall
    C.resetVine(); C.stand(16.35, -72.8, -Math.PI / 2); MM.fake.hands[1].p = C.rot([0.18, 1.55, -0.6], -Math.PI / 2); MM.fake.hands[1].trig = true; C.run(0.2); MM.fake.a = true; C.run(2.03); MM.fake.a = false; C.run(1.0); r.heldBefore = MM.PH.hands[1].vine === C.vine();
    const sF = C.spawns(); MM.fake.hands[1].trig = false; let tf = 0; while (C.spawns() === sF && tf < 4) { MM.step(1 / 72); tf += 1 / 72; } r.letGo = +tf.toFixed(2);
    return r;
  });
  ok(!vine.gripOnly && vine.rightGrab, 'cliff vine: grip alone does not catch it, the RIGHT TRIGGER does (caught mid-jump from ledge 2)');
  ok(vine.closedR, 'pressing the right trigger closes the right hand (fingers + thumb curled), the left stays open');
  ok(vine.oneHand.spawns === 0 && vine.oneHand.holding && vine.oneHand.sag < 0.45 && vine.oneHand.swing < 0.6, `one hand on the vine is enough: hung 3 s on the right trigger alone, swinging (±${vine.oneHand.swing} m) but not falling`);
  ok(vine.leftGrab && vine.closedBoth, 'the LEFT trigger grabs the vine too, closing the left hand');
  ok(vine.climb.rose >= 3 && vine.climb.spawns === 0 && vine.onePull > 0.1 && vine.afterPull > 0.05, `hand-over-hand climb: ${vine.climb.rose} m in ${vine.climb.steps} grips; a single one-hand pull raises you ${vine.onePull} m and you stay up`);
  ok(vine.longLedge.on, 'charged jump off the vine lands on the 6 m x 1 m ledge: ' + JSON.stringify({ x: vine.longLedge.x, y: vine.longLedge.y, from: vine.vineHead }));
  ok(vine.heldBefore && Math.abs(vine.letGo - 2.0) < 0.1, `letting go with both hands = fall, respawn after ${vine.letGo} s`);
  // ---------- 7. darkness: each pillar barely visible from the one before ----------
  const dark = await p.evaluate(() => {
    const CX = MM.CX, r = [];
    const pairs = [[CX.ledgeZ + 0.5, CX.pillars[0].z + CX.PR], [CX.pillars[0].z, CX.pillars[1].z + CX.PR], [CX.pillars[1].z, CX.pillars[2].z + CX.PR], [CX.pillars[2].z, CX.endEdge]];
    for (const [z, tz] of pairs) { C.stand(3, z, 0); MM.render(); const f = MM.fogInfo(), h = C.head(), d = Math.hypot(h.z - tz, h.y - CX.F); r.push({ fog: +((d - f.near) / (f.far - f.near)).toFixed(2), d: +d.toFixed(2), col: f.color }); }
    C.stand(3, CX.pillars[1].z, 0); MM.render(); const ff = MM.fogInfo(); return { list: r, beyond: Math.hypot(CX.G + 2 * CX.PR + CX.PR, 1) > ff.far };
  });
  ok(dark.list.every(d => d.fog > 0.75 && d.fog < 0.95 && d.col === '000000') && dark.beyond, 'pitch-black chasm: the next pillar is barely visible (fog ' + dark.list.map(d => d.fog).join(' / ') + ' at its near edge), anything further is black');
  // ---------- 8. performance / culling ----------
  const perf = await p.evaluate(() => {
    const CX = MM.CX, out = {}, info = () => { MM.render(); const i = MM.renderer.info.render; return { calls: i.calls, tris: i.triangles }; };
    C.stand(0, 2, Math.PI); out.spawn = { ...info(), cave: MM.CXG.in.visible || MM.CXG.rt.visible || MM.CXG.out.visible };
    C.stand(3, -25.6, 0); out.wallCave = { ...info(), in: MM.CXG.in.visible, out: MM.CXG.out.visible };
    C.stand(3, -40, 0); out.bigCave = { ...info(), jungle: MM.scene.children.filter(o => o.visible && o.isMesh).length };
    C.stand(3, CX.pillars[1].z, 0); out.chasm = info();
    C.stand(15.9, -72.9, -Math.PI / 2); out.cliff = { ...info(), in: MM.CXG.in.visible };
    return out;
  });
  console.log('INFO render', JSON.stringify(perf));
  ok(!perf.spawn.cave && perf.wallCave.in && !perf.wallCave.out && !perf.cliff.in && perf.bigCave.calls <= perf.spawn.calls && perf.cliff.tris < 20000, 'cave system only drawn when near (hidden at spawn), jungle skipped deep inside, cliff view stays light');
  // ---------- 9. trigger hand pose syncs to other players ----------
  const MPctx = await b.newContext({ viewport: { width: 320, height: 200 } }); const room = 'CT' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const pages = [];
  for (const nm of ['Kong', 'Bongo']) { const q = await MPctx.newPage(); await q.addInitScript(LOCAL_TRANSPORT); await q.goto(URL); await q.waitForFunction(() => !!window.MM); await q.evaluate(HELPERS); await q.fill('#nameIn', nm); await q.fill('#roomIn', room); await q.evaluate(() => { document.getElementById('voiceIn').checked = false; }); await q.click('#playDesk'); await q.evaluate(() => { C.idle(0); }); pages.push(q); }
  const seen = await pages[1].waitForFunction(() => MM.remoteList().length > 0, null, { timeout: 15000 }).then(() => true).catch(() => false);
  await pages[0].evaluate(() => { MM.fake.hands[0].trig = true; });
  const g1 = await pages[1].waitForFunction(() => MM.remoteList()[0] && MM.remoteList()[0].grip === 1 ? 1 : 0, null, { timeout: 5000 }).then(() => 1).catch(() => 0);
  await pages[0].evaluate(() => { MM.fake.hands[0].trig = false; MM.fake.hands[1].trig = true; });
  const g2 = await pages[1].waitForFunction(() => MM.remoteList()[0] && MM.remoteList()[0].grip === 2 ? 1 : 0, null, { timeout: 5000 }).then(() => 1).catch(() => 0);
  await pages[0].evaluate(() => { MM.fake.hands[1].trig = false; });
  const g3 = await pages[1].waitForFunction(() => MM.remoteList()[0] && MM.remoteList()[0].grip === 0 ? 1 : 0, null, { timeout: 5000 }).then(() => 1).catch(() => 0);
  await pages[0].evaluate(() => { MM.fake.hands[1].p = [0.3, 1.45, -0.45]; MM.fake.a = true; });
  await pages[0].waitForTimeout(1300);
  const rem = await pages[1].evaluate(() => { const r = MM.remoteList()[0]; return { head: r.head, hands: r.hands }; });
  const chg = await pages[0].evaluate(() => ({ charging: MM.JUMP.charging, plant: MM.JUMP.plant.map(v => v.toArray()) }));
  await pages[0].evaluate(() => { MM.fake.a = false; MM.fake.hands[1].p = [0.27, 0.98, -0.2]; });
  const remPlanted = rem.hands.every((h, i) => Math.hypot(h[0] - chg.plant[i][0], h[1] - chg.plant[i][1], h[2] - chg.plant[i][2]) < 0.25);
  ok(chg.charging && remPlanted && rem.hands.every(h => h[1] < rem.head[1] - 0.5), 'other players see the charger with both hands planted on the ground too (no arm up at the controller) ' + JSON.stringify({ remote: rem.hands.map(h => h.map(v => +v.toFixed(2))), plant: chg.plant.map(h => h.map(v => +v.toFixed(2))) }));
  ok(seen && g1 && g2 && g3, 'closed/open hands sync over the network: the other player sees left trigger, right trigger, release (pose field 16)');
  await MPctx.close();
  // ---------- 10. Y menu: Sound, Debug, Restart, Exit, Resume ----------
  const menu = await p.evaluate(() => {
    const r = {}, CX = MM.CX, M = MM.MENU, J = MM.JUMP, T = MM.THREE;
    // real input path: left controller xr-standard buttons[5] = Y
    const btn = () => ({ pressed: false, touched: false, value: 0 });
    const mk = hand => ({ handedness: hand, gripSpace: { hand }, targetRaySpace: {}, profiles: ['oculus-touch-v3'], gamepad: { mapping: 'xr-standard', buttons: [0, 1, 2, 3, 4, 5, 6].map(btn), axes: [0, 0, 0, 0], hapticActuators: [] } });
    const Ls = mk('left'), Rs = mk('right'), pose = (p, q) => ({ transform: { position: { x: p[0], y: p[1], z: p[2] }, orientation: { x: q[0], y: q[1], z: q[2], w: q[3] } } });
    MM.fake = null; MM.xrSim = { ref: {}, session: { inputSources: [Ls, Rs] }, frame: { getViewerPose: () => pose([0, 1.6, 0], [0, 0, 0, 1]), getPose: s => pose(s.hand === 'left' ? [-0.27, 0.98, -0.2] : [0.27, 0.98, -0.2], [0, 0, 0, 1]) } };
    MM.place(0, MM.terrainH(0, 4) + 1.3, 4); C.run(0.5);
    const Y = on => { Ls.gamepad.buttons[5].pressed = on; Ls.gamepad.buttons[5].value = on ? 1 : 0; };
    Y(true); C.run(0.1); r.xrOpen = M.open; C.run(0.3); r.xrHeld = M.open; Y(false); C.run(0.1); Y(true); C.run(0.1); r.xrClose = !M.open; Y(false); C.run(0.1);
    Rs.gamepad.buttons[5].pressed = true; C.run(0.1); r.rightBDoesNothing = !M.open; Rs.gamepad.buttons[5].pressed = false; C.run(0.1);
    MM.xrSim = null;
    // open in front of where you look
    C.stand(0, 4, Math.PI / 2, MM.terrainH(0, 4)); MM.fake.y = true; C.run(0.05); MM.fake.y = false; C.run(0.05);
    const mp = M.mesh.getWorldPosition(new T.Vector3()), h = C.head(); r.place = { open: M.open, dist: +Math.hypot(mp.x - h.x, mp.z - h.z).toFixed(2), dx: +(mp.x - h.x).toFixed(2), dz: +(mp.z - h.z).toFixed(2), below: +(h.y - mp.y).toFixed(2) };
    // blocked while open: A charge, arm pushes
    const p0 = C.head(), n0 = J.count; MM.fake.a = true; C.run(1.0, t => { const off = Math.sin(t * 12) * 0.4; MM.fake.hands[0].p = C.rot([-0.3, 0.55, off], Math.PI / 2); MM.fake.hands[1].p = C.rot([0.3, 0.55, off], Math.PI / 2); });
    r.blocked = { charging: J.charging, jumps: J.count - n0, moved: +Math.hypot(C.head().x - p0.x, C.head().z - p0.z).toFixed(3) };
    MM.fake.hands[0].p = C.rot([-0.27, 0.98, -0.2], Math.PI / 2); MM.fake.hands[1].p = C.rot([0.27, 0.98, -0.2], Math.PI / 2); C.run(0.1);
    // touch buttons
    const touch = (hand, id) => { C.handTo(hand, MM.menuBtnW(id)); C.run(0.15); const rest = hand ? [0.27, 0.98, -0.2] : [-0.27, 0.98, -0.2]; MM.fake.hands[hand].p = C.rot(rest, Math.PI / 2); C.run(0.45); };
    const d0 = MM.DBG.on; touch(1, 'debug'); r.debugR = MM.DBG.on !== d0; r.debugSaved = localStorage.getItem('mmcave_debug'); touch(0, 'debug'); r.debugL = MM.DBG.on === d0;
    const c0 = M.count; C.handTo(1, MM.menuBtnW('debug')); C.run(1.0); r.heldOnce = M.count - c0; MM.fake.hands[1].p = C.rot([0.27, 0.98, -0.2], Math.PI / 2); C.run(0.45); if (MM.DBG.on !== d0) MM.dbgSet(d0);
    const m0 = MM.MUSIC.on; touch(1, 'music'); r.music = { on: MM.MUSIC.on, was: m0, saved: localStorage.getItem('mmcave_music'), gain: MM.AU.master ? MM.AU.master.gain.value : null, voiceBus: !!MM.AU.out }; touch(1, 'music'); r.musicBack = { on: MM.MUSIC.on, gain: MM.AU.master ? MM.AU.master.gain.value : null };
    touch(0, 'resume'); r.resume = !M.open;
    // closing with A still held does not start a charge until A is released
    MM.fake.y = true; C.run(0.05); MM.fake.y = false; MM.fake.a = true; C.run(0.2); MM.fake.y = true; C.run(0.05); MM.fake.y = false; C.run(0.5); r.closeHeldA = J.charging; MM.fake.a = false; C.run(0.1); MM.fake.a = true; C.run(0.3); r.afterRelease = J.charging; MM.fake.a = false; C.run(0.05); C.land();
    // restart from deep in the cave: back at spawn, bananas kept
    C.stand(3, -40, 0); MM.ME.bananas = 7; const s0 = C.spawns(); MM.fake.y = true; C.run(0.05); MM.fake.y = false; C.run(0.4); touch(1, 'restart'); const hs = C.head();
    r.restart = { spawned: C.spawns() - s0, atSpawn: Math.hypot(hs.x, hs.z) < 2 && hs.y < 3, bananas: MM.ME.bananas, closed: !M.open };
    C.run(2.5); r.noFallAfter = C.spawns() - s0;
    // exit -> landing page
    MM.fake.y = true; C.run(0.05); MM.fake.y = false; C.run(0.4); r.menuForShot = M.open;
    return r;
  });
  await p.evaluate(() => { MM.PH.freeze = true; MM.render(); }); await p.screenshot({ path: SHOTS + 'cave_menu.png' }); await p.evaluate(() => { MM.PH.freeze = false; });
  const exitR = await p.evaluate(() => { C.handTo(0, MM.menuBtnW('exit')); C.run(0.2); return { landing: !document.getElementById('landing').classList.contains('hidden'), playing: MM.GAME.playing, open: MM.MENU.open }; });
  ok(menu.xrOpen && menu.xrHeld && menu.xrClose && menu.rightBDoesNothing, 'Y (left controller, xr-standard buttons[5], real input path) opens and closes the menu; holding does not flicker; B on the right does nothing');
  ok(menu.place.open && Math.abs(menu.place.dist - 0.55) < 0.05 && menu.place.dx < -0.5 && Math.abs(menu.place.dz) < 0.05 && menu.place.below > 0.05 && menu.place.below < 0.2, 'menu opens 0.55 m in front of where you look, slightly below eye level ' + JSON.stringify(menu.place));
  ok(!menu.blocked.charging && menu.blocked.jumps === 0 && menu.blocked.moved < 0.03, 'while the menu is open A does not charge/jump and arm pushes do not move you ' + JSON.stringify(menu.blocked));
  ok(menu.debugR && menu.debugSaved !== null && menu.debugL && menu.heldOnce === 1, 'Debug: touching it with the right or the left hand toggles the debug overlay (same saved state as the wrist button); holding a hand on it toggles once');
  ok(menu.music.on === !menu.music.was && menu.music.saved === (menu.music.on ? '1' : '0') && (menu.music.gain === null || menu.music.gain === (menu.music.on ? 0.9 : 0)) && menu.music.voiceBus && menu.musicBack.on === menu.music.was, 'Sound: toggles all game sound (no music track exists; voice chat on its own bus), remembered in localStorage ' + JSON.stringify([menu.music, menu.musicBack]));
  ok(menu.resume, 'Resume closes the menu');
  ok(!menu.closeHeldA && menu.afterRelease, 'closing the menu with A still held does not start a charge; release and press again does');
  ok(menu.restart.spawned === 1 && menu.restart.atSpawn && menu.restart.bananas === 7 && menu.restart.closed && menu.noFallAfter === 1, 'Restart: back at spawn from deep in the cave, bananas kept, menu closed, no stray fall-respawn afterwards ' + JSON.stringify(menu.restart));
  ok(exitR.landing && !exitR.playing && !exitR.open, 'Exit: leaves the game to the landing page (on the headset it ends the VR session)');
  await p.click('#playDesk'); await p.waitForTimeout(400); await p.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('hint').style.display = 'none'; MM.paused = true; });
  // ---------- shots ----------
  const shot = async (name, pos, yaw, pitch, hands, extra) => { await p.evaluate(([pos, yaw, pitch, hands, extra]) => { MM.timeOverride = 0.25; MM.PH.freeze = true; MM.fake = { head: [0, 1.6, 0], headQ: C.q(yaw, pitch), hands: hands || [{ p: C.rot([-0.25, 0.95, 0.2], yaw) }, { p: C.rot([0.25, 0.95, 0.2], yaw) }] }; if (extra) Object.assign(MM.fake, extra); MM.place(...pos); MM.step(1 / 72); MM.render(); }, [pos, yaw, pitch, hands, extra]); await p.screenshot({ path: SHOTS + name }); };
  const F = await p.evaluate(() => MM.CX.F), HH = F + 1.25;
  // cave mouth darkness: from any distance / angle / time of day the wall-cave opening reads near-black (no sky colour through it)
  const look = async (name, eye, target, tod) => {
    const r = await p.evaluate(([eye, target, tod]) => {
      MM.timeOverride = tod; MM.PH.freeze = true; const T = MM.THREE, yaw = Math.atan2(-(target[0] - eye[0]), -(target[2] - eye[2])), pitch = Math.atan2(target[1] - eye[1], Math.hypot(target[0] - eye[0], target[2] - eye[2]));
      MM.fake = { head: [0, 1.6, 0], headQ: C.q(yaw, pitch), hands: [{ p: [-0.27, -3, 0.3] }, { p: [0.27, -3, 0.3] }] }; MM.place(...eye); MM.step(1 / 72); MM.render(); MM.render();
      const cv = MM.renderer.domElement, c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; const x = c2.getContext('2d'); x.drawImage(cv, 0, 0);
      const k = MM.CAVES[1], pts = []; for (const [u, v] of [[0, 0], [-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]]) pts.push(new T.Vector3(k.c.x + u * (k.h.x - 0.2), k.c.y + v * (k.h.y - 0.2), -HALF_Z + 0.02));
      const cam = MM.camera; cam.updateMatrixWorld(true); const out = [];
      for (const w of pts) { const s = w.clone().project(cam); if (Math.abs(s.x) > 0.98 || Math.abs(s.y) > 0.98 || s.z > 1) continue; const px = Math.round((s.x + 1) / 2 * cv.width), py = Math.round((1 - s.y) / 2 * cv.height); const d = x.getImageData(px, py, 1, 1).data; out.push([d[0], d[1], d[2]]); }
      const sky = MM.scene.background.clone().convertLinearToSRGB(); return { px: out, lum: out.map(c => Math.max(...c)), sky: [sky.r, sky.g, sky.b].map(v => Math.round(255 * v)) };
      function noop() { }
    }, [eye, target, tod]);
    await p.screenshot({ path: SHOTS + name }); return r;
  };
  await p.evaluate(() => { window.HALF_Z = MM.HALF; });
  const MOUTH = [3, 7.2, -25];
  const mouth = {};
  mouth.day = await look('cave_mouth_day.png', [2, 4, 12], MOUTH, 0.25);
  mouth.dusk = await look('cave_mouth_dusk.png', [2, 4, 12], MOUTH, 0.49);
  mouth.night = await look('cave_mouth_night.png', [2, 4, 12], MOUTH, 0.75);
  mouth.left = await look('cave_mouth_left_steep.png', [-19, 4, -21], MOUTH, 0.49);
  mouth.right = await look('cave_mouth_right_steep.png', [23, 4, -21.5], MOUTH, 0.49);
  mouth.below = await look('cave_mouth_below.png', [3, 3.2, -22.6], MOUTH, 0.49);
  mouth.above = await look('cave_mouth_above.png', [3, 13, -19], MOUTH, 0.25);
  mouth.near = await look('cave_mouth_near.png', [3, 7.3, -19.5], MOUTH, 0.49);
  ok(Object.values(mouth).every(m => m.lum.length >= 3 && m.lum.filter(l => l < 40).length >= m.lum.length - 1 && (Math.max(...m.sky) < 120 || m.px.every(c => Math.hypot(c[0] - m.sky[0], c[1] - m.sky[1], c[2] - m.sky[2]) > 90))), 'wall-cave opening reads near-black from every distance / angle / time of day, never sky-coloured (max channel of 5 opening pixels; a banana in the cave may light one; dusk sky ' + mouth.dusk.sky + '): ' + JSON.stringify(Object.fromEntries(Object.entries(mouth).map(([k, m]) => [k, m.lum]))));
  // looking off the big cave ledge into the chasm
  await shot('cave_ledge_off.png', [3, F + 1.25, MM_LEDGE_Z + 0.25], 0, -0.75);
  await shot('cave_tunnel.png', [3, HH, -26.2], 0, 0.02);
  await shot('cave_big.png', [3, HH + 0.3, -35.5], 0.25, 0.12);
  await shot('cave_ledge_pillar.png', [3, HH, MM_LEDGE_Z + 0.4], 0, -0.18);
  await shot('cave_pillar_next.png', [3, HH, -53], 0, -0.15);
  await shot('cave_exit.png', [8.4, HH, -72], -Math.PI / 2 - 0.12, -0.08, [{ p: C_rot([-0.22, 1.05, -0.45], -Math.PI / 2 - 0.12) }, { p: C_rot([0.22, 1.05, -0.45], -Math.PI / 2 - 0.12) }]);
  await shot('cave_cliff_down.png', [11.0, HH, -71.2], -Math.PI / 2 + 0.6, -0.7);
  await shot('cave_vine.png', [16.2, HH, -72.7], -Math.PI / 2 + 0.05, 0.25, [{ p: C_rot([-0.2, 1.1, -0.4], -Math.PI / 2), trig: false }, { p: C_rot([0.1, 1.5, -0.5], -Math.PI / 2), trig: true }]);
  await shot('cave_long_ledge.png', [20.4, HH + 3, -72.9], -Math.PI / 2, -0.12);
  await shot('cave_hands_closed.png', [20.4, HH + 3, -72.9], -Math.PI / 2, -0.55, [{ p: C_rot([-0.2, 1.2, -0.42], -Math.PI / 2), trig: true }, { p: C_rot([0.2, 1.2, -0.42], -Math.PI / 2), trig: false }]);
  await p.evaluate(() => { MM.PH.freeze = false; C.stand(0, 4, 0, MM.terrainH(0, 4)); MM.fake.headQ = C.q(0, -0.6); MM.fake.a = true; C.run(2.5); MM.render(); });
  await p.screenshot({ path: SHOTS + 'cave_jump_charge.png' });
  await p.evaluate(() => { MM.fake.a = false; C.run(0.05); MM.render(); });
  await b.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
function C_rot(o, yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); return [o[0] * c + o[2] * s, o[1], -o[0] * s + o[2] * c]; }
var MM_LEDGE_Z = -48;
