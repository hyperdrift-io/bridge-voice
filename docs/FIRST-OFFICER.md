# First Officer — the concept of record

**Decided 2026-09-03 with the founder. Supersedes the "voice remote control" reading of
`ONE-NIGHT-PLAN.md`; keeps its plumbing.**

## The idea in one paragraph

The captain does not operate a dashboard. The captain talks to the First Officer, who
reports to them. The officer opens the watch with the one thing that matters, asks for a
decision, explains why when challenged, takes the order, executes it through the fleet's
own agents, and moves the cockpit to whatever is being discussed so the screen follows the
conversation instead of driving it. Urgent things interrupt the conversation, politely.
The UI stays. You just do not need it.

Why this is a new application of the sponsor's service, not a bot with a mic: the
Voice Agent API is used for what it alone does well — turn-taking, barge-in, speaking
first (`reply.create`), context injection (`conversation.message`), a verbatim transcript
as the audit trail — while the judgement comes from a real, running control plane with
weeks of state. The market this opens is voice-first management of agent fleets: anyone
who runs autonomous agents needs someone who reports to them.

## Where the brain is

The Crew API (`scripts/commander/`, served at `fleet.hyperdrift.io/api`) already holds:

| Source | What it gives the officer |
|---|---|
| heal ledger (`/ops/heal`) | findings needing the captain's call, with evidence; approve → an agent fixes it (`/ops/execute`) |
| contest ledger + daily review | APPROVAL NEEDED items with a default decision and a one-line rationale |
| Commander reads (`.nightcrew`, `/apps/<app>/…`) | verdict · pragmatic call · opportunity · evidence, per ship |
| notifications (`/notifications`) | what changed, alerts, deadlines — the interrupt source |
| fleet status (`/snapshot`) | numbers, stages, constraints — the "how is X" answers |

One new endpoint, `GET /voice/agenda`, folds these into an ordered agenda: each item has
`key`, `kind`, `ship`, `headline` (one spoken sentence), `why` (evidence lines), `options`
(approve / reject / defer / custom), `default`, `urgency`, `ui` (what the cockpit should
show: ship, panel, section). `POST /voice/decide` records the captain's decision through
the existing `ops.record_decision` / contest ledger paths and returns what happens next.
`GET /voice/interrupts?since=` returns new urgent notifications for injection mid-watch.

No `claude` CLI in the voice loop: `ops.chat` takes up to three minutes. The officer's
"why" is answered from the evidence already attached to the item.

## The conversation

- **Open the watch.** The island fetches the agenda, injects it as context, and asks the
  agent to open with the top item and a question. "Morning, Captain. One thing first:
  intel's subscription funnel has been silent for a week and the read says the capture
  path is broken, not the users. Shall I hand it to an agent, or park it?"
- **Why?** `why(key)` returns the evidence lines; the officer reads them, plainly.
- **Decide.** "Do it" → `decide(key, approve)` → `ops.execute` → the officer confirms and
  says what the agent will do. "Park it" → defer with a date. "Not now" → next item.
- **Next / brief / what's the fleet doing.** `next()`, `brief()` read from the agenda and
  the snapshot; the cockpit focuses the ship or panel each time (`ui` hint → `open_ship`,
  `navigate`).
- **Interrupts.** Every 20 s the island polls `/voice/interrupts`; an urgent item is
  injected with `conversation.message` and voiced with `reply.create` — only when the
  captain is not mid-sentence (`input.speech.started` … `transcript.user` window).
- **Challenge the officer.** "Why is that first?" → the ordering rule is in the agenda
  (`urgency` + rationale) and the officer says it. Disagreement is welcome: the captain's
  decision is recorded verbatim, transcript included.
- **Ask for anything else** — the existing tools (`open_ship`, `sort_fleet`,
  `read_commander`, `navigate`, `set_mode`+`confirm`) stay.

Voice Covenant applies to every line the officer speaks: strengths first, a gap is a next
step, never blame. The officer reports to the captain; it never talks down.

## Public repo, private fleet

lablab requires a **public GitHub repository**, a demo platform and an application URL.
The fleet does not need to be public. Split:

- **Public (this repo):** the island, the agenda/decide/interrupt contract (OpenAPI +
  fixtures), the demo host that serves the same contract from a frozen, scrubbed agenda
  and the Helm sandbox, the smoke tests, the writeup.
- **Private (monorepo):** the Crew API implementation of the contract over real data.
  Disclosed in the writeup as pre-existing infrastructure; the voice layer and the
  agenda contract are in-window work.
- **Video:** the real fleet, real agenda, real decisions. **Judges' URL:** the same
  officer over the frozen agenda; the red button on Helm's sandbox is the live moment.

## Roadmap (decided 2026-09-03, conversation first)

The session model cannot be trusted to think (measured: misrouted three-word commands,
invented options, merged agenda items; the gateway's strong models are locked for this
account). So: **the service hosts the conversation, the fleet does the thinking.**

1. **A human conversation, testable.** One tool for every utterance; a deterministic
   router (`public/router.js`) decides; free-form questions go to `POST /voice/ask`,
   which picks the skill by the question (strategist · app-strategist · growth · ops),
   loads the ship's context, read and signals, and runs the fleet's headless agent with
   one rule: answer for the ear, under eighty words, opinion first, then one proposed
   next step as a yes/no. Hold mode with spoken status updates covers the wait.
   Typed input in the dock so the conversation can be tested without a microphone.
2. **Proposals become actions; the fleet interrupts.** "Yes" after a proposal creates the
   mission, note, read or approved fix. Urgent notifications and Helm events are spoken
   unprompted, never over the captain.
3. **Mastery features.** Transcript as the audit ledger (word-timed), dynamic key terms
   and transcription prompt from the agenda, progressive tool reveal by phase, barge-in
   as the safety interlock on writes.
4. **Reach.** The fleet rings you (Twilio, founder decision), the watch log via the batch
   API, far-field voice focus, a French watch.

## Increments

1. `GET /voice/agenda` + `POST /voice/decide` + `GET /voice/interrupts` in the Crew API,
   pure functions, unit-tested, fixtures exported for the demo host.
2. Island: `open_watch` on session start (context + first reply), tools `why`, `decide`,
   `next`, `brief`; `ui` hints drive the cockpit; interrupt poller with the
   hold-while-speaking rule.
3. Demo host: same contract from `fixtures/agenda.json` (scrubbed from a real day) and
   the Helm sandbox; `smoke.mjs` scenario: open watch → why → decide → interrupt.
4. Real Bridge: `ASSEMBLYAI_API_KEY` in the org-runtime vault, redeploy the runtime, the
   island renders into fleet.hyperdrift.io; founder runs a real watch.
5. Video, then the founder writes the fields.

Kill condition unchanged: the officer must answer inside ~2 s of the captain's last word.
Measured baseline 1.8–2.1 s for tool turns; the agenda is fetched once per session so it
adds nothing per turn.
