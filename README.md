# Bridge Voice — talk to the cockpit

The Hyperdrift Bridge is the cockpit a small fleet of live apps is steered
from. It has never been shown outside Hyperdrift. This entry puts a voice on
it: you speak, and the cockpit you are looking at moves. Ships focus, ranks
re-sort, the Commander's stored verdict is read back to you.

Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon)
(lablab.ai, September 1–30 2026).

## What AssemblyAI does here

One WebSocket to the Voice Agent API carries transcription, the model, the
voice and turn detection. **Turn detection fires the tool.** There is no
push-to-talk and no submit button: you stop talking and the cockpit is already
moving, about two seconds after your last word. The three tools the agent can call
drive the page's own functions and read data that is already in the page, so
the tool round-trip itself is effectively free. Measurements and the protocol
lessons: [docs/VOICE-AGENT-NOTES.md](docs/VOICE-AGENT-NOTES.md).

Honest scope: the Bridge itself is pre-existing Hyperdrift infrastructure. The
voice layer (`public/voice.js`, the worklet, the token function, the build
script) is the work built inside the contest window.

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
public/index.html        frozen, scrubbed Bridge snapshot + the voice island (built, gitignored until approved)
public/voice.js          the island: mic → worklet → socket → tool dispatch → playback
public/voice-worklet.js  AudioWorklet: Float32 → 24 kHz PCM16 chunks
public/voice.css         a handful of rules over the Bridge's own cascade
api/voice-token.js       the only server code: mints a single-use temp token
scripts/build-demo.mjs   snapshot → scrub → expose page functions → inject island
scripts/dev.mjs          zero-dependency local server
scripts/smoke.mjs        headless kill gate with timing
docs/ONE-NIGHT-PLAN.md   the plan this was built from
```

The Waku shell in `src/` predates the pivot and is not used by the demo.

## Tools

| Tool | Moves | Returns |
|---|---|---|
| `open_ship` | focus mode + the ship's detail dialog | position, stage, naval rank, constraint, confidence, visitors, conversions, next step, last read |
| `sort_fleet` | the fleet re-sorted by a metric | the ordered list |
| `read_commander` | the ship (or the fleet radar) | the stored verdict and the last recorded read, dated |

Nothing writes. Sessions are capped at five minutes and end after two quiet
minutes; there is no free tier.

MIT.
