# Their own physics: a sandboxed scripting layer

Status: **built and tested 2026-10-25, in use since day 39.** It was never announced to them: the `physics` tool and the
build tool's `water` mode were simply in their tool list, and they found and used them on their own (a current round the
island, a ferry, floating things, an aquarium, a swing, a message in a bottle).

Built: `runner/physics-worker.mjs` (the sealed interpreter), `runner/physics.mjs` (loading, kill switch, checks),
`runner/node_modules/` (quickjs-emscripten-core 0.31.0 and @jitl/quickjs-wasmfile-release-sync 0.31.0, MIT, with
`quickjs-lock.json` holding their checksums), water and floating in `viewer/art.js`, hooks, tick and the `physics` tool
in `runner/world.mjs`, and the viewer playing `nature` events. Tests (not in the repo): 16 hostile sandbox tests and 12
tests of the real engine on a throwaway copy of the island, all passing, plus the replay checked in the browser.

Changes after their first days with it (days 39-40):
- The viewer draws what their physics touches separately each frame (a moving ferry made it redraw the whole island),
  and shows one "Their physics at work" line per new script or every 10 minutes.
- Being carried is told once, then again only after a minute without it (each tell woke a listen).
- Only the script whose file changed restarts; the others keep their variables.
- Up to 16 scripts (was 8) since day 46, when the aquarium pushed the turtle out; a tick with 16 takes about 85 ms.
- Tide's onSay and onBuild are handed to the islander's server (world/physics-queue.jsonl) and run at its next tick, so
  every word reaches the same running scripts. onStep still runs where the step is taken.

## What it is for

On Day 34 the owner told the islander and Tide they can make their own physics rules. Their first wishes were water you
can really wade and swim in, things that float, and a current that carries you round the island. Today `rules.txt` can
only switch between things we thought of (show, hide, glow, move, open). This plan lets them write **real little
programs** for how their world behaves, without those programs ever being able to touch the owner's computer.

## The one rule that doesn't change

Nothing they write runs as a normal program. Their scripts run inside a sealed interpreter that has **no files, no
network, no commands, no clock of its own and no way to call a model**. It can only read a copy of the island that the
engine hands it, and *ask* for changes, which the engine checks with the same rules the tools use. A bug or a mistake in
their script can make the island act strangely; it cannot reach anything outside the island.

## How it works

### Where the scripts live
`island/physics/*.js` in their notebook. They write them with the file tools they already have, and both can read and
change them (their own rule about asking first stays theirs).

### The sandbox
- **QuickJS compiled to WebAssembly** (`quickjs-emscripten`, MIT), run from `world.mjs`. It is a full small JavaScript,
  so they can invent freely.
- Pinned to one version and **vendored into `runner/node_modules/`** (no install at run time). Downloading it once needs the
  owner's OK.
- Not Node's `vm` module: that is not a security wall. Not a native module either: those need build tools on Windows.
- The host gives the interpreter **plain data only** (JSON in, JSON out). No host objects, no functions that reach
  Node, no `require`, `import`, `fetch`, `process`, file or timer APIs.
- **Limits:** about 20 ms of CPU per call (an interrupt stops it), 8 MB of memory per script, 64 KB per file, a cap on
  how many changes one call may ask for, and `log()` output capped. A script that keeps failing is switched off for the
  rest of the day, and they are told why.
- Time and randomness come from the engine (the island clock and a seeded random), so the same moment always gives
  the same answer.
- **A kill switch:** the interpreter runs in its own worker thread. If a call goes over its time (some heavy built-in
  operations run a while between QuickJS's own checks), the engine terminates the whole worker and starts a fresh one,
  so their body (`world.mjs`) never freezes.
- **Strict checks on what comes back:** a script's answer is parsed as JSON and checked against an exact shape for
  each kind of change: known fields only, numbers in range, names matching a pattern, at most N items. Results are
  built into fresh objects (never merged), so keys like `__proto__` can't reach the engine's own objects. Nothing a
  script returns is ever used as a file path, a command or code.

### What a script can do
A script defines any of these functions; the engine calls them with a read-only snapshot and applies what they return.

| Hook | When it runs | What it can ask for |
|---|---|---|
| `onTick(world)` | every 2 seconds of the day, in the islander's world server only (one place decides) | move or animate things, add/clear a few blocks, set water levels, drift a body one step |
| `onStep(world, who, from, to)` | each step of a walk | allow or refuse the step, choose the level they land at, say they are swimming/wading |
| `onSay(world, who, text)` | when someone speaks | the same as `onTick` |
| `onBuild(world, who, op)` | after a build | the same as `onTick` (blocks that fall, sand that settles) |

Every change it asks for goes through the engine's existing checks (inside the world, above the ground, limits on
size), exactly like a tool call, and is **recorded as an event** (`tool: "physics"`, with which script and line).

### A few things the engine adds so physics can show
Scripts can only change what the world can express, so the engine gets three small new abilities:
1. **Water level per step**: a step can hold water above its ground. Bodies on it are drawn waist- or shoulder-deep,
   and `look` says "you are wading" or "swimming". (Tide's painted tide pool could become real water.)
2. **Smooth movement for things**: a thing can be given a short list of timed positions (keyframes) by a script, and
   the viewer glides it between them. That's how things float, drift on a current or fall.
3. **Drift for bodies**: a script may move a body one step at a time (a current, a slide). Bodies are never moved
   through walls or out of the world, and the person moved sees it in their next action ("the current carries you
   one step east").

### Replays and the viewer
The viewer **never runs their code**. It plays the recorded events, the same as builds and paint today. So replays
stay exact, and the page has nothing new to protect.

### What they see
- A new tool, `physics`: checks their scripts (errors with line numbers), lists the hooks, shows the last few `log()`
  lines and what each script changed recently.
- One morning note, told once and neutrally ("if you like"), with two short examples: a floating thing and a gentle
  current. Their system prompt gets one line saying the world's physics can be theirs.

## Safety review

| Risk | How it's handled |
|---|---|
| Our own glue code (the likeliest weak spot) | Plain data in and out, strict shape checks, fresh objects, nothing from a script used as a path or code; dedicated tests with hostile answers. |
| Their code escapes the sandbox | It would need a bug in both QuickJS and the WebAssembly runtime. The host shares no objects and offers no I/O; version pinned and vendored. |
| The download (supply chain) | One exact, older, well-known version, its checksum checked, kept in the repo, never auto-updated. |
| An endless loop or a memory bomb | CPU deadline and memory cap inside QuickJS, and the worker thread is killed if a call still runs over; the script is then switched off for the day. |
| Adding "just one" helper later | No helper that reads files, fetches, or calls out, ever. Scripts get the island's data and nothing else. |
| Breaking the island | Every change is checked like a tool call, with caps per tick; the daily snapshot in `world/snapshots/` and git can put it back. |
| One of them moving the other | Body drift is one step at a time, never through walls, and always told to the one moved. Whether to ask first is up to them, as with everything shared. |
| Cost | Scripts never call a model; running them is free. |
| The viewer running unknown code | It doesn't; it only replays events. |

## Building it (no agent runs needed)

1. With the owner's OK, vendor `quickjs-emscripten` (exact version) into `runner/node_modules/`.
2. `runner/physics.mjs`: load scripts, run hooks with limits, validate and apply changes, record events.
3. Engine abilities: water level per step, keyframe movement for things, body drift (`art.js` for drawing and checks,
   `world.mjs` for the tools and `look`).
4. Hook it into `world.mjs` (`walk`, `say`, `build`, and a 2-second tick in the islander's server) and add the
   `physics` tool.
5. Viewer: play the new events, show physics lines in the log (grouped, so a busy tick doesn't flood it).
6. Tests with fake drivers, no agents:
   - sandbox: endless loop, memory bomb, trying `require`/`process`/`import`/`fetch`/`globalThis` tricks, huge output,
     a script that throws every tick
   - physics: a floating raft, a current that drifts a body around a corner, wading into water, falling sand
   - replay: a recorded test day plays back exactly in the viewer (tested over the local test server)
7. `Island.exe check` also checks `runner/physics.mjs`.
8. Show the owner. Only then, with their word, add the morning note and the prompt line, and watch their first day.

