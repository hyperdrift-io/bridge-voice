# Bridge Voice — Agent Guide

Standalone repo (`hyperdrift-io/bridge-voice`), checked out at
`apps/poc/bridge-voice` in the Hyperdrift monorepo. Commit **here**, never
into the root monorepo. Inherits the Hyperdrift workspace guides
(`~/dev/hyperdrift/AGENTS.md`, `CLAUDE.md`, `meta/PHILOSOPHY.md`) — this file
adds the contest-specific rules.

## Mission

Contest entry for the lablab.ai AssemblyAI Voice Agent Hackathon
(Sep 1–30 2026, team "Hyperdrift"). Concept of record since 2026-09-03: **the
First Officer**, a voice that reports to the captain over the real Hyperdrift
Bridge. It opens the watch with the top agenda item, explains why, records the
decision, answers a free question through the right fleet skill with one
proposal, and the cockpit follows the conversation. AssemblyAI hosts the
conversation; the fleet does the thinking. Plan of record:
`docs/FIRST-OFFICER.md` (it supersedes `docs/ONE-NIGHT-PLAN.md` and
`docs/BUILD-PLAN.md`). Where the work stands: `docs/RESUME.md`. Measurements
and protocol lessons: `docs/VOICE-AGENT-NOTES.md`.

**Conversation first** (founder, 2026-09-03): the entry is done when the
captain holds five spoken turns (open → why → next → do it → free question →
yes) with answers starting about 2 s after he stops. Everything else on the
roadmap is a bonus.

## Hard rules

- **Contest window rule**: the voice layer (island, worklet, token function,
  build script) is built inside Sep 1–30 with dated commits. The Bridge is
  pre-existing infrastructure and the writeup says so plainly.
- **Kill condition**: ~2 s from end of speech to spoken answer. Measured
  1.5–2.1 s on 2026-09-17 through a real Chrome and the real mic path
  (`node scripts/mic-test.mjs`, 16 spoken turns). Re-measure after any change
  to `SESSION` in `public/voice.js` or to `public/mic.js`. Both gates open a
  paid session ($4.50 per hour): use them sparingly and say when you do.
  Laggy = withdraw.
- **Commit identity**: `yann@hyperdrift.io`, always. Never a personal gmail.
  No AI attributions or Co-Authored-By lines in commits.
- **The snapshot is the founder's call.** `public/index.html` is a scrubbed
  render of a private page. It stays gitignored, and nothing is deployed,
  until the founder has read the build report and approved sanitize vs seed.
- **Judge safety**: nothing public writes to a production ship. Decisions on
  the demo host are held in memory; the one real write is Helm's sandbox ship
  (`api/voice/control.js`). Sessions capped at 300 s server-side, 120 s idle
  client-side.
- **The voice never guesses a click.** The cockpit follows an item to a panel
  that exists, or stays put.
- **Sponsor-first**: the AssemblyAI Voice Agent API is the star. Turn
  detection fires the tool; if Whisper could replace the sponsor, the design
  is wrong.
- **Voice Covenant** (`meta/PHILOSOPHY.md` #8) applies to every word the
  agent speaks and every line of the writeup — enable, never diminish; sound
  human. The founder writes the name, tagline and description himself.

## Stack rules

- Static HTML + one serverless function. No framework, no bundler, no SDK:
  raw WebSocket + AudioWorklet. The Waku shell in `src/` is unused.
- Pure cascading CSS (`public/voice.css`). No Tailwind, no CSS-in-JS.
- npm only (pnpm is decommissioned; `pnpm-lock.yaml` is scaffold debt). Zero
  production dependencies: the scripts run on bare Node ≥ 22, no install.
- English everywhere; one logical concern per commit; QA-then-merge, no PR
  unless genuinely needed.

## Wiring

- `window.bridge` is injected by `scripts/build-demo.mjs` at the end of the
  Bridge's IIFE. Tools call those functions; they never reimplement them.
- The session model cannot choose between tools (measured 2026-09-03), so
  there is **one tool**, `captain_said`, called once per utterance.
  `public/router.js` decides deterministically what the words meant, the
  result carries `say`, and the model reads it back verbatim. The model gets
  `{say}` and nothing else. No literal example ever goes in a tool
  description (the model copies it).
- The conversation is `public/watch.js`: pure, tested offline, shared by the browser and by `api/voice/llm.js`
  (the officer as the model, for AssemblyAI's own-LLM stored agents). The order of a turn lives in
  `watch.converse`; change it there or the two callers drift apart.
- **The screen answers every turn** (founder, 2026-09-18). Each line carries a view of what is on the table;
  `public/cockpit.js` shows it and moves the Bridge to match. A ship's own panel opens only when the captain
  asks to see it. Never leave the fleet in focus mode or behind a panel the conversation has moved on from.
- The island's files are served with a content stamp (`?v=…`) and the host sends `no-store`: a cached island
  behind a fresh page cost an hour on 2026-09-18 and looked exactly like a logic bug.
- Every line the officer speaks ends on a question and passes through
  `officerForEar` (dates a person would say, no symbols).
- `public/mic.js` owns capture and mic health; the dock always shows one of
  listening · hearing · heard · silent · unheard · stalled · blocked.
- The Fleet Commander MCP is not involved at runtime.
