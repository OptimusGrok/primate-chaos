// DEBUG overlay tests (cave-test only). Run: flock /workspace/.browser-test.lock node test/cave-debug.js
const { chromium } = require('/workspace/strike/node_modules/playwright');
const fs = require('fs'), cp = require('child_process');
const URL = process.env.MM_CAVE_URL || 'http://127.0.0.1:8765/cave-test/index.html';
const SHOTS = __dirname + '/../shots/', ROOT = __dirname + '/../';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const tsrc = fs.readFileSync(__dirname + '/t.js', 'utf8');
const LOCAL_TRANSPORT = eval('(' + tsrc.split('const LOCAL_TRANSPORT = ')[1].split('\n};\n')[0] + '\n})');
const HELPERS = () => {
  const T3 = MM.THREE;
  window.C = {
    q(yaw, pitch = 0) { return new T3.Quaternion().setFromEuler(new T3.Euler(pitch, yaw, 0, 'YXZ')).toArray(); },
    idle(yaw = 0, pitch = 0) { MM.fake = { head: [0, 1.6, 0], headQ: C.q(yaw, pitch), hands: [{ p: [-0.27, 0.98, -0.2] }, { p: [0.27, 0.98, -0.2] }], a: false }; },
    run(sec) { const n = Math.round(sec * 72); for (let i = 0; i < n; i++) MM.step(1 / 72); },
    at(x, y, z) { C.idle(); MM.place(x, y, z); MM.step(1 / 72); MM.render(); return MM.dbgArea(); },
  };
};
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const vp = { width: 640, height: 400 };
  const open = async (ctx, query = '', play = true) => {
    const p = await ctx.newPage(); await p.addInitScript(LOCAL_TRANSPORT); const errs = []; p._errs = errs;
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    await p.goto(URL + query); await p.waitForFunction(() => !!window.MM, null, { timeout: 30000 }); await p.evaluate(HELPERS);
    if (play) { await p.evaluate(() => { document.getElementById('roomIn').value = 'DBG' + Math.random().toString(36).slice(2, 6); document.getElementById('voiceIn').checked = false; }); await p.click('#playDesk'); await p.waitForTimeout(500); }
    return p;
  };
  const ctx = await b.newContext({ viewport: vp });
  // ---------- 1. off by default, and truly idle while off ----------
  let p = await open(ctx);
  const off = await p.evaluate(async () => {
    const r = {}; r.on = MM.DBG.on; r.saved = localStorage.getItem(MM.dbgKey); r.box = !!document.getElementById('dbgBox');
    const wristPlane = MM.myHands[0].children.find(c => c.geometry && c.geometry.parameters.width === 0.14);
    r.wristKids = wristPlane.children.length; r.lbl = document.getElementById('dbgFlat').textContent;
    let canv = 0; MM.scene.traverse(o => { if (o.material && o.material.map && o.material.map.image && o.material.map.image.width === 512 && o.material.map.image.height === 368) canv++; }); r.overlayObjs = canv;
    const v0 = MM.dbgBtn.material.map.version, f0 = MM.renderer.info.render.frame;
    await new Promise(res => setTimeout(res, 1200));
    r.frames = MM.renderer.info.render.frame - f0; r.btnTexUpdates = MM.dbgBtn.material.map.version - v0;
    r.work = { t0: MM.DBG.t0, slices: MM.DBG.slice.length, hist: MM.DBG.hist.length, updates: MM.DBG.updates, n: MM.DBG.n };
    return r;
  });
  ok(!off.on && off.saved === '0' || (!off.on && off.saved === null), `off by default (state ${off.on}, localStorage ${off.saved})`);
  ok(!off.box && off.wristKids === 0 && off.overlayObjs === 0, 'off: no overlay DOM box, no overlay mesh on the wrist panel, no overlay canvas texture anywhere');
  ok(off.frames > 3 && off.work.t0 === 0 && off.work.slices === 0 && off.work.hist === 0 && off.work.updates === 0 && off.work.n === 0 && off.btnTexUpdates === 0, `off: ${off.frames} frames rendered with zero stats work (no samples, no refreshes, no texture updates) ` + JSON.stringify(off.work));
  const errsOff = await p.evaluate(() => { console.error('early boom ' + 'x'.repeat(300)); return [MM.DBG_ERRS.length, MM.DBG_ERRS[0].length, MM.DBG.on]; });
  ok(errsOff[0] === 1 && errsOff[1] <= 160 && !errsOff[2], 'off: the error hook still records (trivially), truncated to 160 chars, without turning anything on');
  ok(await p.evaluate(() => document.getElementById('dbgFlat').textContent === 'DEBUG: OFF' && getComputedStyle(document.getElementById('dbgFlat')).display === 'block'), 'flat page: a DEBUG button is shown during play');

  // ---------- 2. toggles: wrist button (VR), flat button, backquote key, landing button ----------
  const wr = await p.evaluate(() => {
    const r = {}, T = MM.THREE; C.idle(); MM.PH.freeze = true; MM.step(1 / 72);
    MM.fake.hands[0].stick = true; MM.step(1 / 72); MM.fake.hands[0].stick = false; MM.step(1 / 72); r.wrist = MM.wristShown();
    r.btnVisible = MM.dbgBtn.visible;
    const touch = () => { MM.step(1 / 72); const w = new T.Vector3(); MM.myHands[0].updateMatrixWorld(true); MM.dbgBtn.getWorldPosition(w); const P = MM.rig.position; MM.fake.hands[1].p = [w.x - P.x, w.y - P.y + MM.HAND_DROP, w.z - P.z]; MM.step(1 / 72); MM.step(1 / 72); };
    const leave = () => { MM.fake.hands[1].p = [0.27, 0.98, -0.2]; MM.step(1 / 72); MM.step(1 / 72); };
    r.far = MM.DBG.on; // right hand away from the button: nothing
    touch(); r.afterTouch1 = MM.DBG.on; r.meshAttached = MM.myHands[0].children.some(c => c.children.length === 1); r.saved1 = localStorage.getItem(MM.dbgKey);
    MM.step(1 / 72, 3); r.holdStill = MM.DBG.on; // still touching: latched, no flicker
    leave(); MM.DBG._x = 1; // after leaving, a second touch within 600 ms is ignored (debounce), later one toggles
    const now0 = performance.now(); MM._dbgT = now0 - 700; touch(); r.afterTouch2 = MM.DBG.on; r.saved2 = localStorage.getItem(MM.dbgKey);
    leave(); r.mesh2 = MM.myHands[0].children.some(c => c.children.length === 1);
    // hidden wrist panel: the invisible button can't be bumped
    MM.fake.hands[0].stick = true; MM.step(1 / 72); MM.fake.hands[0].stick = false; MM.step(1 / 72); r.hidden = !MM.wristShown(); MM._dbgT = 0; touch(); r.hiddenBump = MM.DBG.on; leave();
    MM.PH.freeze = false; return r;
  });
  ok(wr.wrist && wr.btnVisible && !wr.far, 'wrist panel (left stick click) also shows the DEBUG button; nothing happens until it is touched');
  ok(wr.afterTouch1 === true && wr.meshAttached && wr.saved1 === '1' && wr.holdStill === true, 'touching DEBUG with the right hand turns the overlay ON (VR panel attached to the wrist panel, saved to localStorage, no flicker while held)');
  ok(wr.afterTouch2 === false && wr.saved2 === '0' && !wr.mesh2, 'touching it again turns the overlay OFF and removes the VR panel');
  ok(wr.hidden && wr.hiddenBump === false, 'with the wrist panel hidden the DEBUG button cannot be bumped');
  const flat = await p.evaluate(async () => {
    const r = {}; document.getElementById('dbgFlat').click(); r.btnOn = MM.DBG.on; r.boxOn = !!document.getElementById('dbgBox'); r.label = document.getElementById('dbgFlat').textContent;
    document.getElementById('dbgFlat').click(); r.btnOff = !MM.DBG.on; r.boxGone = !document.getElementById('dbgBox');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote' })); r.keyOn = MM.DBG.on; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote' })); r.keyOff = !MM.DBG.on;
    return r;
  });
  ok(flat.btnOn && flat.boxOn && flat.label === 'DEBUG: ON' && flat.btnOff && flat.boxGone, 'flat page: the DEBUG button toggles the box on and off (label follows)');
  ok(flat.keyOn && flat.keyOff, 'flat page: ` (backquote) toggles it too');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  const land = await p.evaluate(() => { const r = {}, el = document.getElementById('dbgLand'); r.visible = !document.getElementById('landing').classList.contains('hidden'); el.click(); r.on = MM.DBG.on; r.txt = el.textContent; el.click(); r.off = !MM.DBG.on; return r; });
  ok(land.visible && land.on && /ON/.test(land.txt) && land.off, 'landing menu: a DEBUG button toggles it (label follows)');
  await p.close();

  // ---------- 3. ?debug=1 / ?debug=0 and persistence ----------
  const ctx2 = await b.newContext({ viewport: vp });
  p = await open(ctx2, '?debug=1');
  const q1 = await p.evaluate(() => ({ on: MM.DBG.on, box: !!document.getElementById('dbgBox'), saved: localStorage.getItem(MM.dbgKey) }));
  ok(q1.on && q1.box && q1.saved === '1', '?debug=1 turns it on at load (and remembers it)');
  await p.goto(URL); await p.waitForFunction(() => !!window.MM);
  ok(await p.evaluate(() => MM.DBG.on && !!document.getElementById('dbgBox')), 'persists across a reload without the parameter');
  await p.goto(URL + '?debug=0'); await p.waitForFunction(() => !!window.MM);
  ok(await p.evaluate(() => !MM.DBG.on && !document.getElementById('dbgBox') && localStorage.getItem(MM.dbgKey) === '0'), '?debug=0 turns it off (and remembers that)');
  await p.goto(URL); await p.waitForFunction(() => !!window.MM);
  ok(await p.evaluate(() => !MM.DBG.on), 'stays off after reload');
  await p.evaluate(() => MM.dbgSet(true)); await p.goto(URL); await p.waitForFunction(() => !!window.MM);
  ok(await p.evaluate(() => MM.DBG.on && localStorage.getItem(MM.dbgKey) === '1' && MM.dbgKey === 'mmcave_debug'), "toggled on in the UI persists across reload (key 'mmcave_debug')");
  await p.close();

  // ---------- 4. contents, refresh rate, areas ----------
  p = await open(ctx2, '?debug=1');
  const on = await p.evaluate(async () => {
    const r = {}; MM.paused = false; const f0 = MM.renderer.info.render.frame; MM.DBG.updates = 0;
    await new Promise(res => setTimeout(res, 2200));
    r.frames = MM.renderer.info.render.frame - f0; r.updates = MM.DBG.updates; r.text = document.getElementById('dbgBox').textContent; r.lines = MM.DBG.lines; MM.paused = true; return r;
  });
  const T = on.text;
  ok(/FPS \d+/.test(T) && /frame [\d.]+ ms/.test(T) && /cpu [\d.]+ ms/.test(T) && /worst frame \(last 5 s\): [\d.]+ ms/.test(T), 'shows FPS, frame time and the rolling worst frame: ' + T.split('\n').slice(1, 3).join(' | '));
  ok(/JS heap: (\d+\.\d \/ \d+ MB|n\/a)/.test(T), 'shows JS heap (or n/a): ' + T.split('\n')[3]);
  ok(/textures \d+/.test(T) && /geometries \d+/.test(T) && /programs \d+/.test(T) && /draw calls \d+/.test(T) && /triangles [\d.]+k?/.test(T), 'shows renderer.info: ' + T.split('\n').slice(4, 6).join(' | '));
  ok(T.includes('cave-test dbg1') && /area: \S/.test(T) && /\(-?[\d.]+, -?[\d.]+, -?[\d.]+\)/.test(T), 'shows version tag, area and position: ' + T.split('\n')[0] + ' | ' + T.split('\n')[6]);
  ok(/recent errors: none/.test(T), 'a clean load shows "recent errors: none"');
  ok(on.updates >= 4 && on.updates < on.frames / 2 && on.updates <= 2.2 * 4 + 3, `text refreshes a few times a second, not per frame: ${on.updates} refreshes over ${on.frames} frames in 2.2 s`);
  const areas = await p.evaluate(() => {
    const CX = MM.CX, F = CX.F, out = {}, A = (n, ...xyz) => { out[n] = C.at(...xyz); };
    A('spawn', 0, MM.terrainH(0, 4) + 1.3, 4); A('jungle', 20, MM.terrainH(20, 10) + 1.3, 10);
    A('shop', MM.CAVES[0].c.x, MM.CAVES[0].floor + 1.3, MM.CAVES[0].c.z); A('wall', MM.CAVES[1].c.x, F + 1.3, -26.8);
    A('tunnel', 3, F + 1.3, -31); A('big', 3, F + 1.3, -40); A('ledge', 3, F + 1.3, CX.ledgeZ + 1); A('chasm', 3, F + 1.3, CX.ledgeZ - 2);
    A('pillar', 3, F + 1.3, CX.pillars[1].z); A('fall', 3, F - 5, -56); A('end', 3, F + 1.3, -71.5); A('side', 8.5, F + 1.3, -72);
    A('lip', 11, F + 1.3, -72); A('ledges', 14.5, F + 1.3, -72.9); A('long', 23, F + 4.2, -72.9);
    return out;
  });
  const want = { spawn: 'spawn', jungle: 'jungle', shop: 'shop cave', wall: 'wall cave', tunnel: 'tunnel', big: 'big cave', ledge: 'big cave ledge', chasm: 'chasm', pillar: 'pillar 2', fall: 'chasm (falling)', end: 'ledge chamber', side: 'side tunnel', lip: 'cliff lip', ledges: 'cliff ledges', long: 'cliff long ledge' };
  ok(Object.keys(want).every(k => areas[k] === want[k]), 'current area is derived from position: ' + JSON.stringify(areas));

  // ---------- 5. errors captured ----------
  const er = await p.evaluate(async () => {
    const r = {}; MM.DBG_ERRS.length = 0;
    console.error('console one'); console.error(new Error('an Error object')); console.error('long ' + 'y'.repeat(400));
    setTimeout(() => { throw new Error('window error boom'); }, 0); Promise.reject(new Error('rejected promise boom'));
    await new Promise(res => setTimeout(res, 100));
    r.errs = MM.DBG_ERRS.slice(); for (let i = 0; i < 4; i++) console.error('filler ' + i); r.kept = MM.DBG_ERRS.length; r.last = MM.DBG_ERRS[4];
    await new Promise(res => setTimeout(res, 1500)); r.text = document.getElementById('dbgBox').textContent; r.vrLines = MM.DBG.lines;
    return r;
  });
  ok(er.errs.some(e => e === 'console one') && er.errs.some(e => e === 'an Error object') && er.errs.some(e => e.startsWith('long yyy') && e.length <= 160) && er.errs.some(e => e.includes('window error boom')) && er.errs.some(e => e.includes('rejected promise boom')), 'captures console.error (strings, Error objects), window errors and unhandled rejections, truncated: ' + JSON.stringify(er.errs.map(e => e.slice(0, 40))));
  ok(er.kept === 5 && er.last === 'filler 3', 'keeps only the last 5');
  ok(/recent errors \(5\):/.test(er.text) && er.text.includes('filler 3') && er.text.split('\n').every(l => l.length <= 120), 'overlay lists the recent errors (flat lines truncated) ' + JSON.stringify(er.text));
  await p.close();

  // ---------- 6. shots (flat page + VR wrist panel) ----------
  p = await open(ctx2, '?debug=1');
  await p.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('hint').style.display = 'none'; MM.timeOverride = 0.25; console.error('Example error: something went wrong while loading a very long asset name'); MM.paused = false; });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { MM.paused = true; C.at(3, MM.CX.F + 1.3, -40); MM.timeOverride = 0.25; MM.render(); });
  await p.waitForTimeout(400);
  await p.evaluate(() => { MM.render(); }); await p.screenshot({ path: SHOTS + 'cave_debug_flat.png' });
  const vr = await p.evaluate(() => { // VR wrist view: left forearm raised in front of the face, panel + DEBUG button + overlay visible
    MM.timeOverride = 0.25; MM.PH.freeze = true; C.at(3, MM.CX.F + 1.3, -40);
    MM.fake.headQ = C.q(0, -0.85); MM.fake.hands[0].stick = true; MM.step(1 / 72); MM.fake.hands[0].stick = false;
    MM.fake.hands[0].p = [-0.05, 1.12, -0.36]; MM.fake.hands[0].q = new MM.THREE.Quaternion().setFromEuler(new MM.THREE.Euler(0.55, 0, 0, 'YXZ')).toArray();
    MM.fake.hands[1].p = [0.3, 0.8, -0.3]; MM.step(1 / 72, 4); document.getElementById('dbgBox').style.display = 'none'; return { shown: MM.wristShown(), mesh: !!MM.DBG.mesh };
  });
  await p.waitForTimeout(1200); // the live loop refreshes the VR panel text
  await p.evaluate(() => MM.render()); await p.screenshot({ path: SHOTS + 'cave_debug_wrist.png' });
  ok(vr.shown && vr.mesh, 'wrist overlay shot taken (panel shown + overlay mesh attached)');
  await p.close();

  // ---------- 7. root game untouched ----------
  const hashes = cp.spawnSync('sha256sum', ['-c', 'test/root_hashes.txt', '--quiet'], { cwd: ROOT, encoding: 'utf8' });
  ok(hashes.status === 0, 'root game files are byte-identical to the released root build (sha256 of all 15 tracked root files, test/root_hashes.txt)' + (hashes.status ? ' ' + hashes.stdout + hashes.stderr : ''));
  const rootMain = fs.readFileSync(ROOT + 'main.js', 'utf8'), rootHtml = fs.readFileSync(ROOT + 'index.html', 'utf8');
  ok(!/dbg|DBG|mmcave_debug/.test(rootMain + rootHtml), 'no debug code in the root index.html / main.js');
  await b.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
