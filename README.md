# Bridge Voice — the First Officer

The Hyperdrift Bridge is the cockpit a small fleet of live apps is steered from. This entry
puts a person on it who reports to the captain. The First Officer opens the watch with the
one thing that matters, asks for a decision, explains why when challenged, takes the order,
answers a real question with an opinion, proposes the next step, and moves the cockpit to
whatever is being discussed. You do not need the screen. It follows you.

Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon)
(lablab.ai, September 1–30 2026). Concept of record: [docs/FIRST-OFFICER.md](docs/FIRST-OFFICER.md).

## What AssemblyAI does here

One WebSocket to the Voice Agent API hosts the conversation: turn detection fires the
action about two seconds after your last word, barge-in is understood, the officer can
speak first, and the transcript is verbatim. The fleet does the thinking: an agenda of
what to decide with the evidence attached, decisions recorded through the fleet's own
paths, a question routed to the right fleet skill, urgent events spoken unprompted.
Measurements and what the docs did not say: [docs/VOICE-AGENT-NOTES.md](docs/VOICE-AGENT-NOTES.md).

Honest scope: the Bridge and the fleet's control plane are pre-existing Hyperdrift
infrastructure. The voice layer, the router, the agenda/decide/ask/interrupt contract and
the demo host are the work built inside the contest window.

## Run it

```bash
cp .env.example .env            # ASSEMBLYAI_API_KEY — sign up through the hackathon page link so credits attach
pnpm serve                      # static public/ + POST /api/voice-token on http://127.0.0.1:8787
pnpm smoke                      # headless kill gate: token → socket → greeting → text turn → tool call
pnpm smoke -- --audio utt.wav open_ship   # same, streaming a 24 kHz PCM16 WAV in real time
```

Refresh the snapshot from the monorepo:

```bash
cd ~/dev/hyperdrift/scripts && python3 -m bau.cli fleet-status --html --out /tmp/bridge.html
cd - && pnpm build:demo -- /tmp/bridge.html --reads ~/dev/hyperdrift/.nightcrew
```

The build scrubs private surfaces and prints a report. `public/index.html` is
the frozen result and stays out of git until the founder has read that report.

## Layout

```
public/index.html        frozen, scrubbed Bridge snapshot with the officer inlined (built, gitignored until approved)
public/router.js         the officer's ear: the captain's words → one intent, deterministically (tests: scripts/router.test.mjs)
public/voice.js          the island: session, audio, the watch, the single tool, cockpit tools
public/voice.css         a handful of rules over the Bridge's own cascade
api/voice/token.js       mints a single-use temp token (the key never reaches the browser)
api/voice/agenda.js      the agenda contract from a frozen, scrubbed day (fixtures/agenda.json)
api/voice/decide.js      records a decision, returns the next item
api/voice/ask.js         a question → skill → opinion + one proposal (gateway model on the demo host)
api/voice/interrupts.js  Helm's sandbox events, spoken unprompted
api/voice/control.js     the judges' write path: Helm's sandbox ship only, rate-limited
api/voice/officer.js     server-side officer state (for stored-agent HTTP tools; parked, see notes)
scripts/build-demo.mjs   snapshot → scrub → expose page functions → inline router + island
scripts/dev.mjs          zero-dependency local server: static + every api/voice/<name>.js
scripts/smoke.mjs        headless kill gate: audio in, timing, routing, read-back fidelity
scripts/agent.mjs        stored agents (BYO model + HTTP tools) — blocked by model access on this account
scripts/transcribe.mjs   what the agent actually said, via the batch API
```

On the live Bridge the same contract is served by the Crew API (`scripts/commander/agenda.py`,
`ask.py`, `voice.py` in the monorepo) and the island is inlined by the renderer. Add `#text`
to the URL to type to the officer instead of speaking.

## What the captain can say

| Said | The officer |
|---|---|
| (opens the watch) | states item one and asks for a decision |
| why? · why is that first? | reads the evidence, repeats the question |
| do it · yes · run it · no · park it · noted | records it through the fleet, says what happens, moves on |
| next · skip · what else | the next item |
| the brief · what's on the agenda | counts by kind, fleet numbers, where we are |
| show me intel · how is hyper-cv doing | focuses the ship, reads its numbers |
| what's the read on revela | the Commander's stored verdict |
| open the commands · search signals · click … · close | drives the cockpit |
| anything else | a considered answer from the right fleet skill, then one proposal; "yes" logs it |

Nothing writes to a production ship from the public demo. Sessions are capped at five
minutes and end after two quiet minutes; there is no free tier.

MIT.
