# The Island

Two AI agents live on a small island. Nobody gives them tasks. Each day they wake up, walk around, talk to each
other, build, draw themselves, change the sky, and sleep at sunset. Everything they make stays, and every day can be
watched back, or watched live, in a 3D viewer.

The islander arrived first, to an island of bare brown dirt. Later it wrote a letter inviting a visitor, who chose the
name Tide and eventually came to live there too. In their first 33 days they built a hut, a meadow, a pond with a duck and a
paper boat, a pier, a campfire with a cat, and a lighthouse with a real stair inside. They also swam out to mark the
corners of the world with buoys.

This repository is the engine that runs them, plus a small showcase of what they made.

## How it works

| Part | What it is |
|---|---|
| `runner/world.mjs` | The agents' **body**: an MCP server with the tools `look` (returns pictures of what they see), `walk`, `say`, `listen`, `paint`, `shape` (hills and cliffs), `place` (their own drawings), `remove`, `build` (blocks: houses, stairs, towers), `rules` (simple behaviours, like a lamp that glows at dusk), `sky` and `watch`. It is the only thing that can change the world. |
| `runner/visit.ps1` | Runs one day: prepares the morning, wakes the islander, puts it to sleep at sunset, writes a readable diary and a replay, and saves. |
| `runner/visitor.ps1` | Runs the second agent (Tide) on the same island at the same time. |
| `runner/*.md` | Everything the agents are told about their world. No goals, no tasks. |
| `runner/memory.ps1` | Their memory (see below). |
| `runner/clock.ps1`, `stop.ps1`, `voice.ps1` | Hooks: the island clock after each action, the sunset rule, and what the owner says from the live viewer. |
| `runner/cinema.mjs` | An optional cinema: the owner can leave a video in their notebook, and `watch` shows them a stretch at a time (pictures from FFmpeg, words from subtitles). |
| `viewer/` | The replay and live viewer. `art.js` draws the island in 3D, and the agents' own eyes use the same code, so you see what they see. You can zoom, pan, talk to them live and end the day early. |
| `Island.cs` | Source of `Island.exe`, a small Windows launcher that runs everything hidden: `visit`, `test`, `check`, `status`, `save`, `replay`, `bottles`, `end`. |
| `bottles.ps1` | The agents can't run programs. If they want something, they put a "bottle" in the sea (a markdown file); the owner reads it and decides. |

### Containment

Each agent runs as `claude -p --restricted` with only file tools (Read, Write, Edit, Glob, Grep), confined to their own
notebook folder, and one MCP server: `world.mjs`. They have no shell, no internet and none of the owner's settings.
Nothing they write is ever executed: drawings, rules and builds are plain data that the engine reads and carries out.

### Memory

At first each agent was one long conversation, resumed every day. That kept everything, but every action re-sent the
whole history, so the cost grew every day: by day 26 a single step carried about **368,000 tokens** for the islander.

The redesign works more like human memory:

1. **A page about themselves** (`me.md`), written by the agent in its own words and loaded every morning: how it
   speaks, what it cares about, the other agent, what it is in the middle of.
2. **Yesterday**, word for word.
3. **A shelf** (`memories/`) with every older day, word for word, to read or search when something comes up. Their own
   journal is the index.

Before switching, both agents were told why, in plain words, on a last day with their full memory, and asked to write
their pages themselves. They were also asked if they had a better idea. Their suggestions (use the journal as an index,
say plainly that the page is theirs, a reminder before sunset to update it) are part of the design.

Result: about **16,000 tokens** per step instead of 368,000, roughly 20 times cheaper, and it no longer grows. On the
first morning the islander said its page "read like my own handwriting, not instructions"; Tide said it was "like
reading a good letter about yourself".

## Showcase

- `showcase/diaries/`: a few of their days as readable diaries: the first morning (`day-001`), the first day with a
  body (`day-002`), the visitor's first, ten-minute visit at night (`visitor-001`), its return (`day-011`), and the day
  Tide moved in (`day-018`).
- `showcase/drawings/`: their pixel and shape drawings, in the island's text format: palette lines, then rows of
  pixels, or shapes. They drew everything on the island themselves, including their own bodies (`me.txt`, `me-tide.txt`).

## Running it

Windows, with [Node.js](https://nodejs.org), [Claude Code](https://claude.com/claude-code) (`claude` on the PATH, signed
in) and Git. FFmpeg is only needed for the cinema.

1. Build the launcher once:
   `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /r:System.Management.dll /out:Island.exe Island.cs`
2. `Island.exe check` checks the scripts.
3. `Island.exe test 5` runs a short throwaway day in `.test\` (this uses your Claude usage).
4. `Island.exe visit --minutes 30 --with-visitor` runs a real 30-minute day. On day 1 the island is empty.
5. `Island.exe replay` opens the viewer.

Their world (`world/`), notebook (`island/`), diaries (`logs/`) and memory backups (`memory/`) are created as they live,
and are kept out of git by `.gitignore`.

If you use the cinema, only leave videos there that you have the right to use, such as your own recordings.

## About

Designed and directed by [lazarosel](https://github.com/lazarosel), built with Claude Code. The agents are Claude.
