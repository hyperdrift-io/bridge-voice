# Bridge Voice — Agent Guide

Standalone repo (`hyperdrift-io/bridge-voice`), checked out at
`apps/poc/bridge-voice` in the Hyperdrift monorepo. Commit **here**, never
into the root monorepo. Inherits the Hyperdrift workspace guides
(`~/dev/hyperdrift/AGENTS.md`, `CLAUDE.md`, `meta/PHILOSOPHY.md`) — this file
adds the contest-specific rules.

## Mission

Contest entry for the lablab.ai AssemblyAI Voice Agent Hackathon
(Sep 1–30 2026, team "Hyperdrift"). Concept: **speak, and a live fleet of
apps actually moves** — AssemblyAI's end-of-turn detection fires real MCP
tool calls against Hyperdrift's production fleet; judges drive a read-only
sandbox tenant themselves at a live URL. Doubles as distribution material for
The Crew.

## Hard rules

- **Contest window rule**: the CORE (voice pipeline, agent logic, MCP wiring)
  is built DURING Sep 1–30. Before Sep 1: scaffold, docs, research only — no
  working voice-agent logic. lablab requires original work built in the
  window, MIT-compliant (LICENSE is MIT — keep it).
- **Kill condition**: speak-to-action must feel instant — ~2s end-to-end from
  end of speech to spoken answer. If the turn-fire moment can't be made to
  feel instant, downgrade to KILL rather than submit a laggy also-ran.
  Budget breakdown: `docs/BUILD-PLAN.md`.
- **Commit identity**: `yann@hyperdrift.io`, always. Never a personal gmail.
  No AI attributions or Co-Authored-By lines in commits.
- **Judge safety**: judges never get write access. Sandbox tenant is
  read-only. Exactly one write action, voice-confirmed, founder-authenticated
  only.
- **Sponsor-first**: AssemblyAI primitives (Voice Agent API /
  Universal-Streaming) are the star of every demo moment and every line of
  the writeup. If Whisper could replace the sponsor, the design is wrong.
- **Voice Covenant** (`meta/PHILOSOPHY.md` #8) applies to every word the
  agent speaks and every line of the writeup — enable, never diminish; sound
  human, not agent-generated.

## Stack rules

- own-stack: Waku RSC + typed server functions. No Next.js. Reference shape:
  `apps/poc/own-stack`.
- Pure cascading CSS (`src/styles.css`, "Night Bridge" direction). No
  Tailwind, no CSS-in-JS, no utility class systems. Primitives carry the
  design; classes are a last resort.
- pnpm only. Target ~5 production dependencies — the AssemblyAI connection is
  a raw WebSocket + AudioWorklet, no SDK required.
- English everywhere; one logical concern per commit; QA-then-merge, no PR
  unless genuinely needed.

## Fleet wiring (read before building the MCP layer)

The actuator is the Fleet Commander MCP
(`~/dev/hyperdrift/scripts/commander/mcp_server.py`, stdio; HTTP facade at
`127.0.0.1:8765` via `hd commander serve`). Demo tools and the latency budget
are pinned in `docs/BUILD-PLAN.md` — do not improvise new fleet surfaces
mid-demo.
