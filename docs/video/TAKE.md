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

## The reactive take (2026-09-29)

`scripts/take.mjs` records the same things with a captain who listens: each line in `docs/video/script.json` goes out
0.7 s after the officer has really finished (its audio played, any order carried out), or cuts in a set number of
seconds into the officer's line (`cutIn`). The captain's lines are WAV files (`u0.wav`, `u1.wav`… in script order),
handed to the page as its microphone. On screen, for the video only: what the captain was heard to say and by which
model, the officer's line as it is spoken, and the measured time from the end of the captain's voice to the first
sound of the answer.

```bash
curl -X POST https://helm-294160018950.europe-west1.run.app/control/cargo/maintenance   # the sandbox ship, offline for the opening
node scripts/take.mjs <dir> --url http://127.0.0.1:8787 --voices <dir with u0.wav…> --script docs/video/script.json
node scripts/assemble-take.mjs <dir> master.mp4 --tail 1.2
```

## The beats (1:12, take 10)

| When | Captain says | What happens on screen |
|---|---|---|
| 0:00 | (nothing: press *Open the watch*) | Cargo takes its berth, red. The officer opens with what is on the agenda. |
| 0:06 | "Cargo." (over the officer) | The officer stops mid-sentence. Cargo comes forward; the choices appear. |
| 0:14 | "Bring it back." | Helm's steps land one by one; Cargo turns amber, then green. |
| 0:19 | (nothing) | Unprompted: "Captain, Cargo answers again. Checked twice." |
| 0:30 | "Yes." | The next topic on the agenda; its ship comes forward. |
| 0:43 | "Why?" | The evidence, one line. |
| 0:54 | "Hand it over." | The decision is recorded; the next topic is offered. |
| 1:06 | "That's all for today." | "Watch closed. Two decisions logged. Fair winds, Captain." The session ends itself. |

## Two cuts from one take

- **Contest cut** (`first-officer-contest.mp4`): the product at 0:00, the credits card last. No pitch, no brand intro.
- **Blog cut** (`first-officer.mp4`): the same take with the ai.hyperdrift.io outro. The article embeds this one.

Both are 1440p H.264; YouTube gets the 1440p master. The article and the lablab form take the same files.
