# Bridge Voice — Agent Guide

Standalone repo (`hyperdrift-io/bridge-voice`), checked out at
`apps/poc/bridge-voice` in the Hyperdrift monorepo. Commit **here**, never
into the root monorepo. Inherits the Hyperdrift workspace guides
(`~/dev/hyperdrift/AGENTS.md`, `CLAUDE.md`, `meta/PHILOSOPHY.md`) — this file
adds the contest-specific rules.

## Mission

Contest entry for the lablab.ai AssemblyAI Voice Agent Hackathon
(Sep 1–30 2026, team "Hyperdrift"). Concept: **the real Hyperdrift Bridge,
the fleet cockpit never shown publicly, with a voice on it.** You speak and
the cockpit moves; the Commander's stored verdict is read back. The plan of
record is `docs/ONE-NIGHT-PLAN.md` (supersedes `docs/BUILD-PLAN.md`).
Measurements and protocol lessons: `docs/VOICE-AGENT-NOTES.md`.

## Hard rules

- **Contest window rule**: the voice layer (island, worklet, token function,
  build script) is built inside Sep 1–30 with dated commits. The Bridge is
  pre-existing infrastructure and the writeup says so plainly.
- **Kill condition**: ~2 s from end of speech to spoken answer. Measured
  1.8–2.1 s on 2026-09-03 with real audio; re-measure with `pnpm smoke`
  after any change to `SESSION` in `public/voice.js`. Laggy = withdraw.
- **Commit identity**: `yann@hyperdrift.io`, always. Never a personal gmail.
  No AI attributions or Co-Authored-By lines in commits.
- **The snapshot is the founder's call.** `public/index.html` is a scrubbed
  render of a private page. It stays gitignored, and nothing is deployed,
  until the founder has read the build report and approved sanitize vs seed.
- **Judge safety**: nothing writes. Three read-only tools. Sessions capped at
  300 s server-side, 120 s idle client-side.
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
- pnpm only. Zero production dependencies.
- English everywhere; one logical concern per commit; QA-then-merge, no PR
  unless genuinely needed.

## Wiring

- `window.bridge` is injected by `scripts/build-demo.mjs` at the end of the
  Bridge's IIFE. Tools call those functions; they never reimplement them.
- Tool routing is prompt-sensitive: few-shot examples live in
  `system_prompt`, descriptions carry trigger + anti-trigger only, and no
  literal example ever goes in a description (the model copies it).
- The Fleet Commander MCP is not involved at runtime.
