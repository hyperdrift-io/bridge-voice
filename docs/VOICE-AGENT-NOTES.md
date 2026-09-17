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

## Second night (2026-09-03, later): the default model, measured

- **The session model cannot choose between tools.** With three tools it copied whatever
  example sat in a description; with six it latched onto one tool for every utterance; the
  opening instruction ("say exactly …") was routed through a tool as if the captain had
  spoken. It also voiced tool syntax aloud (`captain_said(text='act')`) and, on typed turns,
  answered from memory without calling any tool.
- **What works: one tool, deterministic routing, verbatim read-back.** A single
  `captain_said` tool is called on every spoken turn with the exact transcript (10/10 runs).
  `public/router.js` decides what the words meant. The result carries `say`, and the tool's
  `response_instructions.success` ("read the 'say' text aloud exactly as written, word for
  word, add nothing, never say the tool name") made the read-back 100 % verbatim and clean in
  3/3 runs, versus 58–84 % and occasional tool names without it. Handing the line back as a
  plain string instead of `{say}` did not help. `hold` execution mode made the model narrate
  the call; `interactive` stays clean.
- **Typed turns** (`conversation.message` + `reply.create`) need the instruction to name the
  tool call explicitly, or the model skips it.
- **BYO model is gated.** `session.update` rejects an `llm` block ("define it on a stored
  agent"). A stored agent accepts `llm` with the LLM Gateway, but this account gets "Your
  account does not have access to this LLM Gateway model" for every model except
  `qwen3.5-4b-32k-fast`, and a stored agent (default or BYO) streamed 15 s of silence and
  never called its HTTP tools. Stored agents are also mutually exclusive with client-side
  tools. Left as a founder question to AssemblyAI: does the hackathon account unlock
  gateway models?
- **Turn-to-tool on the spoken path with the single tool:** 1.9–2.3 s end of speech →
  `tool.call`, unchanged from the three-tool design.

## Third session (2026-09-17): the spoken path through a real browser

Measured with `scripts/mic-test.mjs`: headless Chrome, the real `getUserMedia` → worklet →
socket path, Chrome's fake capture device playing macOS-`say` utterances from a WAV, an
injected logger on the socket. Five sessions, 18 spoken turns. "End of speech" is the last
loud chunk the page sent, so capture and resampling are included; a physical microphone
and room are not.

| Step | Measured |
|---|---|
| start of speech → `input.speech.started` | 0.68–0.82 s (1.06 s when barging in on the officer) |
| end of speech → `tool.call` | 1.45–2.03 s |
| **end of speech → answer audio starts** | **1.48–2.06 s**, 16 of 18 turns |
| free question: `/ask` on the demo host (LLM Gateway, qwen) | 0.5–0.9 s on top |
| barge-in during the opening line | answered at 2.06 s, no lag afterwards |

One session of the five drifted: detection slipped from 0.8 s to 3.7 s over 145 s and the
last two answers started at 5 s. It did not reproduce in the two sessions (10 turns) that
followed, one of them with a barge-in. Cause unknown; watch for it.

- **The model sometimes calls the tool twice for one utterance** (3 of 9 turns; 1 of 10 after
  the prompt said "exactly once … never call it again until the captain speaks again"). The
  second call lands ~1.5 s into the answer and restarts the line. The island answers a
  second call in the same captain turn from a cache, so nothing is acted on twice; the
  audible restart remains when it happens.
- **A proactive line (`reply.create` "Say exactly …") is routed through the tool** with the
  instruction itself as `text`. Hand it back by turn count: the captain has not spoken since
  it was issued. Matching on the text fails, and routing it once parked item one off the
  officer's own "…or park it?".
- **The model gets `{say}` and nothing else.** Extra fields buy nothing from a model that
  only reads back.
- **Lines written for the eye cost seconds.** "2026-09-07 06:59 UTC" took the TTS 13–15 s
  per line. `officerForEar` turns ISO dates into "7 September" and drops symbols.
- **Headless Chrome reads a fake-capture WAV as silence** unless
  `--disable-features=AudioServiceSandbox` is set. No error, just zeros.
- **A snapshot with two inlined islands** (renderer + build-demo) leaves one dock dead:
  the scrub strips its `<form>`, the script throws before the worklet and the agenda client
  exist, and the mic error is swallowed. A human clicks the top, working dock, so it hides
  well. The build now attaches one island as files.
- **The gateway refuses bursts** ("too many requests for this action") on back-to-back
  `/ask` calls; one retry after 1.2 s covers it.
