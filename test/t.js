// Primate Chaos test suite. Run one at a time: flock /workspace/.browser-test.lock node test/t.js
const { chromium } = require('/workspace/strike/node_modules/playwright');
const URL = process.env.MM_URL || 'http://127.0.0.1:8765/index.html';
const MM_RELAYS_N = 6, MM_MIRROR_X = -5.2;
const SHOTS = __dirname + '/../shots/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const HELPERS = () => {
  window.T = {
    H: [0, 1.6, 0],
    set(oL, oR, gL = false, gR = false) { const h = T.H; MM.fake = { head: h, hands: [{ p: [h[0] + oL[0], h[1] + oL[1], h[2] + oL[2]], grip: gL }, { p: [h[0] + oR[0], h[1] + oR[1], h[2] + oR[2]], grip: gR }] }; },
    run(sec, fn) { const n = Math.round(sec * 72); for (let i = 0; i < n; i++) { if (fn) fn(i / 72); MM.step(1 / 72); } },
    idle() { T.set([-0.27, -0.62, -0.2], [0.27, -0.62, -0.2]); },
    climb(dir, cycles, onStep) { // alternate grip-reach-pull toward a surface in direction dir=[x,z]
      const [dx, dz] = dir; let maxY = -1e9; const R = (i, f, y) => { const s = i ? 0.2 : -0.2; return [dx * f - dz * s, y, dz * f + dx * s]; };
      for (let c = 0; c < cycles; c++) for (const a of [0, 1]) {
        T.run(0.33, t => { const k = t / 0.33; const act = R(a, 0.62 - 0.12 * k, 0.35 - 0.75 * k), ina = R(1 - a, 0.05, -0.4 + 0.75 * k);
          if (a === 0) T.set(act, ina, true, false); else T.set(ina, act, false, true); maxY = Math.max(maxY, MM.headW().y); if (onStep) onStep(); });
      }
      return maxY;
    },
    hw(i) { return MM.handsW()[i]; },
    handTo(i, w) { const P = MM.rig.position; const f = MM.fake; f.hands[i].p = [w[0] - P.x, w[1] - P.y + MM.HAND_DROP, w[2] - P.z]; }, // fake = controller pose; virtual hand sits HAND_DROP lower
  };
};

// Local stand-in for Trystero used ONLY in the multiplayer logic test: this box's Chrome policy blocks
// non-proxied UDP, so real WebRTC data channels can't open here. Same API surface as Trystero's joinRoom.
const LOCAL_TRANSPORT = () => {
  const selfId = 'p' + Math.random().toString(36).slice(2, 10);
  window.__MM_TRANSPORT__ = { selfId, joinRoom(cfg, roomId) {
    const bc = new BroadcastChannel('mmtest-' + roomId), peers = new Set(), acts = {}, L = { join: () => {}, leave: () => {}, stream: () => {} };
    const post = m => bc.postMessage({ ...m, from: selfId });
    const add = id => { if (!peers.has(id)) { peers.add(id); setTimeout(() => L.join(id), 0); } };
    bc.onmessage = ({ data: m }) => {
      if (m.from === selfId || (m.to && m.to !== selfId)) return;
      if (m.type === 'hello') { add(m.from); post({ type: 'ack', to: m.from }); }
      else if (m.type === 'ack') add(m.from);
      else if (m.type === 'leave') { peers.delete(m.from); L.leave(m.from); }
      else if (m.type === 'act' && peers.has(m.from)) (acts[m.action] || (() => {}))(m.data, m.from);
      else if (m.type === 'stream') { // synthesise the remote mic as a test tone stream
        const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); L.stream(d.stream, m.from); }
    };
    setTimeout(() => post({ type: 'hello' }), 50);
    return {
      makeAction: name => [(data, to) => post({ type: 'act', action: name, data, to: Array.isArray(to) ? to[0] : to }), cb => { acts[name] = cb; }],
      onPeerJoin: f => L.join = f, onPeerLeave: f => L.leave = f, onPeerStream: f => L.stream = f,
      addStream: (s, to) => post({ type: 'stream', to }), leave: () => post({ type: 'leave' }), getPeers: () => [...peers],
    };
  } };
};
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const vp = { width: 640, height: 400 };
  async function open(ctxOpts = {}, name, denyMic) {
    const ctx = await b.newContext({ viewport: vp, ...ctxOpts }); const p = await ctx.newPage(); const errs = [];
    if (denyMic) await p.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); });
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    await p.goto(URL); await p.waitForFunction(() => !!window.MM, null, { timeout: 30000 }); await p.evaluate(HELPERS);
    if (name) await p.fill('#nameIn', name);
    return { ctx, p, errs };
  }
  // ===== single player, scripted fake XR =====
  const A = await open({}, 'Tester', true);
  await A.p.waitForTimeout(800);
  ok(A.errs.length === 0, 'loads with no console errors on landing ' + JSON.stringify(A.errs));
  ok(await A.p.evaluate(() => document.querySelector('h1').textContent.includes('PRIMATE CHAOS') && !!document.getElementById('enterVR') && document.getElementById('roomCode').textContent === 'PUBLIC' && /^Tester$/.test(document.getElementById('nameIn').value)), 'landing: title, Enter VR button, room code, name field');
  const pwa = await A.p.evaluate(async () => { const m = await (await fetch(document.querySelector('link[rel=manifest]').href)).json(); const sizes = [], opaque = [], greens = [], bust = []; for (const i of m.icons) { const img = new Image(); img.src = new URL(i.src, document.baseURI).href; await img.decode(); sizes.push(img.naturalWidth + 'x' + img.naturalHeight + ':' + i.purpose); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let transp = 0, green = 0; for (let k = 0; k < d.length; k += 4) { if (d[k + 3] < 255) transp++; if (d[k + 1] > d[k] + 30 && d[k + 1] > d[k + 2] + 30) green++; } opaque.push(transp); greens.push(green); bust.push(/[?]v=/.test(i.src)); } const at = new Image(); at.src = document.querySelector('link[rel=apple-touch-icon]').href; await at.decode(); return { name: m.name, short: m.short_name, start: m.start_url, display: m.display, sizes, apple: at.naturalWidth, theme: !!document.querySelector('meta[name=theme-color]'), fav: (await fetch('favicon.ico')).ok, opaque, greens, bust, theme2: m.theme_color + m.background_color }; });
  ok(pwa.opaque.every(n => n === 0) && pwa.greens.every(n => n === 0) && pwa.bust.every(Boolean) && !/#[0-9a-f]{2}[89a-f][0-9a-f][0-9a-f]{2}/i.test(pwa.theme2.replace(/#2e2d31/gi, '')), `app icons are full-bleed opaque squares with no green, URLs cache-busted (transparent px ${pwa.opaque.join('/')}, green px ${pwa.greens.join('/')})`);
  ok(pwa.name === 'Primate Chaos' && pwa.short === 'Primate Chaos' && pwa.start === './' && /standalone|fullscreen/.test(pwa.display) && pwa.sizes.join() === '192x192:any,512x512:any,512x512:maskable' && pwa.apple === 180 && pwa.theme && pwa.fav, `home-screen app icons + manifest load (${pwa.sizes.join(', ')}, apple-touch ${pwa.apple}px, favicon)`);
  ok(await A.p.evaluate(() => /^Monkey\d{3}$/.test(localStorage.getItem('mm_name') || 'Monkey123')), 'random default name format MonkeyNNN');
  await A.p.screenshot({ path: SHOTS + 'landing.png' });
  // offline/solo: block the signalling module so no network join happens for the single-player part
  await A.p.evaluate(() => { document.getElementById('roomIn').value = 'SOLO' + Math.random().toString(36).slice(2, 7); });
  await A.p.click('#playDesk'); await A.p.waitForTimeout(1500);
  ok(await A.p.evaluate(() => MM.GAME.playing && MM.VOICE.denied), 'desktop play starts; mic denied (no permission) is handled, game still runs');
  ok(await A.p.evaluate(() => MM.NET.mode === 'solo'), 'solo free play when alone');
  const loco = await A.p.evaluate(() => {
    MM.paused = true; T.idle(); MM.place(0, MM.terrainH(0, 0) + 0.95, 0); T.run(0.6);
    const s = MM.headW(); const out = { z0: s.z, y0: s.y };
    for (let c = 0; c < 4; c++) {
      T.set([-0.25, -0.6, -0.45], [0.25, -0.6, -0.45]); T.run(0.08);
      T.set([-0.25, -0.98, -0.45], [0.25, -0.98, -0.45]); T.run(0.08);
      T.run(0.3, t => { const z = -0.45 + (t / 0.3) * 0.9; T.set([-0.25, -0.98, z], [0.25, -0.98, z]); });
      T.set([-0.25, -0.55, 0.45], [0.25, -0.55, 0.45]); T.run(0.12);
    }
    T.idle(); T.run(1.8); out.z1 = MM.headW().z; // lower virtual hands push a bit longer: let the glide settle
    // arms idle, no input: must not move
    const z2 = MM.headW().z; T.run(1); out.drift = Math.abs(MM.headW().z - z2);
    // push down hard = jump
    T.set([-0.25, -0.86, -0.2], [0.25, -0.86, -0.2]); T.run(0.1); const yb = MM.headW().y;
    T.run(0.1, t => { const y = -0.86 - (t / 0.1) * 0.5; T.set([-0.25, y, -0.2], [0.25, y, -0.2]); });
    T.set([-0.25, -0.3, -0.2], [0.25, -0.3, -0.2]); let my = -9; T.run(1.2, () => my = Math.max(my, MM.headW().y)); out.jump = my - yb;
    return out;
  });
  ok(loco.z0 - loco.z1 > 1.5, `hand-push locomotion moves the player forward ${(loco.z0 - loco.z1).toFixed(2)} m in 4 arm strokes`);
  ok(loco.drift < 0.02, `no movement without arm swings (drift ${loco.drift.toFixed(3)} m)`);
  const wr = await A.p.evaluate(() => {
    const r = {}; MM.PH.freeze = true; T.idle(); MM.step(1 / 72); r.def = MM.wristShown();
    const click = () => { MM.fake.hands[0].stick = true; MM.step(1 / 72); const held = MM.wristShown(); MM.step(1 / 72); MM.step(1 / 72); const stillHeld = MM.wristShown(); MM.fake.hands[0].stick = false; MM.step(1 / 72); return [held, stillHeld]; };
    // hidden: touching where the mic dot would be does nothing
    const b = MM.muteBtnW(), P = MM.rig.position, m0 = MM.VOICE.muted; MM.fake.hands[1].p = [b[0] - P.x, b[1] - P.y + MM.HAND_DROP, b[2] - P.z]; MM.step(1 / 72); MM.step(1 / 72); r.hiddenNoMute = MM.VOICE.muted === m0; T.idle(); MM.step(1 / 72);
    r.c1 = click(); r.c2 = click(); r.right = (() => { MM.fake.hands[1].stick = true; MM.step(1 / 72); const v = MM.wristShown(); MM.fake.hands[1].stick = false; MM.step(1 / 72); return v; })();
    MM.PH.freeze = false; return r;
  });
  ok(!wr.def && wr.hiddenNoMute, 'wrist info panel and mic dot are hidden by default (and the hidden dot can\'t be bumped)');
  ok(wr.c1[0] && wr.c1[1] && !wr.c2[0] && !wr.c2[1] && !wr.right, 'left thumbstick click toggles the wrist panel + mic dot (edge-triggered: holding doesn\'t flicker; right stick does nothing)');
  { // headset battery on the wrist panel (mocked Battery Status API; and a browser without it)
    const MOCK = () => { const b = new EventTarget(); b.level = 0.87; b.charging = false; window.__batt = b; navigator.getBattery = () => Promise.resolve(b); };
    const NOAPI = () => { Object.defineProperty(Navigator.prototype, 'getBattery', { value: undefined, configurable: true }); };
    const res = [];
    for (const init of [MOCK, NOAPI]) {
      const c = await b.newContext({ viewport: { width: 320, height: 200 } }); const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.addInitScript(init); await p.goto(URL); await p.waitForFunction(() => !!window.MM); await p.waitForTimeout(200);
      res.push(await p.evaluate(async () => { const r = { t0: MM.BATT.text, api: MM.BATT.api }; if (window.__batt) { __batt.level = 0.42; __batt.dispatchEvent(new Event('levelchange')); r.t1 = MM.BATT.text; __batt.charging = true; __batt.dispatchEvent(new Event('chargingchange')); r.t2 = MM.BATT.text; } MM.drawWrist(); return r; }));
      res[res.length - 1].errs = errs; await c.close();
    }
    ok(res[0].api && res[0].t0 === 'Battery 87%' && res[0].t1 === 'Battery 42%' && res[0].t2 === 'Battery 42% (charging)' && !res[0].errs.length, `wrist panel shows headset battery and updates on level/charging events (${res[0].t0} -> ${res[0].t1} -> ${res[0].t2})`);
    ok(!res[1].api && res[1].t0 === 'Battery --' && !res[1].errs.length, 'no Battery API: wrist panel shows "Battery --" without errors');
  }
  ok(loco.jump > 0.35, `push down + release launches a jump (+${loco.jump.toFixed(2)} m)`);
  const climb = await A.p.evaluate(() => {
    const r = {}; const g = MM.terrainH;
    // tree (T4), approached from -x
    const t = MM.TREES[3]; MM.place(t.x - 1.6, g(t.x - 1.6, t.z) + 0.95, t.z); T.idle(); T.run(0.4); const y0 = MM.headW().y; r.tree = T.climb([1, 0], 9) - y0;
    // T1 (course tree) from the north-west side, past the start pad height
    const t1 = MM.TREES[0], a = -2.2, px = t1.x + Math.cos(a) * 1.62, pz = t1.z + Math.sin(a) * 1.62; MM.place(px, g(px, pz) + 0.95, pz); T.idle(); T.run(0.4);
    r.t1 = T.climb([-Math.cos(a), -Math.sin(a)], 16); r.padTop = MM.COURSE.start.c.y + MM.COURSE.start.h.y;
    // lower wall (west) from the ground: climbs, but stops near the smooth upper half
    MM.place(-24.5, g(-24.5, 4) + 0.95, 4); T.idle(); T.run(0.4); const w0 = MM.headW().y; r.wall0 = w0; r.wallMax = T.climb([-1, 0], 28); r.wallEnd = MM.headW().y;
    // upper wall: start hanging at 12 m against the smooth section, try to climb → slide/fall
    const s0 = MM.stats.slips; MM.place(-24.5, 13.5, -4); T.idle(); const u0 = MM.headW().y; let anch = 0; const um = T.climb([-1, 0], 1, () => { if (MM.PH.anyAnch) anch++; }); r.upperDrop = u0 - MM.headW().y; r.upperAnch = anch; r.upperMax = um - u0; r.slips = MM.stats.slips - s0;
    return r;
  });
  ok(climb.tree > 3, `grip-climbing a tree trunk gains ${climb.tree.toFixed(2)} m`);
  ok(climb.t1 > climb.padTop + 0.8, `course tree climbable from the ground to above the start pad (head ${climb.t1.toFixed(2)} m, pad top ${climb.padTop.toFixed(2)} m)`);
  ok(climb.wallMax - climb.wall0 > 4, `lower rock wall is climbable (+${(climb.wallMax - climb.wall0).toFixed(2)} m)`);
  ok(climb.wallMax < 10.6, `climbing stops at the smooth upper half (max head height ${climb.wallMax.toFixed(2)} m, climbable to ${9} m, wall 18 m)`);
  ok(climb.upperAnch === 0 && climb.upperDrop > 1 && climb.slips > 0 && climb.upperMax < 0.05, `upper wall can't be grabbed: 0 anchors, slid down ${climb.upperDrop.toFixed(2)} m (${climb.slips} slip contacts)`);
  const vine = await A.p.evaluate(() => {
    const v = MM.VINES[2]; const q = v.q.clone(); MM.place(q.x - 0.45, q.y + 0.2, q.z); T.set([-0.27, -0.62, -0.2], [0.45, -0.1, 0], false, true);
    MM.PH.V.set(0, 0, 2.5); MM.step(1 / 72);
    const grabbed = MM.PH.hands[1].vine === v; let minY = 99, zs = [], vz = [];
    T.run(3, () => { const h = MM.headW(); minY = Math.min(minY, h.y); zs.push(h.z); vz.push(v.q.z); });
    const relV = MM.PH.V.length(); T.set([-0.27, -0.62, -0.2], [0.45, -0.1, 0], false, false); MM.step(1 / 72); const afterV = MM.PH.V.length(); const released = !MM.PH.hands[1].vine;
    return { grabbed, minY, ground: MM.terrainH(q.x, q.z), zr: Math.max(...zs) - Math.min(...zs), vr: Math.max(...vz) - Math.min(...vz), relV, afterV, released, grabs: MM.stats.vineGrabs };
  });
  ok(vine.grabbed && vine.grabs > 0, 'grip on a vine grabs it');
  ok(vine.minY > vine.ground + 1.2, `hanging from the vine keeps the player off the ground (min head ${vine.minY.toFixed(2)} m)`);
  ok(vine.zr > 1 && vine.vr > 1, `vine swings physically with the player (player swing ${vine.zr.toFixed(2)} m, vine end ${vine.vr.toFixed(2)} m)`);
  ok(vine.released && vine.afterV > 0.3, `letting go keeps swing momentum (${vine.afterV.toFixed(2)} m/s)`);
  const ban = await A.p.evaluate(() => {
    const w0 = MM.SHOP.wallet; MM.PH.freeze = true; const b = MM.BANANAS[0]; MM.place(b.p.x, MM.terrainH(b.p.x, b.p.z) + 0.95, b.p.z + 0.6); T.idle(); MM.step(1 / 72); const n0 = MM.ME.bananas;
    T.handTo(1, b.p.toArray()); MM.step(1 / 72); const n1 = MM.ME.bananas; const gone = !b.alive; MM.step(1 / 72); const n2 = MM.ME.bananas;
    const b2 = MM.BANANAS[5]; T.idle(); MM.place(b2.p.x, b2.p.y, b2.p.z); MM.step(1 / 72); const n3 = MM.ME.bananas; MM.PH.freeze = false;
    return { n0, n1, n2, n3, gone, w0, w3: MM.SHOP.wallet, lsw: +localStorage.getItem('mm_wallet'), hud: document.getElementById('hud').textContent };
  });
  ok(ban.n1 === ban.n0 + 1 && ban.gone && ban.n2 === ban.n1, `banana collects on hand touch (counter ${ban.n0}→${ban.n1}), only once`);
  ok(ban.n3 === ban.n2 + 1, 'banana collects by head touch too');
  ok(ban.w3 === ban.w0 + 2 && ban.lsw === ban.w3, `collected bananas also go into the persistent shop wallet (${ban.w0}→${ban.w3}, saved in localStorage)`);
  const course = await A.p.evaluate(() => {
    localStorage.removeItem('mm_course_best'); MM.COURSE_S.best = null;
    const C = MM.COURSE, s = C.start, f = C.finish; const r = {};
    // gap check along the course: every hop ≤ 1.6 m (beam end→vine, vine swing→platform etc.)
    const v1 = MM.VINES[0], v2 = MM.VINES[1]; const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    r.gaps = [d2(C.beams[0][1], v1.q), d2(v1.q, C.mid.c) - C.mid.h.x, d2(C.beams[1][1], v2.q), d2(v2.q, f.c) - f.h.x];
    r.vineBottoms = [v1.q.y, v2.q.y];
    T.idle(); MM.place(s.c.x, s.c.y + s.h.y + 0.92, s.c.z); T.run(0.3); r.ready = MM.COURSE_S.state;
    MM.place(s.c.x + 1.6, s.c.y + s.h.y + 1.3, s.c.z - 0.2); MM.PH.freeze = true; MM.step(1 / 72); r.running = MM.COURSE_S.state;
    const t0 = performance.now(); while (performance.now() - t0 < 700) { } MM.step(1 / 72);
    MM.PH.freeze = false; MM.place(f.c.x, f.c.y + f.h.y + 0.92, f.c.z); T.run(0.2); r.done = MM.COURSE_S.state; r.best = MM.COURSE_S.best; r.ls = localStorage.getItem('mm_course_best');
    MM.render(); r.sign = MM.signText;
    // falling to the ground cancels a run
    MM.place(s.c.x, s.c.y + s.h.y + 0.92, s.c.z); T.run(0.2); MM.place(s.c.x + 1.6, 1.0, s.c.z + 1.5); T.run(0.3); r.fell = MM.COURSE_S.state + ' / ' + MM.COURSE_S.msg;
    return r;
  });
  ok(course.ready === 'ready' && course.running === 'running' && course.done === 'done', `canopy course: start pad → timer running → finish pad (${course.ready}/${course.running}/${course.done})`);
  ok(course.best > 0.5 && course.ls && Math.abs(parseFloat(course.ls) - course.best) < 0.01, `best time saved to localStorage (${course.ls}s)`);
  ok(course.sign && course.sign[1].startsWith('Best: ' + course.best.toFixed(2)), 'sign shows last/best time: ' + JSON.stringify(course.sign));
  ok(course.gaps.every(g => g < 1.6), 'course hops are all within reach/swing: ' + course.gaps.map(g => g.toFixed(2)).join(', ') + ' m');
  ok(/idle/.test(course.fell), 'falling to the ground cancels the run: ' + course.fell);
  const daynight = await A.p.evaluate(() => {
    const r = {}; MM.timeOverride = 0.25; MM.render(); r.noon = { sun: MM.sunVisible(), moon: MM.moonVisible(), ff: MM.firefliesOp(), sunI: MM.sunI(), fog: MM.fogColor() };
    MM.timeOverride = 0.75; MM.render(); r.night = { sun: MM.sunVisible(), moon: MM.moonVisible(), ff: MM.firefliesOp(), sunI: MM.sunI(), fog: MM.fogColor() };
    MM.timeOverride = 0.5; MM.render(); r.dusk = MM.fogColor();
    MM.timeOverride = 0.25; MM.render(); r.noon.sky = MM.skyColor(); r.noon.stars = MM.starsOp(); MM.timeOverride = 0.75; MM.render(); r.night.sky = MM.skyColor(); r.night.stars = MM.starsOp(); r.starR = MM.stars.geometry.boundingSphere ? MM.stars.geometry.boundingSphere.radius : (MM.stars.geometry.computeBoundingSphere(), MM.stars.geometry.boundingSphere.radius); r.starN = MM.stars.geometry.attributes.position.count; r.far = MM.camera.far; r.fogFar = MM.scene.fog.far; MM.timeOverride = 0.5; MM.render(); r.duskSky = MM.skyColor(); r.duskStars = MM.starsOp(); r.skyMeshes = 0; MM.scene.traverse(o => { if (o.isMesh && o.material && o.material.side === MM.THREE.BackSide) r.skyMeshes++; });
    r.additiveMeshes = []; MM.scene.traverse(o => { if (o.isMesh && o.material && o.material.blending === MM.THREE.AdditiveBlending) r.additiveMeshes.push(o.geometry.type); }); r.raysApi = typeof MM.raysOp;
    MM.timeOverride = null; MM.render(); r.phase = MM.DAY.phase; r.expected = ((Date.now() / 1000) % 600) / 600;
    const b0 = MM.birdPos(), u0 = MM.butterPos(); const t0 = performance.now(); while (performance.now() - t0 < 300) { } MM.render(); r.birdMoved = Math.hypot(...MM.birdPos().map((v, i) => v - b0[i])); r.butterMoved = Math.hypot(...MM.butterPos().map((v, i) => v - u0[i])); r.birdY = b0[1];
    return r;
  });
  ok(daynight.noon.sun && !daynight.noon.moon && daynight.noon.ff === 0 && daynight.night.moon && !daynight.night.sun && daynight.night.ff > 0.9, 'day/night: sun by day; moon + glowing fireflies at night');
  ok(daynight.additiveMeshes.length === 0 && daynight.raysApi === 'undefined', `sun shafts / god rays removed (additive meshes in scene: ${daynight.additiveMeshes.length})`);
  ok(daynight.night.sunI < daynight.noon.sunI / 3 && daynight.noon.fog !== daynight.night.fog && daynight.dusk !== daynight.noon.fog, `sky, fog and light change (sun ${daynight.noon.sunI.toFixed(2)}→${daynight.night.sunI.toFixed(2)}, fog #${daynight.noon.fog}→#${daynight.night.fog}, dusk #${daynight.dusk})`);
  const lum = h => { const v = parseInt(h, 16); return 0.2126 * (v >> 16) + 0.7152 * (v >> 8 & 255) + 0.0722 * (v & 255); };
  ok(daynight.skyMeshes === 0 && daynight.noon.sky === daynight.noon.fog && daynight.night.sky === daynight.night.fog && daynight.duskSky === daynight.dusk, `sky is one even colour, identical to the fog (no gradient dome / seams): noon #${daynight.noon.sky}, dusk #${daynight.duskSky}, night #${daynight.night.sky}`);
  ok(lum(daynight.night.sky) > 25 && parseInt(daynight.night.sky.slice(4), 16) > parseInt(daynight.night.sky.slice(0, 2), 16), `night sky is dark navy, not black (#${daynight.night.sky}, luminance ${lum(daynight.night.sky).toFixed(0)}/255)`);
  ok(daynight.night.stars > 0.9 && daynight.noon.stars === 0 && daynight.duskStars > 0.2 && daynight.duskStars < daynight.night.stars, `stars: ${daynight.starN} points, shown at night (${daynight.night.stars.toFixed(2)}), fading in at dusk (${daynight.duskStars.toFixed(2)}), hidden by day`);
  ok(daynight.starR > daynight.fogFar * 2 && daynight.starR < daynight.far * 0.8, `stars sit beyond the world and fog (${daynight.starR.toFixed(0)} m) and inside the far plane (${daynight.far} m)`);
  ok(Math.abs(daynight.phase - daynight.expected) < 0.003, `time of day comes from the shared clock (10 min cycle), phase ${daynight.phase.toFixed(4)}`);
  ok(daynight.birdMoved > 0.1 && daynight.butterMoved > 0.02 && daynight.birdY > 14, `birds fly overhead (y≈${daynight.birdY.toFixed(1)} m) and butterflies flutter (moved ${daynight.birdMoved.toFixed(2)} / ${daynight.butterMoved.toFixed(2)} m)`);
  // audio graph: ambience sources exist and are positional
  const au = await A.p.evaluate(() => ({ state: MM.AU.ctx && MM.AU.ctx.state, srcs: (MM.AU.sources || []).map(s => s.name), birds: MM.AU.birds, wind: !!MM.AU.wind, crickets: !!MM.AU.cricket, cicada: !!MM.AU.cicada }));
  ok(au.srcs.includes('waterfall') && au.srcs.includes('stream') && au.srcs.includes('pond') && au.wind && au.crickets && au.cicada, 'ambient audio graph: wind, insects (day cicadas / night crickets), birds, positional water at waterfall/stream/pond: ' + JSON.stringify(au));
  // frame cost
  const perf = await A.p.evaluate(async () => {
    MM.paused = false; MM.fake = null; MM.timeOverride = 0.3; MM.respawn(); await new Promise(r => setTimeout(r, 1500));
    MM.paused = true; T.idle(); const ts = []; for (let i = 0; i < 300; i++) { const t0 = performance.now(); MM.step(1 / 72); ts.push(performance.now() - t0); }
    ts.sort((a, b) => a - b); MM.render(); const ri = MM.renderInfo();
    return { updAvg: ts.reduce((a, b) => a + b, 0) / ts.length, updP95: ts[Math.floor(ts.length * 0.95)], ...ri };
  });
  ok(perf.updAvg < 1.5 && perf.calls < 40 && perf.triangles < 60000, `frame cost: game update ${perf.updAvg.toFixed(3)} ms avg / ${perf.updP95.toFixed(3)} p95, ${perf.calls} draw calls, ${perf.triangles} triangles per eye (solo)`);
  // mirror near spawn: you see your own gorilla (local avatar only rendered in the reflection)
  const mir = await A.p.evaluate(() => {
    const M = MM.MIRROR, T3 = MM.THREE, r = {}, R = MM.renderer, gl = R.getContext();
    r.distSpawn = Math.hypot(M.c.x, M.c.z);
    const S = M.c.x + 1.7; MM.paused = true; MM.timeOverride = 0.25; MM.PH.freeze = false;
    const look = (pitch) => new T3.Quaternion().setFromEuler(new T3.Euler(pitch, Math.PI / 2, 0, 'YXZ')).toArray();
    MM.fake = { head: [0, 1.6, 0], headQ: look(0.02), hands: [{ p: [-0.35, 1.0, 0.3] }, { p: [-0.35, 1.0, -0.3] }] };
    MM.place(S, MM.terrainH(S, M.c.z) + 0.95, M.c.z); MM.step(1 / 72, 30);
    const av = M.avatar, magenta = () => { const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); let n = 0, sx = 0, sy = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 170 && px[i + 1] < 90 && px[i + 2] > 170) { n++; sx += (i / 4) % w; sy += Math.floor(i / 4 / w); } return { n, cx: n ? sx / n : -1, cy: n ? sy / n : -1 }; };
    MM.mirrorTestColor = '#ff00ff';
    R.info.autoReset = false; const meas = () => { const ts = []; let calls = 0, tris = 0; for (let i = 0; i < 20; i++) { R.info.reset(); const t0 = performance.now(); MM.render(); gl.finish(); ts.push(performance.now() - t0); calls = R.info.render.calls; tris = R.info.render.triangles; } ts.sort((a, b) => a - b); return { ms: ts[10], calls, tris }; };
    MM.render(); r.near = { visible: M.mesh.visible, avatar: av.group.visible, px: magenta(), perf: meas() };
    r.layers = { mainSeesAvatar: MM.camera.layers.test(av.body.layers), mirrorSeesAvatar: M.mesh.camera.layers.test(av.body.layers) };
    // wave the right hand up: avatar hand in the mirror follows
    MM.render(); const b0 = magenta();
    MM.fake.hands[1].p = [-0.3, 2.05, -0.3]; MM.step(1 / 72, 3); MM.render(); const b1 = magenta(); r.handFollow = av.hands[1].position.distanceTo(new T3.Vector3(...MM.handsW()[1])); r.shift = b1.cy - b0.cy; r.shiftN = [b0.n, b1.n];
    // step sideways: reflection moves too
    // far away / behind: no reflection pass
    MM.place(M.c.x + 16, MM.terrainH(M.c.x + 16, M.c.z) + 0.95, M.c.z); MM.step(1 / 72, 5); MM.render(); r.far = { visible: M.mesh.visible, px: magenta().n, perf: meas() };
    MM.place(M.c.x - 1.5, 1, M.c.z); MM.PH.freeze = true; MM.step(1 / 72); MM.render(); r.behindVisible = M.mesh.visible; MM.PH.freeze = false;
    // glass isn't climbable; frame logs are
    const glass = MM.colliders.find(c => c.kind === 'mirror'), frame = MM.colliders.filter(c => c.kind === 'mirrorframe');
    r.glassClimb = glass.climb; r.frameClimb = frame.length && frame.every(c => c.climb);
    R.info.autoReset = true; MM.mirrorTestColor = null; MM.step(1 / 72);
    return r;
  });
  ok(mir.distSpawn > 3 && mir.distSpawn < 8, `mirror stands ${mir.distSpawn.toFixed(1)} m from spawn, facing the centre`);
  ok(mir.near.visible && mir.near.avatar && !mir.layers.mainSeesAvatar && mir.layers.mirrorSeesAvatar, 'own gorilla is drawn only in the mirror reflection (hidden from the first-person camera)');
  ok(mir.near.px.n > 300, `player sees their own gorilla in the mirror (${mir.near.px.n} avatar pixels in the reflection)`);
  ok(mir.handFollow < 0.01, 'mirrored hands follow the player\'s hands');
  ok(Math.abs(mir.shift) > 2, `reflection moves with the player: raising a hand moves the mirrored gorilla's pixels (centroid ${mir.shift.toFixed(1)} px, ${mir.shiftN} px)`);
  ok(!mir.far.visible && mir.far.px === 0 && !mir.behindVisible, 'reflection pass skipped when far (>14 m) or behind the mirror');
  ok(!mir.glassClimb && mir.frameClimb, 'mirror glass is not climbable (frame logs are)');
  console.log(`INFO mirror perf: near ${mir.near.perf.calls} draw calls / ${mir.near.perf.tris} tris / ${mir.near.perf.ms.toFixed(1)} ms (SwiftShader) vs far ${mir.far.perf.calls} calls / ${mir.far.perf.tris} tris / ${mir.far.perf.ms.toFixed(1)} ms`);
  // gorilla look (Gorilla Tag style): dark fur in the player's colour, light grey face/chest plates, 3 fingers + thumb, furry forearms
  const gor = await A.p.evaluate(() => {
    const av = MM.MIRROR.avatar, tri = m => m.geometry.attributes.position.count / 3, r = {};
    r.tris = tri(av.body) + tri(av.head) + 2 * tri(av.arms[0]) + 2 * tri(av.fores[0]) + 2 * tri(av.hands[0]); r.handTris = tri(MM.myHands[0]);
    const fur = m => { const f = m.geometry.attributes.fur.array; let a = 0; for (const v of f) a += v; return [a, f.length]; };
    r.headFur = fur(av.head); r.bodyFur = fur(av.body); r.handFurAll = fur(MM.myHands[0])[0] === fur(MM.myHands[0])[1];
    r.defaultColor = MM.ME.color; r.tagOnChest = av.tag.parent === av.body && av.tag.position.z < -0.3; r.tagFilter = av.tag.material.map.magFilter === MM.THREE.NearestFilter;
    r.handsDiffer = MM.myHands[0].geometry !== MM.myHands[1].geometry; const bb = new MM.THREE.Box3().setFromBufferAttribute(MM.myHands[0].geometry.attributes.position); r.handLen = bb.max.z - bb.min.z;
    { const P = av.head.geometry.attributes.position.array, c = [0, 0.03 * 1.22, 0.02 * 1.22], R = [0.175 * 1.05 * 1.22, 0.175 * 1.03 * 1.22, 0.175 * 1.22]; let worst = 0; for (let k = 0; k < P.length; k += 3) if (P[k + 1] > 0.14) worst = Math.max(worst, Math.hypot((P[k] - c[0]) / R[0], (P[k + 1] - c[1]) / R[1], (P[k + 2] - c[2]) / R[2])); r.headBulge = worst; }
    return r;
  });
  ok(gor.headFur[0] > 0 && gor.headFur[0] < gor.headFur[1] && gor.bodyFur[0] < gor.bodyFur[1] && gor.handFurAll, `gorilla has player-coloured fur plus fixed light grey face and chest plates (head ${gor.headFur[1] - gor.headFur[0]}/${gor.headFur[1]} plate verts)`);
  ok(/^#[0-3][0-9a-f][0-3][0-9a-f][0-3][0-9a-f]$/i.test(gor.defaultColor), `default fur colour is near-black (${gor.defaultColor})`);
  ok(gor.tagOnChest && gor.tagFilter, 'name tag is pixel-style text on the gorilla\'s chest');
  ok(gor.handsDiffer && gor.handLen > 0.2, `first-person hands: left/right models with fingers and thumb (${gor.handLen.toFixed(2)} m long, ${gor.handTris} tris)`);
  // arms: one joined limb (shoulder -> elbow -> wrist -> hand) at every reach, elbow out/back, hands hang HAND_DROP below the controller
  const ik = await A.p.evaluate(() => {
    const T3 = MM.THREE, V = (...a) => new T3.Vector3(...a), A = MM.ARM, r = { cases: [] };
    MM.PH.freeze = true; MM.place(2, 0.95, 4);
    const q = (x, y, z) => new T3.Quaternion().setFromEuler(new T3.Euler(x, y, z, 'YXZ')).toArray();
    const poses = { sides: [[-0.75, 1.3, 0], [0.75, 1.3, 0]], ground: [[-0.3, 0.75, -0.35], [0.3, 0.75, -0.35]], raised: [[-0.3, 2.3, -0.2], [0.35, 1.1, -0.3]], overreach: [[-0.95, 1.3, -0.55], [0.85, 0.75, -0.65]], close: [[-0.1, 1.35, -0.05], [0.12, 1.25, 0.02]], behind: [[-0.3, 1.0, 0.45], [0.3, 1.0, 0.45]] };
    for (const [name, hp] of Object.entries(poses)) {
      MM.fake = { head: [0, 1.6, 0], headQ: q(0, 0, 0), hands: [{ p: hp[0], q: q(-0.3, 0.2, -0.4) }, { p: hp[1], q: q(-0.3, -0.2, 0.4) }] }; MM.step(1 / 72);
      for (const [arms, hands] of [[MM.myArms.map(a => [a.u, a.f]), MM.myHands]]) for (let i = 0; i < 2; i++) {
        const [u, f] = arms[i]; u.updateMatrixWorld(true); f.updateMatrixWorld(true); hands[i].updateMatrixWorld(true);
        const elbowA = u.localToWorld(V(0, 0, A.L1)), elbowB = f.getWorldPosition(V()), wristA = f.localToWorld(V(0, 0, A.L2)), wristB = hands[i].localToWorld(A.WRIST_LOCAL.clone());
        const head = MM.headW(), sx = i ? 1 : -1, el = elbowB.clone().sub(head);
        r.cases.push({ name, i, gapElbow: elbowA.distanceTo(elbowB), gapWrist: wristA.distanceTo(wristB), out: el.x * sx, stretch: u.scale.z, finite: [elbowB.x, elbowB.y, elbowB.z].every(Number.isFinite) });
      }
    }
    // controller vs virtual hand: same physics + visible position, HAND_DROP lower
    MM.fake = { head: [0, 1.6, 0], headQ: q(0, 0, 0), hands: [{ p: [-0.3, 1.2, -0.3] }, { p: [0.3, 1.2, -0.3] }] }; MM.step(1 / 72);
    const P = MM.rig.position; r.drop = 1.2 + P.y - MM.handsW()[0][1]; r.visSame = MM.myHands[0].position.distanceTo(V(...MM.handsW()[0])); r.HAND_DROP = MM.HAND_DROP;
    // mirror / remote avatar arms are joined too
    const av = MM.MIRROR.avatar; av.pose(V(0, 1.6, 0), new T3.Quaternion(), V(-0.7, 1.0, -0.4), V(0.5, 0.6, 0.1)); av.group.updateMatrixWorld(true);
    r.avGap = Math.max(...[0, 1].map(i => av.arms[i].localToWorld(V(0, 0, A.L1)).distanceTo(av.fores[i].getWorldPosition(V()))));
    r.avWrist = Math.max(...[0, 1].map(i => av.fores[i].localToWorld(V(0, 0, A.L2)).distanceTo(av.hands[i].getWorldPosition(V())))); // hand sits right at the forearm end
    MM.PH.freeze = false; return r;
  });
  const worst = k => Math.max(...ik.cases.map(c => c[k]));
  ok(worst('gapElbow') < 0.005 && worst('gapWrist') < 0.005 && ik.cases.every(c => c.finite), `arms are one joined limb in every pose (sides/ground/raised/overreach/close/behind): max elbow gap ${(worst('gapElbow') * 1000).toFixed(1)} mm, wrist gap ${(worst('gapWrist') * 1000).toFixed(1)} mm`);
  ok(ik.cases.filter(c => c.name !== 'overreach').every(c => c.out > 0.08), `elbows bend outward, never flip (min elbow offset ${Math.min(...ik.cases.map(c => c.out)).toFixed(2)} m to the side)`);
  ok(ik.cases.filter(c => c.name === 'overreach').every(c => c.stretch > 1 && c.stretch < 1.6), `over-reach stretches the arm slightly instead of detaching (x${Math.max(...ik.cases.map(c => c.stretch)).toFixed(2)})`);
  ok(Math.abs(ik.drop - ik.HAND_DROP) < 0.003 && ik.visSame < 0.001, `virtual hand + collider hang ${(ik.drop * 100).toFixed(0)} cm below the controller, visible hand at the physics hand`);
  ok(ik.avGap < 0.005 && ik.avWrist < 0.09, `remote/mirror gorilla arms joined: elbow gap ${(ik.avGap * 1000).toFixed(1)} mm, hand ${(ik.avWrist * 100).toFixed(1)} cm from forearm end (inside the wrist)`);
  ok(gor.headBulge < 1.02, `head is a smooth rounded dome on top: nothing sticks out of it, no cap-peak brow (max ${gor.headBulge.toFixed(3)} of dome radius)`);
  ok(gor.tris < 3000, `whole gorilla stays Quest-friendly (${gor.tris} triangles)`);
  // screenshots (HUD hidden)
  await A.p.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('hint').style.display = 'none'; });
  const shot = async (name, pos, yaw, pitch, t) => { await A.p.evaluate(([pos, yaw, pitch, t]) => { MM.timeOverride = t; MM.PH.freeze = true; MM.fake = { head: [0, 1.6, 0], headQ: new MM.THREE.Quaternion().setFromEuler(new MM.THREE.Euler(pitch, yaw, 0, 'YXZ')).toArray(), hands: [{ p: [-0.25, 0.95, -0.35] }, { p: [0.25, 0.95, -0.35] }] }; MM.place(...pos); MM.step(1 / 72); MM.render(); }, [pos, yaw, pitch, t]); await A.p.screenshot({ path: SHOTS + name }); };
  await shot('jungle_spawn_day.png', [0, 0.95, 2], 0.25, 0.08, 0.22);
  await shot('waterfall_caves.png', [-4, 3, -14], 0.12, 0.05, 0.3);
  await shot('canopy_course.png', [-6.4, 8.2, -5.2], -1.45, -0.12, 0.27);
  await shot('jungle_overview.png', [21, 15, 21], 0.78, -0.42, 0.2);
  await A.p.evaluate(() => { MM.PH.freeze = false; });
  await shot('mirror.png', [MM_MIRROR_X + 2.3, 0.95, 1.3], Math.PI / 2 - 0.3, 0.03, 0.25);
  // gorilla in the mirror: arms out to the sides, down on the ground, one raised (one joined arm with an elbow)
  const mirrorPose = async (name, hands, pitch) => { await A.p.evaluate(([X, hands, pitch]) => { const T3 = MM.THREE, q = a => new T3.Quaternion().setFromEuler(new T3.Euler(a[0], a[1], a[2], 'YXZ')).toArray(); MM.timeOverride = 0.25; MM.PH.freeze = true; MM.fake = { head: [0, 1.6, 0], headQ: q([pitch, Math.PI / 2 - 0.06, 0]), hands: hands.map(h => ({ p: h[0], q: q(h[1]) })) }; MM.place(X + 0.8, MM.terrainH(X + 0.8, 0.6) + 0.95, 0.62); MM.step(1 / 72); MM.render(); }, [MM_MIRROR_X, hands, pitch]); await A.p.screenshot({ path: SHOTS + name }); };
  await mirrorPose('gorilla_style.png', [[[-0.2, 1.2, 0.62], [-0.3, Math.PI - 0.5, 0.3]], [[-0.18, 2.25, -0.28], [1.35, Math.PI / 2, 0.3]]], -0.1);
  await mirrorPose('gorilla_arms_sides.png', [[[-0.1, 1.35, 0.72], [-0.15, Math.PI - 0.3, 0.6]], [[-0.1, 1.35, -0.72], [-0.15, 0.3, -0.6]]], -0.1);
  await mirrorPose('gorilla_arms_ground.png', [[[-0.38, 0.8, 0.32], [-1.2, Math.PI / 2 + 0.3, -0.5]], [[-0.38, 0.8, -0.32], [-1.2, Math.PI / 2 - 0.3, 0.5]]], -0.25);
  // first-person hands reaching the ground
  await A.p.evaluate(() => { const T3 = MM.THREE, q = (x, y, z) => new T3.Quaternion().setFromEuler(new T3.Euler(x, y, z, 'YXZ')).toArray(); MM.timeOverride = 0.25; MM.PH.freeze = true; MM.fake = { head: [0, 1.6, 0], headQ: q(-0.8, 0, 0), hands: [{ p: [-0.24, 0.78, -0.42], q: q(-0.55, 0.15, -1.45) }, { p: [0.24, 0.78, -0.42], q: q(-0.55, -0.15, 1.45) }] }; MM.place(1.5, MM.terrainH(1.5, 3) + 0.95, 3); MM.step(1 / 72); MM.render(); });
  await A.p.screenshot({ path: SHOTS + 'hands_ground.png' });
  // first-person view of your own hands (3 fingers + thumb, furry forearms)
  await A.p.evaluate(() => { const T3 = MM.THREE, q = (x, y, z) => new T3.Quaternion().setFromEuler(new T3.Euler(x, y, z, 'YXZ')).toArray(); MM.timeOverride = 0.25; MM.PH.freeze = true; MM.fake = { head: [0, 1.6, 0], headQ: q(-0.32, 0, 0), hands: [{ p: [-0.21, 1.36, -0.46], q: new T3.Quaternion().setFromEuler(new T3.Euler(-0.35, 0.35, 0, 'YXZ')).multiply(new T3.Quaternion().setFromAxisAngle(new T3.Vector3(0, 0, 1), Math.PI / 2)).multiply(new T3.Quaternion().setFromAxisAngle(new T3.Vector3(0, 1, 0), -Math.PI / 2)).toArray() }, { p: [0.21, 1.36, -0.46], q: new T3.Quaternion().setFromEuler(new T3.Euler(-0.35, -0.35, 0, 'YXZ')).multiply(new T3.Quaternion().setFromAxisAngle(new T3.Vector3(0, 0, 1), -Math.PI / 2)).multiply(new T3.Quaternion().setFromAxisAngle(new T3.Vector3(0, 1, 0), Math.PI / 2)).toArray() }] }; MM.place(1.5, 0.95, 3); MM.step(1 / 72); MM.render(); });
  await A.p.screenshot({ path: SHOTS + 'hands_fp.png' });
  // ===== cosmetics shop (MONKEY MART in the waterfall cave) =====
  const shop = await A.p.evaluate(() => {
    const r = {}; MM.PH.freeze = true; MM.timeOverride = 0.25;
    MM.shopSetWallet(3); MM.shopSelect('crown'); r.preview = MM.shopLook().cos.hat; r.poor = MM.shopPress(); r.poorW = MM.SHOP.wallet; r.poorOwned = MM.SHOP.owned.has('crown'); r.poorMsg = MM.SHOP.msg;
    MM.shopSetWallet(300);
    MM.shopSelect('party'); r.buy1 = MM.shopPress(); r.w1 = MM.SHOP.wallet; r.hat1 = MM.SHOP.eq.hat;
    MM.shopSelect('crown'); r.buy2 = MM.shopPress(); r.w2 = MM.SHOP.wallet; r.hat2 = MM.SHOP.eq.hat; // one item per slot: crown replaces party hat
    MM.shopSelect('crown'); r.off = MM.shopPress(); r.hat3 = MM.SHOP.eq.hat;
    MM.shopSelect('party'); r.on = MM.shopPress(); r.hat4 = MM.SHOP.eq.hat; r.w4 = MM.SHOP.wallet; // re-equip owned item: free
    MM.shopSelect('fur-blue'); r.fur = MM.shopPress(); r.color = MM.ME.color; r.hand = MM.handMat.color.getHexString(); r.w5 = MM.SHOP.wallet;
    // real touch interaction: walk into the cave, touch an item, then the big button
    const k = MM.SHOP.c; MM.place(k.x, k.y - 0.25, k.z + 0.8); T.idle(); MM.step(1 / 72);
    const spot = MM.SHOP.spots.find(s => s.id === 'shades'); T.handTo(0, spot.p.toArray()); MM.step(1 / 72); r.touchSel = MM.SHOP.sel; r.touchPreview = MM.shopLook().cos.face;
    T.idle(); MM.step(1 / 72); T.handTo(1, MM.SHOP.btnP.toArray()); MM.step(1 / 72); r.touchBuy = MM.SHOP.eq.face; r.w6 = MM.SHOP.wallet; T.idle(); MM.step(1 / 72);
    MM.render(); r.near = MM.SHOP.near; r.mirrorCos = MM.MIRROR.avatar.cosKey;
    r.ls = { w: localStorage.getItem('mm_wallet'), o: JSON.parse(localStorage.getItem('mm_owned')), e: JSON.parse(localStorage.getItem('mm_equipped')) };
    MM.place(0, 0.95, 2); MM.step(1 / 72); r.farHidden = !MM.SHOP_G.visible; MM.PH.freeze = false; return r;
  });
  ok(shop.preview === 'crown' && shop.poor === 'poor' && shop.poorW === 3 && !shop.poorOwned && /Need 197 more/.test(shop.poorMsg), `can't buy without enough bananas: crown previews on you but stays unbought ("${shop.poorMsg}")`);
  ok(shop.buy1 === 'bought' && shop.w1 === 295 && shop.hat1 === 'party', 'BUY spends bananas and equips the item (party hat, 300→295)');
  ok(shop.buy2 === 'bought' && shop.w2 === 95 && shop.hat2 === 'crown', 'one item per slot: buying the crown replaces the party hat');
  ok(shop.off === 'unequipped' && shop.hat3 == null && shop.on === 'equipped' && shop.hat4 === 'party' && shop.w4 === 95, 'owned items toggle EQUIP / take off for free');
  ok(shop.fur === 'bought' && shop.color === '#2f5fd0' && shop.hand === '2f5fd0' && shop.w5 === 85, 'fur colour from the colour board recolours your gorilla and hands');
  ok(shop.touchSel === 'shades' && shop.touchPreview === 'shades' && shop.touchBuy === 'shades' && shop.w6 === 75, 'Gorilla Tag style in the cave: touching an item previews it, touching the big button buys it');
  ok(shop.mirrorCos.includes('party') && shop.mirrorCos.includes('shades'), 'mirror reflection wears the equipped cosmetics');
  ok(shop.ls.w === '75' && shop.ls.o.includes('crown') && shop.ls.e.hat === 'party' && shop.ls.e.fur === 'fur-blue' && shop.farHidden, 'wallet, owned and equipped saved to localStorage; shop details hidden when far away');
  const P3 = await A.ctx.newPage(); await P3.goto(URL); await P3.waitForFunction(() => !!window.MM);
  const pers = await P3.evaluate(() => ({ w: MM.SHOP.wallet, o: [...MM.SHOP.owned].sort(), e: MM.SHOP.eq, c: MM.ME.color })); await P3.close();
  ok(pers.w === 75 && pers.o.join() === 'crown,fur-blue,party,shades' && pers.e.hat === 'party' && pers.e.face === 'shades' && pers.e.fur === 'fur-blue' && pers.c === '#2f5fd0', 'shop state persists across a reload: ' + JSON.stringify(pers));
  // bug: reaching the back of the shop cave (past z = -27) sent you back to spawn. Whole cave interior must be play area.
  const caveStay = await A.p.evaluate(() => {
    MM.paused = true; MM.PH.freeze = false; const r = { caves: [] }, s0 = MM.stats.spawns || 0, k = MM.SHOP.c, cave = MM.SHOP.cave, back = cave.c.z - cave.h.z;
    let minZ = 0, maxZ = -1e9; const track = () => { const h = MM.headW(); minZ = Math.min(minZ, h.z); maxZ = Math.max(maxZ, h.z); };
    T.idle(); MM.place(k.x, cave.floor + 0.95, back + 0.45); T.run(3, track); // stand at the back wall
    const targets = [...MM.SHOP.spots.map(s => s.p), MM.SHOP.btnP];
    for (const tp of targets) { T.run(0.35, () => { T.idle(); T.handTo(0, tp.toArray()); T.handTo(1, [tp.x, tp.y, tp.z]); track(); }); T.idle(); T.run(0.15, track); }
    r.shop = { spawns: (MM.stats.spawns || 0) - s0, minZ, maxZ, back, touched: targets.length };
    // every wall cave/alcove: stand pressed against its back and corners for 2 s
    for (const c of MM.CAVES) for (const dx of [-1, 0, 1]) {
      const s1 = MM.stats.spawns || 0; minZ = 0; maxZ = -1e9;
      MM.place(c.c.x + dx * (c.h.x - 0.4), c.floor + 0.95, c.c.z - c.h.z + 0.4); T.idle(); T.run(2, () => { T.set([-0.27, -0.3, -0.6], [0.27, -0.3, -0.6]); track(); });
      r.caves.push({ x: c.c.x + dx * (c.h.x - 0.4), spawns: (MM.stats.spawns || 0) - s1, minZ: +minZ.toFixed(2), maxZ: +maxZ.toFixed(2) });
    }
    // genuine fall-outs still reset
    const B = MM.HALF; r.oob = [MM.outOfBounds(0, 2, -B - 3), MM.outOfBounds(B + 3, 2, 0), MM.outOfBounds(-9, 4.4, back - 1.0), MM.outOfBounds(0, 2, B + 3), MM.outOfBounds(-9, 4.4, back + 0.3), MM.outOfBounds(3, 7.2, back + 0.3), MM.outOfBounds(0, 2, 0)];
    // simulate tunnelling through the rock: take the wall colliders out for one step so they can't push you back first
    const all = MM.colliders.slice(), walls = all.filter(c => c.kind === 'wall'); const noWalls = f => { MM.colliders.length = 0; MM.colliders.push(...all.filter(c => !walls.includes(c))); f(); MM.colliders.length = 0; MM.colliders.push(...all); };
    const s2 = MM.stats.spawns || 0; T.idle(); noWalls(() => { MM.place(B + 6, 3, 0); MM.step(1 / 72); }); const h1 = MM.headW(); r.resetSide = { spawned: (MM.stats.spawns || 0) - s2, d: Math.hypot(h1.x, h1.z) };
    const s3 = MM.stats.spawns || 0; noWalls(() => { MM.place(-9, 4.4, back - 2); MM.step(1 / 72); }); const h2 = MM.headW(); r.resetBehindCave = { spawned: (MM.stats.spawns || 0) - s3, d: Math.hypot(h2.x, h2.z) };
    const s4 = MM.stats.spawns || 0; MM.place(5, 45, 5); MM.step(1 / 72); const h3 = MM.headW(); r.resetFall = { spawned: (MM.stats.spawns || 0) - s4, d: Math.hypot(h3.x, h3.z) };
    MM.paused = false; return r;
  });
  ok(caveStay.shop.spawns === 0 && caveStay.shop.minZ < -27.3 && caveStay.shop.maxZ < -25, `back of the shop is play area: ~7 s at the back wall touching ${caveStay.shop.touched} shelf items, fur board and button with no respawn (head z ${caveStay.shop.maxZ.toFixed(2)}..${caveStay.shop.minZ.toFixed(2)}, back wall ${caveStay.shop.back.toFixed(2)})`);
  ok(caveStay.caves.every(c => c.spawns === 0 && c.minZ < -27.3), 'both wall caves: back and corners never respawn you ' + JSON.stringify(caveStay.caves));
  ok(caveStay.oob.join() === 'true,true,true,true,false,false,false', 'out-of-bounds check: outside the clearing or behind a cave = out, inside caves/clearing = in ' + caveStay.oob);
  ok(caveStay.resetSide.spawned === 1 && caveStay.resetSide.d < 2 && caveStay.resetBehindCave.spawned === 1 && caveStay.resetBehindCave.d < 2 && caveStay.resetFall.spawned === 1 && caveStay.resetFall.d < 2, 'genuine out-of-bounds (past the side wall, through the rock behind the shop, flung out the top) still resets to spawn ' + JSON.stringify([caveStay.resetSide, caveStay.resetBehindCave, caveStay.resetFall]));
  // shop shots
  const shopShot = async (name, pos, yaw, pitch, hands) => { await A.p.evaluate(([pos, yaw, pitch, hands]) => { const T3 = MM.THREE; MM.timeOverride = 0.25; MM.PH.freeze = true; MM.fake = { head: [0, 1.6, 0], headQ: new T3.Quaternion().setFromEuler(new T3.Euler(pitch, yaw, 0, 'YXZ')).toArray(), hands: hands || [{ p: [-0.25, 0.95, 0.2] }, { p: [0.25, 0.95, 0.2] }] }; const k = MM.SHOP.c; MM.place(k.x + pos[0], k.y - 0.25 + pos[1], k.z + pos[2]); MM.step(1 / 72); MM.render(); }, [pos, yaw, pitch, hands]); await A.p.screenshot({ path: SHOTS + name }); };
  await A.p.evaluate(() => { MM.shopSetWallet(400); for (const id of ['tophat', 'scarf']) { MM.shopSelect(id); MM.shopPress(); } MM.shopSelect('fur-red'); });
  await shopShot('cave_shop.png', [0, 0, 1.6], 0, 0.05);
  const mo = await A.p.evaluate(() => { const m = MM.SHOP.mirror.position, k = MM.SHOP.c; return [m.x - 1.15 - k.x, 0, m.z - k.z]; });
  await shopShot('shop_mirror.png', mo, -Math.PI / 2, 0.0, [{ p: [0.15, 0.95, -0.45] }, { p: [0.35, 1.75, 0.3] }]);
  await shopShot('cave_shop_entrance.png', [0, 0.2, 7], 0, 0.15);
  await A.p.evaluate(() => { MM.shopSelect('fur-charcoal'); MM.shopPress(); MM.place(0, 0.95, 2); MM.step(1 / 72); });
  await shot('night_sky.png', [3, 0.95, 4], 0.6, 1.1, 0.75);
  await shot('dusk_sky.png', [3, 0.95, 4], -2.3, 1.0, 0.5);
  await shot('night_fireflies.png', [2, 1.3, 6], -0.6, 0.05, 0.78);
  await shot('sunset.png', [-10, 4.5, 12], -2.4, 0.0, 0.485);
  await A.ctx.close();

  // ===== multiplayer game logic: two pages joined through the local transport =====
  const room = 'T' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const MPctx = await b.newContext({ viewport: vp, permissions: ['microphone'] });
  async function openMP(name) { const p = await MPctx.newPage(); const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); await p.addInitScript(LOCAL_TRANSPORT); await p.goto(URL); await p.waitForFunction(() => !!window.MM); await p.evaluate(HELPERS); await p.fill('#nameIn', name); return { p, errs }; }
  const P1 = await openMP('Kong'), P2 = await openMP('Bongo');
  for (const [P, x] of [[P1, -1.5], [P2, 1.5]]) { await P.p.fill('#roomIn', room); await P.p.click('#playDesk'); await P.p.evaluate(x => { MM.fake = { head: [0, 1.6, 0], headQ: new MM.THREE.Quaternion().setFromEuler(new MM.THREE.Euler(0, x > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 'YXZ')).toArray(), hands: [{ p: [-0.27, 0.98, -0.2] }, { p: [0.27, 0.98, -0.2] }] }; MM.place(x, MM.terrainH(x, 0) + 0.95, 0); }, x); }
  const t0 = Date.now(); let seen = false;
  while (Date.now() - t0 < 20000) { const a = await P1.p.evaluate(() => MM.remoteList()), c = await P2.p.evaluate(() => MM.remoteList()); if (a.length && c.length && a[0].visible && c[0].visible && a[0].tag === 'Bongo' && c[0].tag === 'Kong') { seen = true; break; } await P1.p.waitForTimeout(300); }
  ok(seen, `two players see each other's gorillas (synced in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (seen) {
    await P1.p.waitForTimeout(500);
    const r1 = await P1.p.evaluate(() => MM.remoteList()[0]), me2 = await P2.p.evaluate(() => MM.headW().toArray());
    const err = Math.hypot(r1.head[0] - me2[0], r1.head[1] - me2[1], r1.head[2] - me2[2]);
    ok(err < 0.25, `remote head pose synced at 15 Hz and interpolated (err ${err.toFixed(3)} m)`);
    ok(r1.name === 'Bongo' && r1.tag === 'Bongo', 'chest name tag on the remote gorilla shows the name set on the landing page');
    const [rate, fps] = await P1.p.evaluate(async () => { let f = 0, run = true; const tick = () => { f++; if (run) requestAnimationFrame(tick); }; requestAnimationFrame(tick); const a = MM.stats.posesSent; await new Promise(r => setTimeout(r, 2000)); run = false; return [(MM.stats.posesSent - a) / 2, f / 2]; });
    ok(rate >= Math.min(13, fps * 0.85) && rate <= 20, `pose send rate ${rate.toFixed(1)} Hz (target 15 Hz; headless page ran at ${fps.toFixed(0)} fps)`);
    await P1.p.waitForFunction(() => MM.NET.round >= 1 && MM.NET.infected.size === 1, null, { timeout: 15000 }).catch(() => { });
    await P1.p.waitForTimeout(400);
    const st = await Promise.all([P1, P2].map(P => P.p.evaluate(() => ({ round: MM.NET.round, inf: [...MM.NET.infected], self: MM.NET.selfId, mode: MM.NET.mode }))));
    if (st[0].round > 2) console.log(await P1.p.evaluate(() => MM.NETLOG.join('\n')), '\n--\n', await P2.p.evaluate(() => MM.NETLOG.join('\n')));
    ok(st[0].round >= 1 && st[0].inf.length === 1 && st[1].round === st[0].round && st[1].inf[0] === st[0].inf[0], `tag round starts with one lava monkey, agreed by both (round ${st[0].round})`);
    const [tagger, runner] = st[0].inf[0] === st[0].self ? [P1, P2] : [P2, P1];
    const lavaLook = await runner.p.evaluate(() => MM.remoteList()[0].it);
    ok(lavaLook, 'the IT player renders lava/red on the other client');
    const round0 = st[0].round;
    await tagger.p.evaluate(() => { MM.PH.freeze = true; const r = MM.remoteList()[0]; const P = MM.rig.position; MM.fake.hands[1].p = [r.head[0] - P.x, r.head[1] - P.y, r.head[2] - P.z]; });
    const both = await runner.p.waitForFunction(() => MM.NET.infected.size === 2 && MM.NET.infected.has(MM.NET.selfId), null, { timeout: 8000 }).then(() => true).catch(() => false);
    ok(both, 'touching the other gorilla with a hand infects them and it propagates to their client');
    await runner.p.waitForTimeout(500); const hudTxt = await runner.p.evaluate(() => document.getElementById('hud').textContent);
    ok(/Everyone is lava|YOU ARE IT/.test(hudTxt), 'tagged player sees lava state: "' + hudTxt.split('Course')[0].split('players 2')[1] + '"');
    await tagger.p.evaluate(() => { MM.fake.hands[1].p = [0.27, 0.98, -0.2]; MM.PH.freeze = false; });
    const reset = await P1.p.waitForFunction(r0 => MM.NET.round > r0 && MM.NET.infected.size === 1, round0, { timeout: 9000 }).then(() => true).catch(() => false);
    await P1.p.waitForTimeout(300);
    const st2 = await Promise.all([P1, P2].map(P => P.p.evaluate(() => ({ round: MM.NET.round, n: MM.NET.infected.size }))));
    ok(reset && st2[1].round === st2[0].round && st2[1].n === 1, `round ends when everyone is infected, then resets (round ${round0}→${st2[0].round}, ${st2[0].n} infected)`);
    // cosmetics + fur colour sync, and lava overriding them while tagged
    await P1.p.evaluate(() => { MM.shopSetWallet(500); for (const id of ['fur-red', 'tophat', 'chain', 'goggles']) { MM.shopSelect(id); MM.shopPress(); } });
    await P2.p.evaluate(() => { MM.shopSetWallet(500); for (const id of ['fur-gold', 'propeller', 'lei', 'shades']) { MM.shopSelect(id); MM.shopPress(); } });
    const cs = await P2.p.waitForFunction(() => { const r = MM.remoteList()[0]; return r && r.cos.includes('tophat') && r.color === '#b8322a' ? r : null; }, null, { timeout: 5000 }).then(h => h.jsonValue()).catch(() => null);
    const cs1 = await P1.p.waitForFunction(() => { const r = MM.remoteList()[0]; return r && r.cos.includes('propeller') && r.color === '#d9a520' ? r : null; }, null, { timeout: 5000 }).then(h => h.jsonValue()).catch(() => null);
    ok(cs && cs1 && cs.cos.includes('chain') && cs.cos.includes('goggles') && (cs.it || cs.matColor === 'b8322a') && cs1.cos.includes('lei'), 'equipped cosmetics and fur colour sync to the other player: ' + (cs && cs.cos) + ' / ' + (cs1 && cs1.cos));
    await P1.p.waitForTimeout(300);
    const lv = await Promise.all([P1, P2].map(P => P.p.evaluate(() => { const r = MM.remoteList()[0]; return { remIt: r.it, m: r.matColor, cos: r.cos, lava: MM.LAVA.getHexString(), meIt: MM.NET.infected.has(MM.NET.selfId), hand: MM.handMat.color.getHexString() }; })));
    const sees = lv.find(x => x.remIt), itMe = lv.find(x => x.meIt);
    ok(sees && itMe && sees.m === sees.lava && sees.cos.length > 2 && itMe.hand === itMe.lava, `'it'/lava look overrides the bought fur colour while tagged (remote ${sees && sees.m}, own hands ${itMe && itMe.hand}; cosmetics kept ${sees && sees.cos})`);
    // voice chat
    await P1.p.waitForFunction(() => MM.remoteList()[0] && MM.remoteList()[0].voice, null, { timeout: 15000 }).catch(() => { });
    await P1.p.waitForTimeout(300);
    const v = await Promise.all([P1, P2].map(P => P.p.evaluate(() => ({ voice: MM.remoteList()[0].voice, pan: MM.remoteList()[0].pannerPos, head: MM.remoteList()[0].head, stream: !!MM.VOICE.stream }))));
    ok(v[0].voice && v[1].voice && v[0].stream && v[1].stream, 'proximity voice: both mics open (getUserMedia) and each side wires the peer stream into WebAudio');
    ok(v[0].pan && Math.hypot(v[0].pan[0] - v[0].head[0], v[0].pan[2] - v[0].head[2]) < 0.5, 'voice is positional: HRTF panner follows the remote gorilla head');
    const g = d => 1.2 / (1.2 + 1.6 * (Math.max(d, 1.2) - 1.2)); ok(g(20) < 0.05 && g(2) > 0.4, `voice fades with distance (inverse model: gain ${g(2).toFixed(2)} at 2 m, ${g(10).toFixed(2)} at 10 m, ${g(20).toFixed(3)} at 20 m)`);
    const mute = await P1.p.evaluate(() => { MM.PH.freeze = true; MM.fake.hands[0].stick = true; MM.step(1 / 72); MM.fake.hands[0].stick = false; MM.step(1 / 72); /* open the wrist panel */ const P = MM.rig.position; const b = MM.muteBtnW(); MM.fake.hands[1].p = [b[0] - P.x, b[1] - P.y + MM.HAND_DROP, b[2] - P.z]; MM.step(1 / 72); MM.step(1 / 72); const r = { muted: MM.VOICE.muted, track: MM.VOICE.stream.getAudioTracks()[0].enabled }; MM.fake.hands[1].p = [0.27, 0.98, -0.2]; MM.step(1 / 72); MM.PH.freeze = false; return r; });
    ok(mute.muted && !mute.track, 'touching the wrist mute button with the right hand mutes the mic track');
    const ph = await Promise.all([P1, P2].map(P => P.p.evaluate(() => MM.DAY.phase)));
    ok(Math.abs(ph[0] - ph[1]) < 0.002, `time of day in sync across players (${ph[0].toFixed(4)} vs ${ph[1].toFixed(4)})`);
    const perf2 = await P2.p.evaluate(() => { MM.render(); return MM.renderInfo(); });
    console.log('INFO draw calls with one remote player:', JSON.stringify(perf2));
    // screenshot from the runner looking at the tagger: lava gorilla + name tag
    await runner.p.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('hint').style.display = 'none'; MM.timeOverride = 0.25; });
    await tagger.p.evaluate(() => { MM.NET.infected.add(MM.NET.selfId); });
    await runner.p.waitForTimeout(600); await runner.p.screenshot({ path: SHOTS + 'multiplayer_nametag.png' });
    // two players in different cosmetics, side by side, nobody lava
    await P1.p.evaluate(() => { MM.NET.infected.clear(); }); await P2.p.evaluate(() => { MM.NET.infected.clear(); });
    await P2.p.evaluate(() => { MM.PH.freeze = true; MM.fake.headQ = new MM.THREE.Quaternion().setFromEuler(new MM.THREE.Euler(0, Math.PI / 2, 0, 'YXZ')).toArray(); MM.place(0.6, MM.terrainH(0.6, 0) + 0.95, 0); });
    await P1.p.evaluate(() => { MM.PH.freeze = true; MM.fake.headQ = new MM.THREE.Quaternion().setFromEuler(new MM.THREE.Euler(0, -Math.PI / 2, 0, 'YXZ')).toArray(); MM.place(-1.6, MM.terrainH(-1.6, 0) + 0.95, 0); MM.timeOverride = 0.25; });
    await P1.p.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('hint').style.display = 'none'; });
    await P1.p.waitForTimeout(700); await P1.p.screenshot({ path: SHOTS + 'shop_two_players.png' }); await P2.p.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('hint').style.display = 'none'; MM.timeOverride = 0.25; }); await P2.p.waitForTimeout(300); await P2.p.screenshot({ path: SHOTS + 'shop_two_players_b.png' });
  }
  // ===== real public signalling check (Trystero + Nostr relays) =====
  {
    const sroom = 'S' + Math.random().toString(36).slice(2, 8).toUpperCase(); const S = [];
    for (const nm of ['Sig1', 'Sig2']) { const c = await b.newContext({ viewport: { width: 320, height: 200 } }); const p = await c.newPage(); await p.goto(URL); await p.waitForFunction(() => !!window.MM); await p.fill('#nameIn', nm); await p.fill('#roomIn', sroom); await p.evaluate(() => { document.getElementById('voiceIn').checked = false; }); await p.click('#playDesk'); S.push(p); }
    await S[0].waitForTimeout(1500);
    const ids = await Promise.all(S.map(p => p.evaluate(() => MM.NET.selfId)));
    for (const [i, p] of S.entries()) await p.evaluate(async other => { const T = await import('./vendor/trystero-nostr.js'); window.__seen = 0; window.__open = 0; for (const s of Object.values(T.getRelaySockets())) { if (s.readyState === 1) __open++; s.addEventListener('message', e => { if (String(e.data).includes(other)) __seen++; }); } }, ids[1 - i]);
    await S[0].waitForTimeout(14000);
    const sig = await Promise.all(S.map(p => p.evaluate(() => ({ open: __open, seen: __seen, peers: MM.NET.remotes.size }))));
    ok(sig[0].open >= 3 && sig[0].seen > 0 && sig[1].seen > 0, `public Nostr signalling works from the browser: ${sig[0].open}/${MM_RELAYS_N} relays open, each peer received the other's signalling messages (${sig[0].seen}/${sig[1].seen}); WebRTC data channel itself can't open in this sandbox (peers: ${sig[0].peers})`);
    for (const p of S) await p.context().close();
  }
  const allErr = [...P1.errs, ...P2.errs];
  ok(allErr.length === 0, 'no console errors during multiplayer ' + JSON.stringify(allErr.slice(0, 5)));
  await b.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
