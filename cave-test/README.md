# Primate Chaos — cave-test build

This folder is the **test** WebXR build. The live game at the site root is separate and is not changed by work here.

- Play: https://optimusgrok.github.io/primate-chaos/cave-test/
- The root game stays at https://optimusgrok.github.io/primate-chaos/

## VR Tester protocol (vrtk/1)

Cave-test speaks the same **vrtk/1** command and state language as the Unity test kit (`vr-test-kit/tools/SPEC.md`), over web transports a page can actually use. The layer lives in `vrtk.js` and is loaded only from this folder. It stays idle until you send a command or open the page with a `vrtk` query / hash: no change to gameplay, physics, visuals or performance when unused.

A browser **cannot** receive `adb` broadcasts or read/write the Unity `$VRTK` files (`cmd.txt`, `state.json`, `shots/`, …). Those file and broadcast transports are not implemented here, and there is no fetch-based `cmd.txt` poll (a static GitHub Pages host has nothing writable to poll, and a poll would need `fetch`). Paste the same command text into `window.VRTK.cmd(...)` instead.

### Transports

1. **`window.VRTK` (preferred for Puppeteer / Quest remote debugging)**

   ```js
   VRTK.cmd('ping')                 // -> ack object, also logged
   VRTK.cmd('jump clearing #1')     // #id is echoed in the ack
   VRTK.cmd('god on; state full')   // ';' separates commands
   VRTK.state(true)                 // snapshot object (full)
   VRTK.logState()                  // snapshot + `VRTK state {...}` log line
   VRTK.exportRec()                 // .vrtkrec text after record stop
   VRTK.downloadRec('run')
   VRTK.exportTrace()               // jsonl text while / after `trace on`
   VRTK.lastAck, VRTK.acks, VRTK.lastState, VRTK.lastRec, VRTK.lastShot, VRTK.lastBug
   ```

2. **URL query or hash** (applied on load, and again on `hashchange`)

   ```
   .../cave-test/?vrtk=ping
   .../cave-test/?vrtk=jump+clearing
   .../cave-test/?vrtk_cmd=god%20on
   .../cave-test/#vrtk=state%20full
   .../cave-test/?vrtk=1              // just arm periodic 5 s state logs
   ```

   Starting desk play is automatic for commands that need a session (jump, teleport, respawn, record, replay).

3. **Console / logcat** — every ack and the 5 s (and on-demand) snapshot is a single `console.log` line with the SPEC prefix, so Quest Browser logcat, remote debugging, and `vrtk_parse.py` can read them:

   ```
   VRTK state {"protocol":"vrtk/1",...}
   VRTK ack {"protocol":"vrtk/1","cmd":"ping","ok":true,"msg":"pong","source":"js","frame":12}
   VRTK shot {...}
   VRTK bug {...}
   ```

   Example:

   ```bash
   python3 vr-test-kit/tools/vrtk_parse.py state quest.log
   python3 vr-test-kit/tools/vrtk_rec.py validate run.vrtkrec
   python3 vr-test-kit/tools/vrtk_comfort.py --trace trace.jsonl
   ```

### Commands

Same syntax as the SPEC: `verb arg arg key=value "quoted arg" #id`. Verbs are case-insensitive. `on|off|toggle` also accept `1/0`, `true/false`, `yes/no`; a bare flag toggles.

| command | cave-test effect |
|---|---|
| `ping` | ack `pong` |
| `help` | lists verbs |
| `state [full]` | logs a vrtk/1 snapshot (`errors.recent` + `texts` when `full`) |
| `god` / `no-fall` `[on\|off\|toggle]` | no fall-out respawn; the local player cannot be tagged |
| `timescale 1\|0.5\|0.25` (also `slowmo`) | scales simulation `dt` only when not 1 |
| `jump <target>` | teleport to a numbered part **1–24** or a name: `spawn`, `clearing`, `first ledge`, `pillars` / `pillar 1`–`4`, `shaft`, `shaft vine`, `shop` / `mart`, `caves` / `parkour`, `tunnel`, `wide cave`, `chamber`, `exit tunnel`, `cliff lip`, `cliff_ledge`, `long ledge`, `cliff vine`, `wall 1`–`4`, plus loose aliases `trees` (jungle) and `climb` (canopy course start) |
| `teleport_to x= y= z= [yaw=]` | place **feet** at a world point |
| `respawn` | jungle spawn (same as a restart) |
| `bananas [+N]` | add to the wallet (default +100). `tickets` / `tokens` map to bananas |
| `overlay on\|off` | the existing debug overlay |
| `trace on\|off` | 10 Hz comfort trace in memory; `VRTK.exportTrace()` |
| `screenshot [name]` | PNG in `VRTK.lastShot` (and a download when the browser allows). Cannot write `$VRTK/shots/` |
| `bug [note]` | full state + optional shot + in-progress recording in `VRTK.lastBug` |
| `record start [name] [then="<cmd>"] [note=...]` / `record stop` | input recording, `vrtk-rec/1`. Stop fills `VRTK.lastRec` |
| `replay` / `replay stop` | pass the `.vrtkrec` text (or call after `record stop` to replay `VRTK.lastRec`). Best-effort: no Unity random seed, network peers are out of scope |
| `press <btn>` / `hold <btn> [secs]` / `stick lx= ly= rx= ry=` | inject input. Buttons: `a b x y lstick rstick ltrig rtrig lgrip rgrip start` |
| `menu open\|close` | the in-game Y menu |
| `reset_save` | clears wallet and cosmetics, respawns (name / room kept) |

Not in this web build (ack `ok: false`): Unity `ground` (Y-menu ground raise), `fly`, `noclip`, and jump targets `map_room`, `east_ext`, `waterline`. There is no pterodactyl / eaten state.

### State fields

Standard vrtk/1 keys (`protocol`, `game` = `primate-chaos`, `version` = the cave-test debug tag, `scene` = `cave-test`, `time`, `t`, `frame`, `perf`, `mem`, `debug`, `player`, `settings`, `wallet`, `game_state`, `errors`). Extra fields that match the Unity handoff where they apply: `player.zone`, `player.carried`, `player.eaten`, `player.times_eaten`; `settings.sound` / `muted` / `tag`; `wallet.bananas`; `game_state.id` (zone name), `menu_open`, `perf_line`. `wallet.tickets` is always 0. `settings.ground` is `"n/a"`.

### How VR Tester should drive this page

On Quest Browser or a desktop harness:

1. Open the cave-test URL (add `?vrtk=1` if you want 5 s state logs from the first play session with no other command).
2. Send commands with `window.VRTK.cmd('jump clearing')` from the remote-debug console or Puppeteer `page.evaluate`.
3. Capture console / logcat and run `vrtk_parse.py state` (and `acks`).
4. For a recording: `VRTK.cmd('record start smoke then="jump spawn"')`, play, `VRTK.cmd('record stop')`, then `VRTK.exportRec()` / `VRTK.lastRec`, and `vrtk_rec.py validate` on the text.
5. For comfort: `VRTK.cmd('trace on')`, move, `VRTK.exportTrace()` to a `.jsonl` file, then `vrtk_comfort.py --trace`.
6. Screenshots and bug bundles stay in `VRTK.lastShot` / `VRTK.lastBug` (this page cannot write `/sdcard/.../vrtk/`).
