// The officer as the model. AssemblyAI's "Connect your own LLM" calls POST {base_url}/chat/completions for every
// reply; this is that endpoint (base_url = https://<host>/api/voice/llm). The platform keeps everything voice: it hears
// the captain, decides when the turn ended, handles barge-in and speaks the line. What to say is decided here, by the
// same pure modules the browser runs (router.js, watch.js), so no session model stands between the captain and the fleet.
// Stateless: the conversation so far arrives with every request, and the watch is rebuilt by replaying the captain's
// past utterances. Replay records nothing; the island records decisions as they are spoken.
import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = (rel) => fileURLToPath(new URL(rel, import.meta.url));
new Function(readFileSync(file("../../public/router.js"), "utf8"))();
new Function(readFileSync(file("../../public/watch.js"), "utf8"))();
const SPOKEN = { approve: "Logged as approved.", reject: "Logged as rejected.", defer: "Parked; I will bring it back.", acknowledge: "Noted." };

const text = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p.text || "").join(" ") : "").trim();

export async function reply(messages) {
  const agenda = JSON.parse(readFileSync(file("../../fixtures/agenda.json"), "utf8"));
  const doneLine = (key, verdict) => {
    const item = agenda.items.find((i) => i.key === key) || {};
    if (item.kind === "heal" && verdict === "approve") return `Approved ${item.keys.length} findings; on the live fleet this hands them to an agent.`;
    if (item.kind === "read" && verdict === "approve") return `On the live fleet this starts a Commander read on ${item.ship}. Here it is logged.`;
    return SPOKEN[verdict] || "Logged.";
  };
  const watch = globalThis.officerWatch.create(agenda, { decide: async (key, decision) => ({ done: doneLine(key, decision) }) });
  const said = messages.filter((m) => m.role === "user").map((m) => text(m.content)).filter(Boolean);
  let line = watch.open();
  for (const words of said) {
    const heard = await watch.hear(globalThis.officerRoute(words));
    line = heard || (await watch.hear({ intent: "unclear" }));
  }
  return globalThis.officerForEar(line.say);
}

export default async function handler(req, res) {
  const secret = process.env.OFFICER_LLM_KEY;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: "unauthorised" }); return; }
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "POST only" }); return; }
  const started = Date.now();
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-200) : [];
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
