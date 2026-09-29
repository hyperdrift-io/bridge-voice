# Bridge Voice — the First Officer

The Hyperdrift Bridge is the cockpit a small fleet of live apps is steered from. This entry
puts a person on it who reports to the captain. The First Officer opens the watch with the
one thing that matters, asks for a decision, explains why when challenged, takes the order,
answers a real question with an opinion, proposes the next step, and moves the cockpit to
whatever is being discussed. You do not need the screen. It follows you.

Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon)
(lablab.ai, September 1–30 2026). **Try it:** https://bridge-voice-294160018950.europe-west1.run.app.
Concept of record: [docs/FIRST-OFFICER.md](docs/FIRST-OFFICER.md).

## What AssemblyAI does here

Two AssemblyAI services carry the conversation. **Universal-3.6 Pro Realtime** (Streaming API, released
2026-09-29) hears the captain and calls the end of the turn; the **Voice Agent API** speaks, through a stored agent
whose model is the officer's own endpoint. Between the two the island decides the line at once, so an answer starts
0.5–0.8 s after the captain stops (measured in the browser over five takes; 0.8–1.0 s when the captain cut the officer off). The fleet does the thinking: an agenda
of what to decide with the evidence attached, decisions recorded through the fleet's own paths, a question routed to
the right fleet skill, an order carried out by Helm and reported back unprompted once it is checked.
Measurements and what the docs did not say: [docs/VOICE-AGENT-NOTES.md](docs/VOICE-AGENT-NOTES.md).

Honest scope: the Bridge and the fleet's control plane are pre-existing Hyperdrift
infrastructure. The voice layer, the router, the agenda/decide/ask/interrupt contract and
the demo host are the work built inside the contest window.

## Run it

```bash
cp .env.example .env                 # ASSEMBLYAI_API_KEY — sign up through the hackathon page link so credits attach
CREW_API=0 npm run serve             # static public/ + /api/voice/<name> on http://127.0.0.1:8787 (no install needed)
node --test scripts/*.test.mjs        # the ear, whole conversations, and the officer-as-LLM endpoint: offline, free
node scripts/mic-test.mjs "why@17" "next@42"   # spoken-path gate: real Chrome, a WAV as the microphone (paid session)
npm run smoke                        # socket-only gate from Node: token → socket → turn → tool call (paid session)
```

Open http://127.0.0.1:8787 in Chrome and allow the microphone, or add `#text` to type instead.
The dock always shows the mic's state: listening, hearing, heard, or what is in the way — and what is on the
table: the topic, its evidence as it is read, and the choices as buttons that go through the same conversation.
The Bridge answers every turn: the ships under discussion come forward and the rest recede.

Refresh the snapshot from the monorepo:

```bash
cd ~/dev/hyperdrift/scripts && python3 -m bau.cli fleet-status --html --out /tmp/bridge.html
cd - && npm run build:demo -- /tmp/bridge.html --reads ~/dev/hyperdrift/.nightcrew
```

The build scrubs private surfaces and prints a report. `public/index.html` is
the frozen result and stays out of git until the founder has read that report.

## The ear (live since 2026-09-29)

With `OFFICER_EAR=universal-3-6-pro` the token endpoint also mints a Streaming API token and the island opens its own
ear (`public/ear.js`). The microphone goes to the ear, never to the voice agent. At the end of a turn the island runs
the router and the watch, and hands the line to the voice with `reply.create` and `instructions: "OFFICER_SAY …"`,
which the platform passes to the officer's endpoint as the last system message. Measured: the turn is called
0.39–0.49 s after the voice stops; the officer's voice starts 0.13–0.35 s after it is handed the line.

The voice cannot be stopped once it has a line (a `reply.create` queues behind the reply in progress; there is no
cancel). So when the captain speaks over the officer, the island drops the audio at once, hangs up on that voice
session and dials a new one while the captain is still talking: the answer to a barge-in starts in 0.8–1.0 s.
`#ear=off` on the URL, or an ear that fails to open, falls back to the path below.

## The officer as the model (own-LLM path, live since 2026-09-24)

The managed session model goes off script when a turn leaves the happy path (notes, fourth session). AssemblyAI lets a
stored agent call your own OpenAI-compatible endpoint for every reply, so the officer is the model: the API-only host
`bridge-voice-api` on Cloud Run serves `/api/voice/llm`, the stored agent points at it, and the island binds to that
agent whenever the microphone is in use. With the ear off, the voice agent hears for itself and asks the endpoint for
every line: answers start 1.4–1.9 s after the captain stops, with no model in between. What is live on the agenda and
the cockpit's facts reach the endpoint in the session's system prompt (`OFFICER_STATE`, one line of JSON).

```bash
# .env: ASSEMBLYAI_API_KEY, OFFICER_LLM_KEY=<long random>, OFFICER_AGENT_ID=<from create>; optional ANTHROPIC_API_KEY
gcloud run deploy bridge-voice-api --source . --clear-base-image --project hyperdrift-distribution --region europe-west1 \
  --allow-unauthenticated --max-instances 2 --set-env-vars "ASSEMBLYAI_API_KEY=…,OFFICER_LLM_KEY=…,API_ONLY=1,CREW_API=0"
node scripts/agent.mjs create https://bridge-voice-api-294160018950.europe-west1.run.app   # once; then OFFICER_AGENT_ID in .env
OFFICER_AGENT_ID=agent_… node scripts/mic-test.mjs "why@16" "yes@30"                        # the spoken gate on this path
```

Typed turns (`#text`) are injected messages, which the platform does not hand a custom model, so typing stays on the
managed session. Without `OFFICER_AGENT_ID` the island configures the session itself and uses the managed model.

## The judges' page

Live at **https://bridge-voice-294160018950.europe-west1.run.app** (Chrome, allow the microphone, press *Open the watch*).
One Cloud Run service serves the frozen snapshot, the officer's files and `/api/voice/*`; sessions are capped at 300 s and
the key stays server-side. Nothing on it writes to a production ship. One ship does take orders: **Cargo**, Helm's
sandbox. Say "take Cargo offline", then "bring it online": Helm carries the order out, the officer probes the ship from
outside until it has answered twice, and only then reports.

With `WATCH_CODE` set, the watch opens by invitation: a session, a question to the model and an order all need the code
the invited link carries (`?watch=<code>`). The page and the agenda stay open to read. It keeps a public URL from
spending the speech account for anyone who finds it. `WATCHES_PER_DAY` (default 30) is the ceiling for everyone
together, counted in the running instance: deploy the page with one instance kept up so the count holds.

```bash
scripts/deploy-page.sh                      # stages exactly what the container needs and deploys it
node scripts/take.mjs /tmp/gate --url https://bridge-voice-294160018950.europe-west1.run.app --voices <dir> --script docs/video/script.json   # the spoken gate, against the public page
```

## The demo video

One real watch, recorded from the page: `node scripts/take.mjs <dir> --url … --voices <dir> --script docs/video/script.json`
(the captain's lines go out a moment after the officer really finishes, or cut in where the script says), or
`node scripts/mic-test.mjs --live --take <dir>` (the founder, real microphone); then `node scripts/assemble-take.mjs <dir>
out.mp4` and the cards in `docs/video/`. How to record it, the beats and the two cuts: `docs/video/TAKE.md`.

## Layout

```
public/index.html        frozen, scrubbed Bridge snapshot that loads the officer's files (built, gitignored until approved)
public/router.js         the officer's ear and mouth: words → one intent, lines made sayable (tests: scripts/router.test.mjs)
public/cockpit.js        the officer's hands: what is on the table, and the Bridge moved to match
public/watch.js          the conversation itself: the officer offers, the captain chooses (pure; tests: scripts/watch.test.mjs)
public/mic.js            the microphone: capture → 24 kHz PCM16, and the health read the dock shows
public/ear.js            the ear: AssemblyAI's streaming model hears the captain and calls the end of the turn
public/voice.js          the island: session, playback, the watch, the single tool, cockpit tools
public/voice.css         a handful of rules over the Bridge's own cascade
api/voice/token.js       mints a single-use temp token (the key never reaches the browser)
api/voice/agenda.js      the agenda contract from a frozen, scrubbed day (fixtures/agenda.json), led by what is live (the sandbox ship, probed)
api/voice/decide.js      records a decision, returns the next item
api/voice/ask.js         a question → skill → opinion + one proposal (gateway model on the demo host)
api/voice/interrupts.js  Helm's sandbox events, spoken unprompted
api/voice/control.js     the judges' write path: Helm's sandbox ship only, rate-limited; reads back the ship and Helm's steps
api/voice/llm.js         the officer as the model: OpenAI-compatible endpoint for AssemblyAI's own-LLM agents (tests: scripts/llm.test.mjs)
scripts/deploy-page.sh   the judges' page to Cloud Run, from a staged copy
scripts/build-demo.mjs   snapshot → scrub → expose page functions → attach the officer's files
scripts/mic-test.mjs     spoken-path gate: real Chrome, fake capture device, per-turn timing
scripts/take.mjs         records a take with a captain who follows the officer's real pace; also the gate for the ear path
scripts/dev.mjs          zero-dependency local server: static + every api/voice/<name>.js
scripts/smoke.mjs        headless kill gate: audio in, timing, routing, read-back fidelity
scripts/agent.mjs        the stored agent whose model is api/voice/llm.js: create, point, list, delete
scripts/transcribe.mjs   what the agent actually said, via the batch API
```

On the live Bridge the same contract is served by the Crew API (`scripts/commander/agenda.py`,
`ask.py`, `voice.py` in the monorepo) and the island is inlined by the renderer. Add `#text`
to the URL to type to the officer instead of speaking.

## What the captain can say

The officer opens by naming what is on the agenda and asking which one first. From there:

| Said | The officer |
|---|---|
| the hackathon · the second one · intel | puts that topic, or that ship out of a set, on the table with its choices |
| you choose · what would you do? | gives an opinion with its reason; "yes" acts on it |
| why? · go on · what's that about? | the evidence, a line at a time |
| go for it · hand them all over · run it · park it · drop it · noted | records it, then offers what is left |
| one by one | walks through a set |
| menu · what else is there · next | what is still open |
| show me intel · what's the read on revela | focuses the ship in the cockpit and reads its numbers |
| a real question | a considered answer from the right fleet skill, ending on one proposal |
| say that again · thanks · that's all | repeats, stays polite, closes the watch and ends the session |

Nothing writes to a production ship from the public demo. Sessions are capped at five
minutes and end after two quiet minutes; there is no free tier.

MIT.
