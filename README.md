# Bridge Voice — talk to your fleet

Speak, and a live fleet of apps moves.

Bridge Voice is a voice agent that turns a spoken command into real MCP tool
calls against Hyperdrift's production fleet. Ask it "how did revela do
overnight?" or "what shipped yesterday?" and it answers back in voice with the
real numbers — from live apps, not a mock.

Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon)
(lablab.ai, September 1–30 2026).

## Why AssemblyAI is the star

The demo's heartbeat is the **AssemblyAI Voice Agent API** — one WebSocket
(`wss://agents.assemblyai.com/v1/ws`) that carries streaming transcription,
LLM reasoning, text-to-speech, and **tool calling** in a single connection.
Universal-3.5 Pro Realtime's intelligent endpointing (~300ms end-of-turn
detection) is the trigger: the instant your command completes, the agent fires
an MCP tool against the fleet. No push-to-talk, no submit button. Swap
AssemblyAI out and the product stops existing — that's the point.

## What it is not

Not another chatbot with a mic bolted on, and not a "voice for any API"
platform pitch. One fleet, real apps, real numbers, one voice-confirmed write
action.

## Status

Pre-window scaffold. Per lablab rules the core — voice pipeline, agent logic,
MCP wiring — is built inside the September 1–30 window. Plan:
[docs/BUILD-PLAN.md](docs/BUILD-PLAN.md).

## Stack

Waku (React Server Components) + typed server functions + pure cascading CSS.
pnpm. ~5 production dependencies. The voice channel is the AssemblyAI Voice
Agent API; the actuator is Hyperdrift's Fleet Commander MCP.

```sh
pnpm install
pnpm dev
```

## License

[MIT](LICENSE)
