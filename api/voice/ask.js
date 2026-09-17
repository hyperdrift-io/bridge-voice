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
const PER_IP_PER_HOUR = 40; // a public endpoint in front of a paid model: a watch asks a handful of questions, not hundreds
const hits = new Map();
function allowed(req) {
  const ip = (req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  hits.set(ip, [...recent, now]);
  return recent.length < PER_IP_PER_HOUR;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "POST only" }); return; }
  if (req.body?.accept) {
    const p = req.body.accept;
    accepted.push({ ...p, ts: new Date().toISOString() });
    res.status(200).json({ ok: true, kind: p.kind, say: `Logged as a ${p.kind === "mission" ? "mission" : "note"} for ${p.ship || "the fleet"}: ${p.title}. On the live fleet this lands in the ship's notebook.` });
    return;
  }
  if (!allowed(req)) { res.status(429).json({ ok: false, error: "too many questions from this address", say: "I have answered a lot of questions from here in the last hour. Shall we go back to the agenda?" }); return; }
  const question = String(req.body?.question || "").trim().slice(0, 400);
  if (!question) { res.status(400).json({ ok: false, error: "question is required" }); return; }
  const ship = String(req.body?.ship || "").toLowerCase();
  const skill = (RULES.find(([re]) => re.test(question.toLowerCase())) || [null, "strategist"])[1];
  // A small model answers from what it is handed and nothing else: the ship's own facts (sent by the island from the
  // cockpit) and only the agenda items about that ship. Handing it the whole agenda made it answer a pricing question
  // with heal findings (2026-09-17).
  const agenda = load();
  const items = agenda.items.filter((i) => (ship ? i.ship === ship : true)).slice(0, 4).map((i) => `- ${i.headline} ${i.why.slice(0, 2).join(" ")}`).join("\n");
  const facts = Object.entries(req.body?.facts || {}).filter(([, v]) => v && typeof v !== "object").map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${String(v).slice(0, 300)}`).join("\n");
  const read = req.body?.facts?.last_read;
  const lastRead = read ? `- last Commander read (${read.date}): verdict ${String(read.verdict).replace(/_/g, " ")}. ${read.pragmatic} Opportunity: ${read.opportunity} Confidence: ${read.confidence}` : "";
  const prompt = `You are the First Officer of the Hyperdrift Bridge, answering the captain out loud, like a trusted colleague across the table.
Voice: warm, plain, direct. Strengths first; a gap is a next step, never a fault. No alarm words (bleeding, dying, killing, disaster, failing). No jargon you were not given. Never invent a number, a name or a fact: if the facts below do not settle it, say what you would check first.
Skill (${skill}): ${GUIDES[skill]}
${ship ? `What we know about ${ship}:\n${[facts, lastRead].filter(Boolean).join("\n") || "(nothing recorded)"}\n` : ""}On the agenda${ship ? ` for ${ship}` : ""}:
${items || "(nothing)"}
${req.body?.item ? `We are currently on: ${req.body.item.headline}\n` : ""}Captain asks: ${question}

Answer for the ear in under 70 words, in full sentences: your opinion first, then the one fact above that decides it, then stop. No lists, no headings. Then on a final separate line propose exactly one next step as JSON:
PROPOSAL: {"kind": "note|mission|read|none", "title": "<one line>", "ask": "<Shall I ...? in ten words>"}`;
  let raw = "";
  try {
    // The gateway refuses bursts ("too many requests"); one quiet retry covers a captain who asks twice in a row.
    for (let attempt = 0; attempt < 2 && !raw; attempt++) {
      if (attempt) await new Promise((ok) => setTimeout(ok, 1200));
      const r = await fetch(GATEWAY, { method: "POST", headers: { authorization: process.env.ASSEMBLYAI_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 260, temperature: 0.3 }) });
      const j = await r.json();
      raw = j.choices?.[0]?.message?.content || "";
      if (!raw && (attempt || !/too many requests/i.test(JSON.stringify(j)))) throw new Error(j.metadata?.errors?.[0] || j.message || `gateway ${r.status}`);
    }
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err.message || err), say: `I could not get a considered answer just now: ${String(err.message || err)}. Would you ask me again?` });
    return;
  }
  let say = raw.trim(), proposal = null;
  const m = say.match(/PROPOSAL:\s*(\{[\s\S]*\})\s*$/);
  if (m) { try { proposal = JSON.parse(m[1]); } catch { proposal = null; } say = say.slice(0, m.index).trim(); }
  if (proposal && (!proposal.kind || proposal.kind === "none")) proposal = null;
  if (proposal) proposal = { kind: String(proposal.kind), title: String(proposal.title || "").slice(0, 160), ask: String(proposal.ask || "Shall I?").slice(0, 120), ship, question };
  res.status(200).json({ ok: true, contract: "hd.voice.ask.v1", skill, ship, model: MODEL, say, proposal });
}
