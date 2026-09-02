# AssemblyAI Voice Agent API — what we measured

Written 2026-09-03 during the build night. Numbers come from `scripts/smoke.mjs`
streaming a macOS-TTS WAV ("show me revela", "rank by traffic") in real time
over the real socket, so they include AssemblyAI's end-of-turn detection but
not microphone capture. Re-run with `pnpm smoke -- --audio <wav> <tool>`.

## The pipe

| Step | Measured |
|---|---|
| token mint (server → `GET /v1/token`) | ~0.3–0.4 s |
| socket open → `session.ready` | ~0.3 s |
| greeting spoken (TTS of one sentence) | ~3 s from open |
| end of speech → `input.speech.stopped` + `transcript.user` | 0.67–1.1 s |
| `transcript.user` → `tool.call`, adaptive turn detection | ~2.1 s |
| `transcript.user` → `tool.call`, `min_silence 200 / max_silence 500` | ~1.2 s |
| `transcript.user` → `tool.call`, `min_silence 100 / max_silence 300` | ~1.0 s |
| **end of speech → cockpit moves (`tool.call`)** | **1.75–2.06 s** |
| **end of speech → answer audio starts** (eager `tool.result`) | **1.8–2.1 s** |

A text turn (`conversation.message` + `reply.create`) fires the tool in
~0.5 s. The difference on the speech path is turn confirmation, not the LLM.

## Things the docs did not say, or said differently

- **`tool.result` can be sent the moment the tool returns.** The docs say to
  wait for `reply.done`. Sent eagerly during the filler reply, the server
  accepts it, ends the filler and starts the answer immediately. That is
  worth ~2.3 s per turn. No error seen in a dozen runs.
- **Setting `min_silence`/`max_silence` also shortens the wait between the
  final transcript and the LLM call.** The docs frame these as end-of-turn
  windows only. Adaptive pacing adds roughly a second before the model runs.
- **Literal examples inside a tool `description` get copied.** With
  `'show me revela' → open_ship(ship='revela')` in the description, every
  utterance ("rank by traffic" included) produced that exact call. With
  `'show everything' means rank_fleet` in the prompt, "show me revela" became
  `rank_fleet`. Few-shot examples belong in `system_prompt`, several of them,
  one per tool; descriptions carry the trigger and the anti-trigger only.
  This matches the ranking in the tools overview, with the emphasis reversed.
- **`execution_mode: "hold"` did not speed up the tool call.** Same filler,
  same timing. Left on `interactive`.
- Pure digital silence (zeros) after the utterance is fine for turn
  detection; no need to synthesise noise in tests.
- The greeting is immutable after the first `session.update`; so is the
  voice. Everything else in the island's `SESSION` can be changed mid-call.
- `audio_rate_violation` fires if audio is streamed faster than real time.
  The smoke test paces 50 ms chunks on a 50 ms timer.

## Cost guard

No free tier: $4.50 per hour of open session. The token function caps every
session at 300 s (`max_session_duration_seconds`), the island ends the session
after 120 s without speech and on tab hide, and the function rate-limits to
twelve sessions per address per hour. `session.end` is sent on every teardown
so the 30 s resume window is not billed.
