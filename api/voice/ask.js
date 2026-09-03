// Demo host: a question answered by the one model this account can reach through AssemblyAI's LLM Gateway,
// with the same shape as the live fleet's /voice/ask (skill by question, context, opinion first, one proposal).
// On the live Bridge the answer comes from the fleet's own headless agent with the full skill and ship context.
import { load } from "./agenda.js";

const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
const MODEL = process.env.ASK_MODEL || "qwen3.5-4b-32k-fast";
const RULES = [
  [/\b(worth|should (we|i)|pursue|pursuing|idea|pivot|feature|build|bet|kill|double down)\b/, "strategist"],
  [/\b(next|stage|priorit|focus|roadmap|what would you do)\b/, "app-strategist"],
  [/\b(improve|grow|growth|conversion|convert|traffic|visitors|users|activation|landing|onboarding|retention|funnel|revenue|pricing)\b/, "growth-analysis"],
  [/\b(fix|finding|heal|deploy|broken|error|failing|outage|down)\b/, "ops"],
];
const GUIDES = {
  strategist: "Pressure-test the idea against the app's mission, its growth signal and the opportunity cost across the fleet. Verdict GO, REFINE or KILL, then why.",
  "app-strategist": "Derive the app's stage from evidence (INTENT → BUILD → SHIP → GROW) and name the one next move that fits the stage. No premature work.",
  "growth-analysis": "Find the broken stage in the funnel from the numbers you have, name the lever with the best expected return, and say what to measure.",
  ops: "Say what is broken, what the fix is, and whether an agent can do it safely without the captain.",
};
export const accepted = [];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "POST only" }); return; }
  if (req.body?.accept) {
    const p = req.body.accept;
    accepted.push({ ...p, ts: new Date().toISOString() });
    res.status(200).json({ ok: true, kind: p.kind, say: `Logged as a ${p.kind === "mission" ? "mission" : "note"} for ${p.ship || "the fleet"}: ${p.title}. On the live fleet this lands in the ship's notebook.` });
    return;
  }
  const question = String(req.body?.question || "").trim();
  if (!question) { res.status(400).json({ ok: false, error: "question is required" }); return; }
  const ship = String(req.body?.ship || "").toLowerCase();
  const skill = (RULES.find(([re]) => re.test(question.toLowerCase())) || [null, "strategist"])[1];
  const agenda = load();
  const context = agenda.items.filter((i) => !ship || i.ship === ship || !i.ship).slice(0, 6).map((i) => `- [${i.kind}${i.ship ? " " + i.ship : ""}] ${i.headline} ${i.why.slice(0, 2).join(" ")}`).join("\n");
  const prompt = `You are the First Officer of the Hyperdrift Bridge, answering the captain out loud. Speak to enable: strengths first, a gap is a next step, never blame. Sound like a person with an opinion.
Skill (${skill}): ${GUIDES[skill]}
Context (the fleet's agenda${ship ? `, ship ${ship}` : ""}):
${context || "(none)"}
${req.body?.item ? `We are currently on: ${req.body.item.headline}\n` : ""}Captain asks: ${question}

Answer for the ear, under 80 words: your opinion first, one reason from the context, then stop. Then on a final separate line propose exactly one next step as JSON:
PROPOSAL: {"kind": "note|mission|read|none", "title": "<one line>", "ask": "<Shall I ...? in ten words>"}`;
  let raw = "";
  try {
    const r = await fetch(GATEWAY, { method: "POST", headers: { authorization: process.env.ASSEMBLYAI_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 260 }) });
    const j = await r.json();
    raw = j.choices?.[0]?.message?.content || "";
    if (!raw) throw new Error(j.metadata?.errors?.[0] || j.message || `gateway ${r.status}`);
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err.message || err), say: `I could not get a considered answer: ${String(err.message || err)}.` });
    return;
  }
  let say = raw.trim(), proposal = null;
  const m = say.match(/PROPOSAL:\s*(\{[\s\S]*\})\s*$/);
  if (m) { try { proposal = JSON.parse(m[1]); } catch { proposal = null; } say = say.slice(0, m.index).trim(); }
  if (proposal && (!proposal.kind || proposal.kind === "none")) proposal = null;
  if (proposal) proposal = { kind: String(proposal.kind), title: String(proposal.title || "").slice(0, 160), ask: String(proposal.ask || "Shall I?").slice(0, 120), ship, question };
  res.status(200).json({ ok: true, contract: "hd.voice.ask.v1", skill, ship, model: MODEL, say, proposal });
}
