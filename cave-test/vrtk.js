// vrtk/1 test-kit layer for the WebXR Primate Chaos CAVE-TEST build only.
// Loaded after main.js. When unused (no command, no ?vrtk= / #vrtk=) every hook is a no-op:
// timescale stays 1, god is off, no recording, no extra draws, no timers.
// Transports: window.VRTK, URL ?vrtk= / ?vrtk_cmd= / #vrtk=, and console.log lines
// with the SPEC prefix "VRTK state" / "VRTK ack" / "VRTK shot" / "VRTK bug".
// A page cannot receive adb broadcasts or write $VRTK files; see cave-test/README.md.

const PROTOCOL = 'vrtk/1';
const GAME = 'primate-chaos';
const SCENE = 'cave-test';
const TARGET_FPS = 72;
const VERBS = [
  'ping', 'help', 'state', 'god', 'no-fall', 'nofall', 'timescale', 'slowmo',
  'jump', 'teleport_to', 'teleport', 'respawn', 'bananas', 'tickets', 'tokens',
  'overlay', 'trace', 'screenshot', 'bug', 'record', 'replay',
  'press', 'hold', 'stick', 'menu', 'reset_save',
  'ground', 'fly', 'noclip',
];

const S = {
  active: false,
  god: false,
  timescale: 1,
  trace: false,
  recording: false,
  replaying: false,
  replayI: 0,
  replayDt: 0,
  rec: [],
  recHeader: null,
  recName: '',
  commands: 0,
  lastCmd: '',
  frame: 0,
  teleports: 0,
  godSaves: 0,
  dips: 0,
  t0: performance.now(),
  lastStateLog: 0,
  lastTrace: 0,
  inject: null,
  traceRows: [],
  acks: [],
  errLast: '',
  moving: false,
};

function MM_() { return window.MM; }

function activate() { S.active = true; }

function isoNow() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-';
  const ah = p(Math.floor(Math.abs(off) / 60)), am = p(Math.abs(off) % 60);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}${sign}${ah}:${am}`;
}

function logLine(kind, obj) { console.log('VRTK ' + kind + ' ' + JSON.stringify(obj)); }

function parseFlag(args, cur) {
  const v = String(args[0] ?? '').toLowerCase();
  if (!v || v === 'toggle') return !cur;
  if (v === 'on' || v === '1' || v === 'true' || v === 'yes') return true;
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false;
  return !cur;
}

function splitCommands(text) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') q = !q;
    if (c === ';' && !q) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseCmd(line) {
  line = String(line || '').trim();
  if (!line || line[0] === '#') return null;
  let id;
  const idm = line.match(/\s+#([A-Za-z0-9_.-]+)\s*$/);
  if (idm) { id = idm[1]; line = line.slice(0, idm.index).trim(); }
  const tokens = [];
  const re = /([A-Za-z_][\w-]*)="([^"]*)"|([A-Za-z_][\w-]*)=(\S+)|"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(line))) {
    if (m[1] != null) tokens.push(m[1] + '=' + m[2]);
    else if (m[3] != null) tokens.push(m[3] + '=' + m[4]);
    else if (m[5] != null) tokens.push(m[5]);
    else tokens.push(m[6]);
  }
  if (!tokens.length) return null;
  const verb = tokens[0].toLowerCase(), args = [], kv = {};
  for (const t of tokens.slice(1)) {
    const eq = t.indexOf('=');
    if (eq > 0) kv[t.slice(0, eq).toLowerCase()] = t.slice(eq + 1);
    else args.push(t);
  }
  return { verb, args, kv, id, raw: tokens[0] + (tokens.length > 1 ? ' ' + tokens.slice(1).join(' ') : '') };
}

function ensurePlay() {
  const MM = MM_();
  if (MM && MM.GAME && !MM.GAME.playing && typeof MM.beginPlay === 'function') {
    try { MM.beginPlay(false); } catch (e) { /* landing controls may be missing in odd hosts */ }
  }
}

function r3(n) { return Math.round(n * 1000) / 1000; }
function arr3(v) { return [r3(v.x), r3(v.y), r3(v.z)]; }

function headEuler(MM) {
  const h = MM.headW ? MM.headW() : null;
  const inpQ = latestHeadQ(MM);
  const e = new MM.THREE.Euler().setFromQuaternion(inpQ, 'YXZ');
  return { head: h ? arr3(h) : [0, 1.6, 0], yaw: r3(e.y * 180 / Math.PI), pitch: r3(e.x * 180 / Math.PI), roll: r3(e.z * 180 / Math.PI), q: inpQ };
}

function latestHeadQ(MM) {
  const T = MM.THREE;
  if (MM.fake && MM.fake.headQ) return new T.Quaternion().fromArray(MM.fake.headQ);
  if (MM.camera) return MM.camera.quaternion.clone();
  return new T.Quaternion();
}

function feetOf(MM, head) {
  const y = head[1] - (MM.BODY_OFF || 0.55) - (MM.BODY_R || 0.35);
  return [head[0], r3(y), head[2]];
}

function zoneOf(MM) {
  try { return (MM.dbgArea && MM.dbgArea()) || (MM.CX_STATE && MM.CX_STATE.zone) || 'jungle'; }
  catch (e) { return (MM.CX_STATE && MM.CX_STATE.zone) || 'jungle'; }
}

function perfOf(MM) {
  const a = MM.frameMs || [];
  const n = a.length;
  const avg = n ? a.reduce((s, x) => s + x, 0) / n : 0;
  const worst = n ? Math.max(...a) : 0;
  const fps = avg > 0 ? 1000 / avg : 0;
  return { fps: r3(fps), avg_ms: r3(avg), worst_ms: r3(worst), dips: S.dips, target_fps: TARGET_FPS };
}

function memOf() {
  const pm = performance.memory;
  if (!pm) return { allocated_mb: 0, reserved_mb: 0, mono_used_mb: 0, gc_heap_mb: 0 };
  const used = r3(pm.usedJSHeapSize / 1048576), lim = r3((pm.jsHeapSizeLimit || 0) / 1048576);
  return { allocated_mb: used, reserved_mb: lim, mono_used_mb: used, gc_heap_mb: used };
}

function heldOf(MM) {
  const J = MM.JUMP;
  if (J && J.charging) return true;
  const PH = MM.PH;
  if (PH && PH.hands && PH.hands.some(h => h.anch || h.vine || h.gripAnch)) return true;
  return false;
}

function textsOf(MM) {
  const out = [];
  const h = MM.headW ? MM.headW() : null;
  if (MM.LABELS && MM.LABELS.on && MM.LABELS.items) {
    for (const m of MM.LABELS.items) {
      const d = h ? m.position.distanceTo(h) : 0;
      out.push({ name: 'label ' + (m.userData && m.userData.n) + ' ' + (m.userData && m.userData.name), dist_m: r3(d), line_deg: d > 0.01 ? r3(2 * Math.atan((0.43 / 2) / d) * 180 / Math.PI) : 90, lines: [(m.userData && (m.userData.n + ' ' + m.userData.name)) || 'label'] });
    }
  }
  if (MM.DBG && MM.DBG.on && MM.DBG.lines) {
    out.push({ name: 'debug overlay', dist_m: 0.7, line_deg: 1.2, lines: MM.DBG.lines.slice() });
  }
  if (MM.MENU && MM.MENU.open) out.push({ name: 'menu', dist_m: 0.55, line_deg: 2.0, lines: (MM.MENU_ITEMS || []).map(it => it.id) });
  return out;
}

function snapshot(full) {
  const MM = MM_();
  const pe = MM ? perfOf(MM) : { fps: 0, avg_ms: 0, worst_ms: 0, dips: S.dips, target_fps: TARGET_FPS };
  const he = MM ? headEuler(MM) : { head: [0, 1.6, 0], yaw: 0, pitch: 0, roll: 0 };
  const zone = MM ? zoneOf(MM) : 'jungle';
  const playing = !!(MM && MM.GAME && MM.GAME.playing);
  const walletN = (MM && MM.SHOP && MM.SHOP.wallet) || 0;
  const sessionB = (MM && MM.ME && MM.ME.bananas) || 0;
  const errs = (MM && MM.DBG_ERRS) || [];
  const snap = {
    protocol: PROTOCOL,
    game: GAME,
    version: (MM && MM.DBG_BUILD) || 'cave-test',
    code: 2,
    time: isoNow(),
    t: r3((performance.now() - S.t0) / 1000),
    frame: S.frame,
    scene: SCENE,
    perf: pe,
    mem: memOf(),
    debug: {
      god: !!S.god, timescale: S.timescale, overlay: !!(MM && MM.DBG && MM.DBG.on),
      trace: !!S.trace, menu_open: !!(MM && MM.MENU && MM.MENU.open),
      recording: !!S.recording, replaying: !!S.replaying,
      replay_frame: S.replayI, replay_frames: (S.rec && S.rec.length) || 0,
      commands: S.commands, last_cmd: S.lastCmd,
    },
    player: {
      feet: MM ? feetOf(MM, he.head) : [0, 0.7, 0],
      head: he.head,
      yaw: he.yaw, pitch: he.pitch,
      zoomed: false,
      held: !!(MM && heldOf(MM)),
      frozen: !!(MM && MM.PH && MM.PH.freeze),
      moving: !!S.moving,
      teleports: S.teleports,
      turning: false,
      rescues: (MM && MM.stats && MM.stats.fallResets) || 0,
      zone,
      carried: 0,
      eaten: false,
      times_eaten: 0,
    },
    settings: {
      ground: 'n/a',
      move: 'Gorilla arms',
      seated: false,
      muted: !!(MM && MM.VOICE && MM.VOICE.muted),
      sound: !!(MM && MM.MUSIC && MM.MUSIC.on),
      fly: false,
      noclip: false,
      tag: (MM && MM.NET && MM.NET.mode) || 'solo',
      create: false,
    },
    wallet: { bananas: walletN, tickets: 0 },
    game_state: {
      id: zone,
      mode: playing ? 'Playing' : 'Landing',
      score: sessionB,
      bananas: sessionB,
      god_saves: S.godSaves,
      dead: false,
      map_open: false,
      menu_open: !!(MM && MM.MENU && MM.MENU.open),
      perf_line: `FPS ${pe.fps.toFixed(0)}  frame ${pe.avg_ms.toFixed(1)} ms  worst ${pe.worst_ms.toFixed(1)} ms`,
    },
    errors: { count: errs.length, last: S.errLast || (errs.length ? errs[errs.length - 1] : '') },
  };
  if (full) {
    snap.errors = { count: errs.length, last: snap.errors.last, recent: errs.slice(-20) };
    snap.texts = MM ? textsOf(MM) : [];
  }
  return snap;
}

// ---- jump targets (cave-test parts 1–24 + Unity handoff aliases where they fit) ----
function headOn(feetX, feetY, feetZ) {
  const MM = MM_();
  const hy = feetY + (MM && MM.BODY_OFF || 0.55) + (MM && MM.BODY_R || 0.35) + 0.4; // ~1.3 m, matches test C.stand
  return [feetX, hy, feetZ];
}

function jumpTable() {
  const MM = MM_();
  const CX = MM.CX, CAVES = MM.CAVES, F = CX.F, TH = MM.terrainH;
  const shop = CAVES[0].c, park = CAVES[1].c;
  const list = [
    [1, 'wall 1', [0, 8, -24.15]],
    [2, 'wall 2', [24.15, 8, 0]],
    [3, 'wall 3', [0, -8, 25.6]],
    [4, 'wall 4', [-25.6, -8, 0]],
    [5, 'shop cave', [shop.x, shop.y + 1.2, shop.z + 0.6]],
    [6, 'parkour cave', [park.x, park.y + 1.4, park.z + 0.6]],
    [7, 'tunnel', headOn(3, F, -31)],
    [8, 'wide cave', headOn(3, F, -42.3)],
    [9, 'first ledge', headOn(3, F, CX.ledgeZ + 1.0)],
    [10, 'pillar 1', headOn(CX.pillars[0].x, F, CX.pillars[0].z)],
    [11, 'pillar 2', headOn(CX.pillars[1].x, F, CX.pillars[1].z)],
    [12, 'pillar 3', headOn(CX.pillars[2].x, F, CX.pillars[2].z)],
    [13, 'pillar 4', headOn(CX.pillars[3].x, F, CX.pillars[3].z)],
    [14, 'chamber', headOn(3, F, CX.endEdge - 1.2)],
    [15, 'exit tunnel', headOn(8, F, -72)],
    [16, 'cliff lip', headOn(CX.lip.c.x - 0.7, F, CX.lip.c.z)],
    [17, 'cliff ledge 1', headOn(CX.ledges[0].c.x, CX.ledges[0].c.y + CX.ledges[0].h.y, CX.ledges[0].c.z)],
    [18, 'cliff ledge 2', headOn(CX.ledges[1].c.x, CX.ledges[1].c.y + CX.ledges[1].h.y, CX.ledges[1].c.z)],
    [19, 'long ledge', headOn(CX.ledges[2].c.x, CX.ledges[2].c.y + CX.ledges[2].h.y, CX.ledges[2].c.z)],
    [20, 'cliff vine', [CX.vine.top.x, CX.vine.top.y - 2.2, CX.vine.top.z + 0.5]],
    [21, 'shaft', [3, 14.0, -42.3]],
    [22, 'shaft vine', [3, 10.4, -42.3]],
    [23, 'top clearing', headOn(CX.clearSpawn.x, CX.clearSpawn.y, CX.clearSpawn.z)],
    [24, 'spawn clearing', headOn(0, TH(0, 4), 4)],
  ];
  const aliases = {
    spawn: 24, 'spawn clearing': 24,
    clearing: 23, 'top clearing': 23,
    'first ledge': 9, ledge: 9,
    pillars: 10, pillar: 10, 'pillar 1': 10, 'pillar 2': 11, 'pillar 3': 12, 'pillar 4': 13,
    shaft: 21, 'shaft vine': 22,
    shop: 5, mart: 5, 'shop cave': 5,
    parkour: 6, caves: 6, 'wall cave': 6, 'parkour cave': 6,
    tunnel: 7, 'wide cave': 8, chamber: 14, 'exit tunnel': 15,
    'cliff lip': 16, cliff_ledge: 17, 'cliff ledge': 17, 'cliff ledge 1': 17, 'cliff ledge 2': 18,
    'long ledge': 19, 'cliff vine': 20,
    'wall 1': 1, 'wall 2': 2, 'wall 3': 3, 'wall 4': 4,
    trees: 'trees', climb: 'climb',
  };
  return { list, aliases };
}

function resolveJump(args) {
  const name = args.map(a => String(a).toLowerCase()).join(' ').trim();
  if (!name) return { ok: false, msg: 'jump needs a target (1–24 or a part name)' };
  const { list, aliases } = jumpTable();
  const MM = MM_();
  if (name === 'trees') {
    const x = 12, z = 10; return { ok: true, pos: headOn(x, MM.terrainH(x, z), z), name: 'trees' };
  }
  if (name === 'climb') {
    const c = MM.COURSE && MM.COURSE.start && MM.COURSE.start.c;
    if (!c) return { ok: false, msg: 'climb: canopy course start is not ready' };
    return { ok: true, pos: headOn(c.x, c.y + (c.h ? c.h.y : 0.15), c.z), name: 'climb (canopy course start)' };
  }
  let n = null;
  if (/^\d+$/.test(name)) n = parseInt(name, 10);
  else if (aliases[name] != null && aliases[name] !== 'trees' && aliases[name] !== 'climb') n = aliases[name];
  if (n == null) return { ok: false, msg: 'unknown jump target "' + name + '" (web cave-test has no map_room, east_ext or waterline; try 1–24, clearing, first ledge, pillars, shaft, spawn, shop, caves, climb, trees)' };
  const row = list.find(r => r[0] === n);
  if (!row) return { ok: false, msg: 'unknown jump part ' + n };
  return { ok: true, pos: row[2], name: row[0] + ' ' + row[1] };
}

function setYaw(deg) {
  const MM = MM_();
  if (deg == null || !isFinite(deg)) return;
  const rad = Number(deg) * Math.PI / 180;
  if (MM.DESK) MM.DESK.yaw = rad;
  if (MM.fake) {
    const q = new MM.THREE.Quaternion().setFromEuler(new MM.THREE.Euler(0, rad, 0, 'YXZ'));
    MM.fake.headQ = q.toArray();
  }
}

function syncZone() {
  const MM = MM_();
  if (MM && typeof MM.updateCave === 'function' && typeof MM.headW === 'function') {
    try { MM.updateCave(MM.headW()); } catch (e) { /* zone is best-effort */ }
  }
}

function placeHead(pos, yaw) {
  const MM = MM_();
  ensurePlay();
  MM.place(pos[0], pos[1], pos[2]);
  if (yaw != null) setYaw(yaw);
  syncZone();
  S.teleports++;
}

// ---- recording / replay ----
const BTN = { a: 1, b: 2, x: 4, y: 8, lstick: 16, rstick: 32, ltrig: 64, rtrig: 128, lgrip: 256, rgrip: 512, start: 1024 };

function quatArr(q) {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return [q.x / n, q.y / n, q.z / n, q.w / n];
}

function buttonsOf(inp) {
  let b = 0;
  if (inp.a) b |= BTN.a;
  if (inp.y) b |= BTN.y;
  const L = inp.hands[0] || {}, R = inp.hands[1] || {};
  if (L.stick) b |= BTN.lstick;
  if (R.stick) b |= BTN.rstick;
  if (L.trig) b |= BTN.ltrig;
  if (R.trig) b |= BTN.rtrig;
  if (L.grip) b |= BTN.lgrip;
  if (R.grip) b |= BTN.rgrip;
  return b;
}

function recFrame(dt, inp) {
  const hq = quatArr(inp.headQ);
  const l = inp.hands[0], r = inp.hands[1];
  const lq = quatArr(l.q), rq = quatArr(r.q);
  const gl = l.grip ? 1 : 0, gr = r.grip ? 1 : 0, tl = l.trig ? 1 : 0, tr = r.trig ? 1 : 0;
  const slx = (l.sx != null ? l.sx : 0), sly = (l.sy != null ? l.sy : 0);
  const srx = (r.sx != null ? r.sx : 0), sry = (r.sy != null ? r.sy : 0);
  const nums = [
    dt,
    inp.head.x, inp.head.y, inp.head.z, hq[0], hq[1], hq[2], hq[3],
    l.p.x, l.p.y, l.p.z, lq[0], lq[1], lq[2], lq[3],
    r.p.x, r.p.y, r.p.z, rq[0], rq[1], rq[2], rq[3],
    slx, sly, srx, sry, gl, gr, tl, tr, buttonsOf(inp),
  ];
  return nums.map((v, i) => i === 30 ? String(v | 0) : String(Number(v))).join(' ');
}

function recHeader(name, frames, duration, startCmd, note) {
  const MM = MM_();
  const he = headEuler(MM);
  return {
    format: 'vrtk-rec/1',
    game: GAME,
    version: (MM && MM.DBG_BUILD) || 'cave-test',
    scene: SCENE,
    seed: 0,
    start: he.head,
    start_yaw: he.yaw,
    ground: 0,
    move: 0,
    frames,
    duration_s: r3(duration),
    start_cmd: startCmd || '',
    note: note || '',
    name: name || 'rec',
  };
}

function recText(header, lines) {
  const h = Object.assign({}, header, { frames: lines.length });
  return JSON.stringify(h) + '\n' + lines.join('\n') + (lines.length ? '\n' : '');
}

function parseRec(text) {
  const lines = String(text).split(/\r?\n/).filter((l, i, a) => l.trim() || i < a.length - 1);
  if (!lines.length) throw new Error('empty recording');
  const header = JSON.parse(lines[0]);
  if (!header || header.format !== 'vrtk-rec/1') throw new Error('not vrtk-rec/1');
  const frames = [];
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim(); if (!t) continue;
    const p = t.split(/\s+/).map(Number);
    if (p.length < 31) throw new Error('frame ' + (frames.length) + ' has ' + p.length + ' fields');
    frames.push(p);
  }
  return { header, frames };
}

function frameToInp(MM, fr) {
  const T = MM.THREE;
  const inp = {
    head: new T.Vector3(fr[1], fr[2], fr[3]),
    headQ: new T.Quaternion(fr[4], fr[5], fr[6], fr[7]),
    hands: [
      { p: new T.Vector3(fr[8], fr[9], fr[10]), q: new T.Quaternion(fr[11], fr[12], fr[13], fr[14]), grip: fr[26] >= 0.5, trig: fr[28] >= 0.5, stick: !!(fr[30] & BTN.lstick), sx: fr[22], sy: fr[23] },
      { p: new T.Vector3(fr[15], fr[16], fr[17]), q: new T.Quaternion(fr[18], fr[19], fr[20], fr[21]), grip: fr[27] >= 0.5, trig: fr[29] >= 0.5, stick: !!(fr[30] & BTN.rstick), sx: fr[24], sy: fr[25] },
    ],
    a: !!(fr[30] & BTN.a),
    y: !!(fr[30] & BTN.y),
  };
  return inp;
}

function applyInject(inp) {
  const inj = S.inject; if (!inj) return inp;
  const bits = inj.bits || 0;
  if (bits & BTN.a) inp.a = true;
  if (bits & BTN.y) inp.y = true;
  if (bits & BTN.lgrip) inp.hands[0].grip = true;
  if (bits & BTN.rgrip) inp.hands[1].grip = true;
  if (bits & BTN.ltrig) inp.hands[0].trig = true;
  if (bits & BTN.rtrig) inp.hands[1].trig = true;
  if (bits & BTN.lstick) inp.hands[0].stick = true;
  if (bits & BTN.rstick) inp.hands[1].stick = true;
  if (inj.stick) {
    if (inj.stick.lx != null) inp.hands[0].sx = +inj.stick.lx;
    if (inj.stick.ly != null) inp.hands[0].sy = +inj.stick.ly;
    if (inj.stick.rx != null) inp.hands[1].sx = +inj.stick.rx;
    if (inj.stick.ry != null) inp.hands[1].sy = +inj.stick.ry;
  }
  inj.left -= inj.oneShot ? 1 : inj.dtWait;
  if (inj.oneShot || inj.left <= 0) S.inject = null;
  return inp;
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function downloadDataUrl(filename, url) {
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
}

function btnName(s) {
  const k = String(s || '').toLowerCase().replace(/[_-]/g, '');
  const map = { a: 'a', b: 'b', x: 'x', y: 'y', lstick: 'lstick', rstick: 'rstick', ltrig: 'ltrig', rtrig: 'rtrig', lgrip: 'lgrip', rgrip: 'rgrip', start: 'start', ltrigger: 'ltrig', rtrigger: 'rtrig' };
  return map[k] || k;
}

function handle(p, source) {
  const MM = MM_();
  const verb = p.verb, args = p.args, kv = p.kv;
  const na = (feat) => ({ ok: false, msg: feat + ' is not in the WebXR cave-test build' });

  if (verb === 'ping') return { ok: true, msg: 'pong' };

  if (verb === 'help') return { ok: true, msg: VERBS.join(' ') };

  if (verb === 'state') {
    const full = String(args[0] || '').toLowerCase() === 'full';
    const snap = snapshot(full);
    logLine('state', snap);
    api.lastState = snap;
    return { ok: true, msg: full ? 'state full' : 'state' };
  }

  if (verb === 'god' || verb === 'no-fall' || verb === 'nofall') {
    S.god = parseFlag(args, S.god);
    return { ok: true, msg: 'god/no-fall ' + (S.god ? 'on' : 'off') + ' (no fall respawn; local player cannot be tagged)' };
  }

  if (verb === 'timescale' || verb === 'slowmo') {
    let v = args[0] != null ? String(args[0]).toLowerCase().replace(/x$/, '') : '0.5';
    let n = parseFloat(v);
    if (!isFinite(n)) n = 0.5;
    const allowed = [1, 0.5, 0.25];
    let best = allowed[0], d = Math.abs(n - best);
    for (const a of allowed) { const dd = Math.abs(n - a); if (dd < d) { best = a; d = dd; } }
    S.timescale = best;
    return { ok: true, msg: 'timescale ' + best };
  }

  if (verb === 'jump') {
    const r = resolveJump(args);
    if (!r.ok) return r;
    placeHead(r.pos, kv.yaw != null ? +kv.yaw : undefined);
    return { ok: true, msg: 'jumped to ' + r.name + ' [' + r.pos.map(x => r3(x)).join(', ') + ']' };
  }

  if (verb === 'teleport_to' || (verb === 'teleport' && (kv.x != null || args.length >= 3))) {
    const x = kv.x != null ? +kv.x : +args[0], y = kv.y != null ? +kv.y : +args[1], z = kv.z != null ? +kv.z : +args[2];
    if (![x, y, z].every(isFinite)) return { ok: false, msg: 'teleport_to needs x= y= z=' };
    const yaw = kv.yaw != null ? +kv.yaw : undefined;
    const head = headOn(x, y, z); // feet at the given point
    placeHead(head, yaw);
    return { ok: true, msg: 'teleport_to feet [' + [x, y, z].map(r3).join(', ') + ']' };
  }

  if (verb === 'respawn') {
    ensurePlay();
    if (typeof MM.respawn === 'function') MM.respawn();
    syncZone();
    S.teleports++;
    return { ok: true, msg: 'respawn' };
  }

  if (verb === 'bananas' || verb === 'tickets' || verb === 'tokens') {
    let raw = args[0] != null ? String(args[0]) : (verb === 'tokens' ? '+50' : '+100');
    const add = raw.startsWith('+') || raw.startsWith('-') || raw === '';
    const n = parseInt(raw.replace(/^\+/, ''), 10);
    const amt = isFinite(n) ? n : (verb === 'tokens' ? 50 : 100);
    if (!MM.SHOP) return { ok: false, msg: 'shop is not ready' };
    if (add || raw.startsWith('+')) {
      if (typeof MM.shopEarn === 'function') MM.shopEarn(amt);
      else MM.shopSetWallet((MM.SHOP.wallet || 0) + amt);
    } else if (typeof MM.shopSetWallet === 'function') MM.shopSetWallet(amt);
    const mapped = verb === 'bananas' ? '' : ' (mapped to wallet bananas)';
    return { ok: true, msg: 'wallet bananas ' + MM.SHOP.wallet + mapped };
  }

  if (verb === 'overlay') {
    const on = parseFlag(args, !!(MM.DBG && MM.DBG.on));
    if (typeof MM.dbgSet === 'function') MM.dbgSet(on);
    return { ok: true, msg: 'overlay ' + (on ? 'on' : 'off') + ' (debug overlay)' };
  }

  if (verb === 'trace') {
    S.trace = parseFlag(args, S.trace);
    if (S.trace && !S.traceRows) S.traceRows = [];
    return { ok: true, msg: 'trace ' + (S.trace ? 'on' : 'off') + ' (' + S.traceRows.length + ' samples in memory; VRTK.exportTrace())' };
  }

  if (verb === 'screenshot') {
    const name = (args[0] && args[0] !== 'ui' ? args[0] : 'shot') + '';
    if (typeof MM.render === 'function') MM.render();
    const cv = MM.renderer && MM.renderer.domElement;
    if (!cv || !cv.toDataURL) return { ok: false, msg: 'no canvas' };
    const url = cv.toDataURL('image/png');
    api.lastShot = { name, dataUrl: url };
    const bytes = Math.ceil((url.length - url.indexOf(',') - 1) * 0.75);
    const info = { protocol: PROTOCOL, name, ok: true, bytes, mime: 'image/png', note: 'PNG stays in VRTK.lastShot / download; a web page cannot write $VRTK/shots/' };
    logLine('shot', info);
    try { downloadDataUrl(name.replace(/\.png$/i, '') + '.png', url); } catch (e) { /* headless may ignore */ }
    return { ok: true, msg: 'screenshot ' + name + ' (' + bytes + ' bytes) — use VRTK.lastShot.dataUrl; not written to a device folder' };
  }

  if (verb === 'bug') {
    const note = args.join(' ') || '';
    const full = snapshot(true);
    if (typeof MM.render === 'function') MM.render();
    let shot = null;
    try { const cv = MM.renderer && MM.renderer.domElement; if (cv && cv.toDataURL) shot = cv.toDataURL('image/png'); } catch (e) { }
    const rec = S.recording || S.rec.length ? recText(recHeader(S.recName || 'input_so_far', S.rec.length, S.rec.reduce((s, l) => s + parseFloat(l) || 0, 0), (S.recHeader && S.recHeader.start_cmd) || '', ''), S.rec) : '';
    api.lastBug = { note, state: full, shot, rec };
    const info = { protocol: PROTOCOL, ok: true, note, frame: S.frame, time: full.time, has_shot: !!shot, has_rec: !!rec, hint: 'bundle is in VRTK.lastBug; a web page cannot write $VRTK/bugs/' };
    logLine('bug', info);
    try { downloadText('vrtk-bug-' + Date.now() + '.json', JSON.stringify({ note, state: full }, null, 2), 'application/json'); } catch (e) { }
    return { ok: true, msg: 'bug recorded in VRTK.lastBug' + (note ? ' (' + note + ')' : '') };
  }

  if (verb === 'record') {
    const sub = String(args[0] || 'start').toLowerCase();
    if (sub === 'stop') {
      if (!S.recording && !S.rec.length) return { ok: false, msg: 'not recording' };
      S.recording = false;
      const dur = S.rec.reduce((s, l) => s + (parseFloat(l) || 0), 0);
      const header = recHeader(S.recName || 'rec', S.rec.length, dur, (S.recHeader && S.recHeader.start_cmd) || '', (S.recHeader && S.recHeader.note) || '');
      const text = recText(header, S.rec);
      api.lastRec = text;
      try { downloadText((header.name || 'rec') + '.vrtkrec', text, 'text/plain'); } catch (e) { }
      return { ok: true, msg: 'record stop ' + header.frames + ' frames, ' + header.duration_s + 's (VRTK.lastRec / exportRec)' };
    }
    // start
    const name = (kv.name || (args[1] && args[1] !== 'then' ? args[1] : '') || 'rec') + '';
    S.rec = []; S.recName = name; S.recording = true;
    S.recHeader = { start_cmd: kv.then || kv.start_cmd || '', note: kv.note || '' };
    const startCmd = S.recHeader.start_cmd;
    if (startCmd) {
      const inner = parseCmd(startCmd.replace(/^"|"$/g, ''));
      if (inner) handle(inner, source);
    }
    const he = headEuler(MM);
    S.recHeader.start = he.head; S.recHeader.start_yaw = he.yaw;
    return { ok: true, msg: 'record start ' + name };
  }

  if (verb === 'replay') {
    const sub = String(args[0] || '').toLowerCase();
    if (sub === 'stop') { S.replaying = false; S.replayI = 0; if (MM.fake === S.replayFake) MM.fake = null; return { ok: true, msg: 'replay stop' }; }
    const src = args.join(' ') || api.lastRec;
    if (!src) return { ok: false, msg: 'replay needs a vrtkrec text, or call after record stop (VRTK.lastRec)' };
    let rec;
    try { rec = parseRec(src.startsWith('{') || src.startsWith('{"') ? src : (api.recs && api.recs[src]) || api.lastRec); }
    catch (e) { return { ok: false, msg: 'replay parse: ' + e.message }; }
    if (!rec || !rec.frames.length) return { ok: false, msg: 'replay has no frames' };
    S.rec = rec.frames.map(fr => fr.join(' ')); // keep raw? actually frames are numbers
    // store numeric frames
    S.replayFrames = rec.frames;
    S.replayHeader = rec.header;
    S.replayI = 0; S.replaying = true; S.timescale = 1;
    ensurePlay();
    const st = rec.header.start;
    if (Array.isArray(st) && st.length >= 3) MM.place(st[0], st[1], st[2]);
    if (rec.header.start_yaw != null) setYaw(rec.header.start_yaw);
    if (rec.header.start_cmd) {
      const inner = parseCmd(String(rec.header.start_cmd).replace(/^"|"$/g, ''));
      if (inner) handle(inner, source);
    }
    return { ok: true, msg: 'replay ' + rec.frames.length + ' frames' };
  }

  if (verb === 'press' || verb === 'hold') {
    const btn = btnName(args[0]);
    const bits = BTN[btn];
    if (!bits) return { ok: false, msg: 'unknown button ' + (args[0] || '') + ' (a b x y lstick rstick ltrig rtrig lgrip rgrip start)' };
    const secs = verb === 'hold' ? Math.max(0.001, parseFloat(args[1] || kv.secs || '0.5')) : 0;
    S.inject = { bits, left: verb === 'hold' ? secs : 1, oneShot: verb === 'press', dtWait: 0 };
    return { ok: true, msg: verb + ' ' + btn + (verb === 'hold' ? ' ' + secs + 's' : '') };
  }

  if (verb === 'stick') {
    S.inject = {
      bits: 0, left: 1, oneShot: true, dtWait: 0,
      stick: { lx: kv.lx != null ? +kv.lx : 0, ly: kv.ly != null ? +kv.ly : 0, rx: kv.rx != null ? +kv.rx : 0, ry: kv.ry != null ? +kv.ry : 0 },
    };
    return { ok: true, msg: 'stick lx=' + S.inject.stick.lx + ' ly=' + S.inject.stick.ly + ' rx=' + S.inject.stick.rx + ' ry=' + S.inject.stick.ry };
  }

  if (verb === 'menu') {
    const want = String(args[0] || 'toggle').toLowerCase();
    const open = want === 'open' ? true : want === 'close' ? false : !MM.MENU.open;
    if (typeof MM.menuSetOpen === 'function') {
      const inp = { head: MM.headW ? MM.headW().sub(MM.rig.position) : new MM.THREE.Vector3(0, 1.6, 0), headQ: latestHeadQ(MM) };
      // headW is world; menuSetOpen uses inp.head in rig space. Use camera-local or default.
      const local = new MM.THREE.Vector3(0, 1.6, 0);
      MM.menuSetOpen(open, { head: local, headQ: latestHeadQ(MM) });
    }
    return { ok: true, msg: 'menu ' + (open ? 'open' : 'close') };
  }

  if (verb === 'reset_save') {
    if (MM.SHOP) {
      MM.SHOP.wallet = 0;
      MM.SHOP.owned = new Set();
      MM.SHOP.eq = { hat: null, face: null, body: null, fur: 'fur-charcoal' };
      if (typeof MM.shopSave === 'function') MM.shopSave();
      if (typeof MM.shopSetWallet === 'function') MM.shopSetWallet(0);
    }
    if (MM.ME) MM.ME.bananas = 0;
    ensurePlay();
    if (typeof MM.respawn === 'function') MM.respawn();
    return { ok: true, msg: 'reset_save: wallet and cosmetics cleared, respawned (name/room kept)' };
  }

  if (verb === 'ground' || verb === 'fly' || verb === 'noclip') return na(verb);

  return { ok: false, msg: 'unknown command "' + verb + '"' };
}

function ackOf(p, result, source) {
  const ack = {
    protocol: PROTOCOL,
    cmd: p.raw || p.verb,
    ok: !!result.ok,
    msg: result.msg || (result.ok ? 'ok' : 'failed'),
    source: source || 'js',
    frame: S.frame,
  };
  if (p.id != null) ack.id = p.id;
  return ack;
}

function runOne(line, source) {
  const p = parseCmd(line);
  if (!p) return null;
  activate();
  S.commands++;
  S.lastCmd = p.raw;
  let result;
  try { result = handle(p, source); }
  catch (e) { result = { ok: false, msg: String(e && e.message || e) }; }
  const ack = ackOf(p, result, source);
  logLine('ack', ack);
  S.acks.push(ack);
  if (S.acks.length > 200) S.acks.shift();
  api.lastAck = ack;
  api.acks = S.acks;
  return ack;
}

function cmd(text, source) {
  const lines = splitCommands(String(text || ''));
  let last = null;
  for (const line of lines) last = runOne(line, source || 'js') || last;
  return last;
}

// ---- hooks used by cave-test/main.js (must be cheap no-ops when unused) ----
function scaleDt(dt) {
  if (S.replaying && S.replayFrames && S.replayI < S.replayFrames.length) {
    S.replayDt = S.replayFrames[S.replayI][0];
    return S.replayDt;
  }
  if (S.timescale !== 1) return dt * S.timescale;
  return dt;
}

function filterInput(inp, dt) {
  const MM = MM_();
  if (S.replaying && S.replayFrames) {
    if (S.replayI >= S.replayFrames.length) {
      S.replaying = false;
      if (MM.fake === S.replayFake) MM.fake = null;
    } else {
      inp = frameToInp(MM, S.replayFrames[S.replayI]);
      S.replayI++;
      S.replayFake = MM.fake;
    }
  }
  if (S.inject) {
    if (!S.inject.oneShot) S.inject.dtWait = dt;
    inp = applyInject(inp);
  }
  if (S.recording && inp) S.rec.push(recFrame(dt, inp));
  return inp;
}

function tick(dt, inp, now) {
  if (!S.active) return;
  S.frame++;
  const MM = MM_();
  const fm = MM && MM.frameMs && MM.frameMs.length ? MM.frameMs[MM.frameMs.length - 1] : 0;
  if (fm > 1.5 * (1000 / TARGET_FPS)) S.dips++;
  if (inp && inp.head && MM && MM.PH) {
    const v = MM.PH.V; S.moving = !!(v && v.lengthSq && v.lengthSq() > 0.01) || !!(MM.PH.anyAnch);
  }
  const t = (now || performance.now());
  if (S.trace && t - S.lastTrace >= 100) {
    S.lastTrace = t;
    const he = headEuler(MM);
    const pe = perfOf(MM);
    const rig = MM.rig ? arr3(MM.rig.position) : [0, 0, 0];
    const ry = MM.rig ? r3(new MM.THREE.Euler().setFromQuaternion(MM.rig.quaternion, 'YXZ').y * 180 / Math.PI) : 0;
    S.traceRows.push({
      t: r3((t - S.t0) / 1000), frame: S.frame, head: he.head, yaw: he.yaw, pitch: he.pitch, roll: he.roll,
      rig, rig_yaw: ry, fps: pe.fps, worst_ms: pe.worst_ms, fade: false, zooming: false, moving: !!S.moving,
    });
    if (S.traceRows.length > 20000) S.traceRows.splice(0, S.traceRows.length - 15000);
  }
  if (t - S.lastStateLog >= 5000 && MM.GAME && MM.GAME.playing) {
    S.lastStateLog = t;
    const snap = snapshot(false);
    logLine('state', snap);
    api.lastState = snap;
  }
}

function readUrlCommands() {
  const q = new URLSearchParams(location.search);
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const hp = new URLSearchParams(hash.includes('=') ? hash : '');
  const raws = [];
  const grab = (v, src) => { if (v == null || v === '') return; raws.push({ v: v.replace(/\+/g, ' '), src }); };
  grab(q.get('vrtk_cmd'), 'url');
  grab(q.get('vrtk'), 'url');
  grab(hp.get('vrtk_cmd'), 'hash');
  grab(hp.get('vrtk'), 'hash');
  // also allow a bare #vrtk=... already covered; and #vrtk:cmd
  const hl = hash.toLowerCase();
  if (!hp.get('vrtk') && !hp.get('vrtk_cmd') && (hl.startsWith('vrtk=') || hl.startsWith('vrtk:'))) {
    grab(hash.slice(5), 'hash');
  }
  for (const r of raws) {
    const v = r.v.trim();
    if (v === '1' || v === 'true' || v === 'on' || v === 'yes') { activate(); continue; }
    cmd(v, r.src);
  }
}

const hook = {
  get god() { return S.god; },
  scaleDt, filterInput, tick,
};

const api = {
  protocol: PROTOCOL,
  cmd: (text, source) => cmd(text, source || 'js'),
  state: (full) => { const snap = snapshot(!!full); if (S.active || full) { /* no auto log unless asked */ } return snap; },
  logState: (full) => { const snap = snapshot(!!full); logLine('state', snap); api.lastState = snap; return snap; },
  exportRec: (name) => {
    const dur = S.rec.reduce((s, l) => s + (parseFloat(l) || 0), 0);
    const header = recHeader(name || S.recName || 'rec', S.rec.length, dur, (S.recHeader && S.recHeader.start_cmd) || '', (S.recHeader && S.recHeader.note) || '');
    const text = recText(header, S.rec);
    api.lastRec = text;
    return text;
  },
  downloadRec: (name) => { const t = api.exportRec(name); downloadText((name || S.recName || 'rec') + '.vrtkrec', t, 'text/plain'); return t; },
  exportTrace: () => S.traceRows.map(r => JSON.stringify(r)).join('\n') + (S.traceRows.length ? '\n' : ''),
  exportState: (full) => JSON.stringify(snapshot(!!full), null, 2),
  acks: S.acks,
  lastAck: null,
  lastState: null,
  lastRec: '',
  lastShot: null,
  lastBug: null,
  get trace() { return S.traceRows; },
  get active() { return S.active; },
};

window.VRTK = api;
const MM = MM_();
if (MM) MM.VRTK = hook;
else addEventListener('DOMContentLoaded', () => { if (window.MM) window.MM.VRTK = hook; });

// hook existing error log so state.errors.last is useful
addEventListener('error', ev => { S.errLast = String(ev && ev.message || ev); });
addEventListener('unhandledrejection', ev => { S.errLast = String(ev && ev.reason || ev); });

readUrlCommands();
addEventListener('hashchange', () => readUrlCommands());

export { api as VRTK };
