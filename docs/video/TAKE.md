# Recording the demo take

The video is one real watch on the Bridge: the captain talking, the officer answering, the screen following. Nothing
staged, no narration over it. The rehearsal cut (24 Sep) used a synthetic captain voice; the real take is the founder's.

## What the rig records

`scripts/mic-test.mjs --live --take <dir>` opens a headed Chrome on the local host bound to the own-LLM agent, with the
real microphone (permission granted by flag) and the speakers on. While the watch runs it keeps:

- every frame Chrome paints, at 2x (2560x1440), with Chrome's own timestamps;
- the officer's audio per reply, exactly as the platform streamed it;
- the captain's own audio, taken from what the page sends the service (24 kHz, already echo-cancelled), so it sits on
  the same clock as the frames;
- live captions in the page: the officer's line as it is spoken, the captain's as it is heard. The dock's hint and
  typed input are hidden during a take; everything else is the product as shipped.

The take ends when the captain says goodbye ("that's all", "that's all for today", "goodbye"), or after `--max` seconds.

```bash
cd ~/dev/hyperdrift/apps/poc/bridge-voice
set -a; . ./.env; set +a          # ASSEMBLYAI_API_KEY, OFFICER_LLM_KEY, OFFICER_AGENT_ID
OFFICER_AGENT_ID=$OFFICER_AGENT_ID node scripts/mic-test.mjs --live --take .growth/take-founder --max 240
node scripts/assemble-take.mjs .growth/take-founder ~/Desktop/first-officer-master.mp4
bash ~/dev/hyperdrift/scripts/video/stitch.sh ~/Desktop/first-officer-contest.mp4 ~/Desktop/first-officer-master.mp4 \
  ~/dev/hyperdrift/.growth/publishing/youtube/first-officer/work/credits.mp4
```

Use headphones or a quiet room: the browser cancels its own echo, but a loud speaker next to the mic can still cut a
line short. Wait for the officer to finish before answering; a word spoken over its last syllable is the one case the
platform can drop.

## The beats (about 1:45)

| When | Captain says | What happens on screen |
|---|---|---|
| 0:00 | (nothing: press *Open the watch*) | The officer opens: three things on the agenda. All four ships come forward. |
| ~0:18 | "the reads" | The four ships overdue a read, three choices. |
| ~0:32 | "intel" | Intel alone is ringed; the rest recede. Its item and two choices on the table. |
| ~0:46 | "why" | The evidence, one line. |
| ~1:00 | "run it" | The decision is recorded; the three ships left are offered. |
| ~1:14 | "what is holding intel back?" | A real question: the fleet's brain answers with one proposal. Intel stays marked. |
| ~1:34 | "that's all for today" | "Watch closed. One decision logged. Fair winds, Captain." The session ends itself. |

Say the words your own way; the router hears "the reads", "the fixes", "you choose", "why", "go on", "run it", "park
it", "hand them all over", "menu", "say that again", "thanks", and a goodbye. Anything that sounds like a question goes
to the brain. Keep the whole watch under two minutes: the contest cut adds a four-second credits card and must stay
comfortably inside the five-minute cap; two minutes is the bar the contest skill sets.

## Two cuts from one take

- **Contest cut** (`first-officer-contest.mp4`): the product at 0:00, the credits card last. No pitch, no brand intro.
- **Blog cut** (`first-officer.mp4`): the same take with the ai.hyperdrift.io outro. The article embeds this one.

Both are 1440p H.264; YouTube gets the 1440p master. The article and the lablab form take the same files.
