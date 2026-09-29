// The officer as the model. AssemblyAI's "Connect your own LLM" calls POST {base_url}/chat/completions for every
// reply; this is that endpoint (base_url = https://<host>/api/voice/llm). The platform keeps everything voice: it hears
// the captain, decides when the turn ended, handles barge-in and speaks the line. What to say is decided here, by the
// same pure modules the browser runs (router.js, watch.js), so no session model stands between the captain and the fleet.
// Stateless: the conversation so far arrives with every request, and the watch is rebuilt by replaying the captain's
// past utterances. Replay records nothing; the island records decisions as they are spoken.
import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load, doneLine } from "./agenda.js";
import { answerQuestion } from "./ask.js";

const file = (rel) => fileURLToPath(new URL(rel, import.meta.url));
new Function(readFileSync(file("../../public/router.js"), "utf8"))();
new Function(readFileSync(file("../../public/watch.js"), "utf8"))();
const { create, shipLine, readLine, proposes } = globalThis.officerWatch;

const text = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p.text || "").join(" ") : "").trim();
// Two ways in from the island, both measured on the platform 2026-09-29 (an injected conversation.message never arrives):
const STATE = "OFFICER_STATE "; // one line of JSON in the session's system prompt (session.update, when the watch opens): what is live on the agenda, and the cockpit's facts
const SAY = "OFFICER_SAY "; // the instructions of a reply.create: the line to speak as it stands (a report, an interrupt; every line when the island's own ear is open)
const lastSentence = (line) => (String(line).match(/[^.?!]+[.?!]+\s*$/) || [String(line)])[0].trim();

// The line for the newest captain utterance. Everything before it is replayed dry: the watch moves, nothing is asked of
// the brain (what it answered is already in the transcript) and nothing is recorded.
export async function reply(messages, { ask = answerQuestion } = {}) {
  const unprompted = messages.map((m, i) => (m.role === "system" && text(m.content).startsWith(SAY) ? i : -1)).filter((i) => i >= 0).pop();
  if (unprompted !== undefined && !messages.slice(unprompted + 1).some((m) => m.role === "user" || m.role === "assistant")) return globalThis.officerForEar(text(messages[unprompted].content).slice(SAY.length));
  const handed = messages.filter((m) => m.role === "system" && text(m.content).includes(STATE)).map((m) => { try { return JSON.parse(text(m.content).split(STATE)[1].split("\n")[0]); } catch { return null; } }).filter(Boolean).pop() || {};
  const agenda = load({ live: Array.isArray(handed.live) ? handed.live : [] });
  const watch = create(agenda, { decide: async (key, decision) => ({ done: doneLine(agenda.items.find((i) => i.key === key) || {}, decision) }) });
  const facts = (ship) => (handed.ships || []).find((f) => f.ship === ship) || null;
  const turns = []; // [captain's words, what the officer then said (from the transcript, when there is one)]
  for (const m of messages) {
    if (m.role === "user" && text(m.content)) turns.push([text(m.content), ""]);
    else if (m.role === "assistant" && turns.length && !turns[turns.length - 1][1]) turns[turns.length - 1][1] = text(m.content);
  }
  let line = watch.open().say, proposal = false, proposed = "", hold = false;
  for (const [i, [words, answered]] of turns.entries()) {
    const live = i === turns.length - 1;
    const turn = await watch.converse(words, { proposal });
    proposal = false;
    hold = Boolean(turn.hold); // an order acknowledged: the island carries it out and the report asks the next question
    if (turn.kind === "watch") line = turn.say;
    else if (turn.kind === "proposal-yes") line = `Logged as a next step: ${proposed.replace(/^Shall I\s+/i, "").replace(/\?$/, "")}. On the live fleet this lands in the ship's notebook.`;
    else if (turn.kind === "cockpit") {
      const f = turn.route.ship && facts(turn.route.ship);
      line = turn.route.intent === "navigate" ? "Done." : f ? (turn.route.intent === "read" ? readLine(f) : shipLine(f)) : `I have ${turn.route.ship || "that"} on the screen for you.`;
    } else { // a real question
      if (!live) { proposal = proposes(answered); proposed = lastSentence(answered); continue; }
      try {
        const a = await ask({ question: words, ship: turn.ship, facts: facts(turn.ship), fleet: turn.ship ? null : handed.fleet || null, state: watch.state() });
        line = a.busy ? (await watch.hear({ intent: "busy", seconds: a.busy })).say : `${a.say}${a.proposal ? ` ${a.proposal.ask || "Shall I?"}` : ""}`;
      } catch { line = (await watch.hear({ intent: "unclear" })).say; }
    }
  }
  const say = globalThis.officerForEar(line);
  return hold || /[?]["”']?$/.test(say) || /Fair winds/.test(say) ? say : `${say} What next, Captain?`; // every line ends on a question, the farewell aside
}

export default async function handler(req, res) {
  const secret = process.env.OFFICER_LLM_KEY;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: "unauthorised" }); return; }
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "POST only" }); return; }
  const started = Date.now();
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-200) : [];
  // What the platform hands a custom model is not documented in detail; the shape of each request (roles and lengths,
  // never the words) goes to stdout so a host's logs can settle it. First platform run 2026-09-24: see the notes.
  console.log(`[llm] ${messages.map((m) => `${m.role}:${text(m.content).length}`).join(" ")} stream=${req.body?.stream !== false}`);
  if (process.env.LLM_DEBUG) console.log(`[llm-debug] keys=${Object.keys(req.body || {}).join(",")} headers=${Object.keys(req.headers || {}).filter((h) => h !== "authorization").join(",")} user=${JSON.stringify(req.body?.user || null)} meta=${JSON.stringify(req.body?.metadata || null)} systems=${JSON.stringify(messages.filter((m) => m.role === "system").map((m) => text(m.content).slice(0, 160)))}`);
  const say = await reply(messages);
  if (process.env.LLM_LOG) appendFileSync(process.env.LLM_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ms: Date.now() - started, request: req.body, say })}\n`);
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: `officer-${started}`, object: "chat.completion.chunk", created: Math.floor(started / 1000), model: req.body?.model || "first-officer", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  if (req.body?.stream === false) {
    res.status(200).json({ id: `officer-${started}`, object: "chat.completion", created: Math.floor(started / 1000), model: "first-officer", choices: [{ index: 0, message: { role: "assistant", content: say }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
    return;
  }
  res.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  res.raw.write(chunk({ role: "assistant", content: "" }));
  for (const sentence of say.match(/[^.?!]+[.?!]+\s*|[^.?!]+$/g) || [say]) res.raw.write(chunk({ content: sentence })); // sentence by sentence: the voice can start on the first
  res.raw.write(chunk({}, "stop"));
  res.raw.end("data: [DONE]\n\n");
}
