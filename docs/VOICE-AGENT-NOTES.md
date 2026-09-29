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

## Fourth session (2026-09-18): the managed model off the happy path, and the way out

After the founder's verdict ("I can't have a conversation with it"), the conversation became a pure module
(`public/watch.js`) and the spoken gate was pointed at what people actually do: answer before the officer has quite finished.

- **Natural pace works.** Eight spoken turns, each answered 1.6–2.2 s after the end of speech, one tool call per turn,
  the goodbye ending the session by itself.
- **Speaking over the tail of the officer's line loses turns, two ways.** (a) The service transcribes the words but the
  managed model answers without calling the tool: it re-read the whole opening (12 s), and the next utterance, spoken under
  it, was lost too. (b) The service drops the words: `input.speech.stopped` and never a `transcript.user`. Barge-in is
  "semantic", and a short answer near the end of a line does not count as one.
- **A client cannot cancel a reply.** There is no cancel event, and `reply.create` queues behind the reply in progress.
  A watchdog that muted the improvised reply and queued the right line left 13 s of silence, after which the model voiced
  tool syntax and re-read the opening. Removed. What stays: into silence only, "Sorry, Captain, I was still talking. Say
  that again?" when loud speech ended and no transcript came.
- **The LLM Gateway on this account:** one model (`qwen3.5-4b-32k-fast`), `x-ratelimit-limit: 2` per ~35 s window, and
  every frontier model answers "Your account does not have access". A 4B model will not classify-or-answer in one prompt;
  it states facts backwards now and then ("has been verified" for "must be verified").
- **The way out is in the platform: "Connect your own LLM".** A stored agent takes `llm: [{ base_url, model, api_key }]`
  and the platform calls `POST {base_url}/chat/completions` (OpenAI schema, streamed) for every reply. `api/voice/llm.js`
  is that endpoint: the officer as the model. Same router and watch as the browser, stateless (the watch is rebuilt by
  replaying the captain's utterances; past questions are not asked again), facts handed over once by the island as a
  `FLEET_FACTS` system message, unprompted lines as `OFFICER_SAY`. No tool round-trip, no model to go off script.
  Tested offline (`scripts/llm.test.mjs`) and over local HTTP. **Not yet run against the platform**: it needs a public
  HTTPS host. Open questions for that first run: does this account accept a custom `llm`, are `conversation.message`
  system messages forwarded to it, and does a bare `reply.create` call it with no user message.

## The screen has to answer too (2026-09-18)

Founder, on the rebuilt conversation: "the UI doesn't update according to voice command, every command should trigger the
relevant part of UI so voice control visual and there is a relationship."

- **Every line now carries a view** of what is on the table (`watch.js`), and `cockpit.js` puts it on screen: the topic,
  its evidence as it is read, and the choices as buttons that go through the same conversation as the spoken words.
- **The Bridge answers as well**: ships under discussion are marked and the rest recede, via one attribute on `<html>` and
  one per ship. A topic with no ship (a contest, a set of fixes) dims the whole fleet, which reads as "this is not about
  the ships" — and on the live Bridge its own panel is marked and scrolled to.
- **A ship's panel opens only when asked** ("show me revela"). Opening it for an item on the table buried both the fleet
  and the officer's own surface, and left focus mode on, so the next turn showed one card while four were being discussed.
- **A stale island behind a fresh page looks exactly like a logic bug.** An hour went into "the UI does not move" that was
  a cached `voice.js`. The host now sends `no-store` and the island's files carry a content stamp in their URL.

## The goal script, and the settings, re-measured (2026-09-18)

- **The goal's own script** (open → why → next → do it → free question → yes), spoken through the real page:
  answers at 1.6–2.6 s, the free question at 2.6 s (its answer comes from the gateway). "Why?" straight after the
  opening now answers about the agenda itself ("Nothing is on the table yet. The voice hackathon deadline is the most
  pressing, because…") instead of repeating the menu.
- **Turn detection, A/B over six spaced turns each** (`mic-test.mjs --session`):

  | Setting | Speech detected after | Answer starts after |
  |---|---|---|
  | `min_latency`, `min_silence 200` / `max_silence 500` (ours) | 0.68–1.02 s | **1.57–2.05 s** |
  | adaptive (no `turn_detection`), `balanced` (the docs' advice) | 0.53–2.36 s | 3.65–4.65 s |

  The docs' default fails the ~2 s bar by two seconds. Ours stays.
- **Drift is intermittent, not ours.** Two sessions of about fourteen today saw speech detection climb from ~0.8 s to
  2–3.6 s over a minute or two; the same settings and audio pacing (sent audio stays ~15 ms ahead of the wall clock)
  held steady in the others. Watch for it on the founder's run; it is the one number we cannot move.
- `min_latency` misheard "menu" as "Many" on four of six turns; short command words are now key terms.

## Fifth session (2026-09-24): the officer as the model, on the platform

The founder logged into gcloud, so the API-only container went to Cloud Run (`bridge-voice-api`, project
`hyperdrift-distribution`; no page, the snapshot excluded by `.gcloudignore`) and `scripts/agent.mjs create` made the
stored agent whose `llm` is that host's `/api/voice/llm`. The account accepts a custom `llm` block.

- **A bare `reply.create` on session.ready produced our opening line verbatim.** No tool, no prompt, no model in
  between: the endpoint decided the line and the platform spoke it.
- **Spoken turns reach the endpoint.** Four turns (why → yes → the fixes → hand them all over), each answered with
  exactly the line the browser would have produced; the island mirrored the conversation and recorded the decision
  once. **End of speech → answer audio: 1.37–1.93 s**, and the first sound *is* the answer (no filler, no tool call).
- **Barge-in survived.** "Yes" spoken over the last word of the previous line trimmed that line's transcript and was
  still answered correctly, the case that made the managed model re-read old lines.
- **Injected `conversation.message` user turns are not handed to a custom model.** Proven by the host's logs: after a
  typed "why" the endpoint received `system:1344 assistant:153` and no user message (the platform wraps our short
  system prompt in about 1.3 k characters of its own). So typed mode (`#text`) stays on the managed session; the agent
  binds only when the mic is in use.
- The socket-only probe: 156 ms from the typed turn to first audio.

Latency budget on this path is the platform's STT and TTS plus one HTTPS round trip to Cloud Run (~50 ms from
europe-west1); the endpoint itself answers in under 10 ms.

## The video, recorded from the real page (2026-09-24)

The founder asked for the video and the article. The demo is one real watch, recorded by the spoken gate itself
(`mic-test.mjs --take`): Chrome's 2x screencast frames at their own timestamps, the officer's audio per reply as the
platform streamed it, the captain's audio (scheduled WAVs in a rehearsal, the page's own outgoing stream in a `--live`
take), and captions rendered in the page. `assemble-take.mjs` muxes it with ffmpeg; verified against the event log:
quiet at −91 dB, both voices where the log says.

- **Own-LLM replies stream no `transcript.agent.delta`**; the final `transcript.agent` lands as the audio ends. Live
  captions therefore come from the island's mirror of the line (it computes the same line the endpoint says), with the
  final transcript as the fallback for the brain's answers.
- **Chrome's noise suppression strips a synthetic noise floor**, so a scheduled take still reports "sends pure silence"
  in the dock; the take hides the mic line. A real microphone never has this problem.
- Five takes, 1.2–1.9 s from end of speech to the answer on every scripted turn; the free question 2–3 s.

## Sixth session (2026-09-29): a second way in, and Universal-3.6 Pro Realtime as the ear

The founder's verdict on the first video: long blanks between question and answer, and not striking enough. Measured
on that take: 20 s of dead air out of 100, all of it from a captain on a fixed schedule. Two things changed.

**What reaches a custom model, settled by probe** (socket only, the host logging the shape of each request):

- `reply.create` with `instructions` arrives at the endpoint as one more system message, last in the list, for that
  reply only. `OFFICER_SAY <line>` in it and the officer says the line: this is how a report or an interrupt is spoken.
- `session.update` with a `system_prompt`, sent after the session is bound to an agent, replaces the prompt the
  endpoint is handed. One line of JSON in it (`OFFICER_STATE`) carries what is live on the agenda and the cockpit's
  facts. At bind time the same field is refused: "agent_id is mutually exclusive with other session fields".
- An injected `conversation.message`, user or system, still never arrives. The request carries `messages`, `model`,
  `stream`, `stream_options` and nothing that names the session.
- From `reply.create` to the first audio: 350 ms on the first line of a session, 129–136 ms after that.

**Universal-3.6 Pro Realtime** was released that morning (Streaming API, `speech_model=universal-3-6-pro`; it is also
what the Streaming API now runs when no model is named). The Voice Agent API documents no field to choose its speech
model. On the captain's own orders (six short lines, a generated voice, keyterms set): six of six heard right, the
turn called 0.34–0.50 s after the voice stopped; one first line took 0.83 s. Universal-3.5 Pro gave the same words and
the same times on this clean audio, so the difference the release notes measure (short replies, names, noise) is not
one this test can show.

**The ear path.** The microphone goes to the Streaming API; the island decides the line the moment the turn is
called; the Voice Agent API speaks it. In the browser, over four takes of six turns: answers start **0.5–0.8 s** after
the captain's voice ends. The longest silence in the conversation is 1.2 s.

- **Barge-in is the island's job on this path.** The voice cannot be cancelled, so the island drops the audio, ends
  that voice session and opens another while the captain is still speaking. A fresh session is ready in about 0.45 s;
  the answer to a one-word barge-in started 0.8–1.0 s after the word.
- **A one-word order has guesses for partials** ("Koga" before "Cargo."). The take shows finals only.
- **The voice agent session needs no audio in.** It stayed up for the whole watch with nothing sent but lines to say.
- With the ear off, the same page on the same host answers in 1.4–1.5 s (the voice agent hearing for itself).

**An order, carried out and checked.** Cargo is Helm's sandbox ship. When it does not answer, that leads the agenda.
"Bring it back" goes to Helm; the island shows Helm's own steps as they are logged, probes the ship from outside until
it has answered twice in a row, and only then has the officer report, unprompted. From the captain's first word to the
report: 12.7 s in the recorded take, about 4 s of it Helm's.
