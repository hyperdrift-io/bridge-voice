// Demo host: a question answered by the one model this account can reach through AssemblyAI's LLM Gateway,
// with the same shape as the live fleet's /voice/ask (skill by question, context, opinion first, one proposal).
// On the live Bridge the answer comes from the fleet's own headless agent with the full skill and ship context.
import { load } from "./agenda.js";

const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
const MODEL = process.env.ASK_MODEL || "qwen3.5-4b-32k-fast";
const CLAUDE_MODEL = process.env.ASK_CLAUDE_MODEL || "claude-opus-5";

// Which brain answers a real question. AssemblyAI hosts the conversation either way; this is only the thinking behind
// one tool. With ANTHROPIC_API_KEY in .env the answer comes from Claude; without it, from the one LLM Gateway model this
// account can reach (a 4B Qwen, 2 requests per ~35 s: x-ratelimit-limit, seen 2026-09-18).
// Raw HTTP on purpose: this repo has no dependencies and no SDK (AGENTS.md → Stack rules).
// Returns { text } or { busy: seconds }; throws on anything else.
async function think(prompt) {
  if (process.env.ANTHROPIC_API_KEY) {
    const opus = CLAUDE_MODEL === "claude-opus-5";
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", ...(opus ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}) },
      // Opus 5 thinks by default; low effort keeps a spoken answer quick, and a declined request re-runs on the default fallback.
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, ...(opus ? { output_config: { effort: "low" }, fallbacks: "default" } : {}), messages: [{ role: "user", content: prompt }] }),
    });
    if (r.status === 429) return { busy: Number(r.headers.get("retry-after") || 20) };
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || `anthropic ${r.status}`);
    if (j.stop_reason === "refusal") throw new Error("the model declined that one");
    return { text: (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n"), model: j.model };
  }
  // A short wait is worth it; a long one is not a conversation, so the officer says when it can answer again and offers the choices.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(GATEWAY, { method: "POST", headers: { authorization: process.env.ASSEMBLYAI_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 220, temperature: 0.3 }) });
    if (r.status === 429) {
      const wait = Number(r.headers.get("retry-after") || 30);
      if (attempt === 0 && wait <= 3) { await new Promise((ok) => setTimeout(ok, wait * 1000 + 200)); continue; }
      return { busy: wait };
    }
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || "";
    if (!text) throw new Error(j.metadata?.errors?.[0] || j.message || `gateway ${r.status}`);
    return { text, model: MODEL };
  }
  return { busy: 30 };
}
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
  // cockpit), the fleet's numbers when no ship is named, and only the agenda items that matter. Handing it the whole
  // agenda made it answer a pricing question with heal findings (2026-09-17).
  const agenda = load();
  const items = agenda.items.filter((i) => (ship ? i.ship === ship : true)).slice(0, 4).map((i) => `- ${i.headline} ${i.why.slice(0, 2).join(" ")}`).join("\n");
  const flat = (o) => Object.entries(o || {}).filter(([, v]) => v && typeof v !== "object").map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${String(v).slice(0, 300)}`).join("\n");
  const read = req.body?.facts?.last_read;
  const lastRead = read ? `- last Commander read (${read.date}): verdict ${String(read.verdict).replace(/_/g, " ")}. ${read.pragmatic} Opportunity: ${read.opportunity} Confidence: ${read.confidence}` : "";
  const fleet = req.body?.fleet ? `The fleet right now:\n${flat(req.body.fleet)}\n${(req.body.fleet.ships || []).slice(0, 6).map((f) => `- ${f.ship}: stage ${f.stage}${f.constraint ? `, held back by ${f.constraint}` : ""}. ${f.read_line || ""}`).join("\n")}\n` : "";
  // The conversation so far, so "what's that about?" has something to be about.
  const st = req.body?.state || {};
  const table = st.last ? `You just said to the captain: "${String(st.last).slice(0, 400)}"\n${st.focus ? `On the table: ${String(st.focus).slice(0, 200)}\n` : ""}` : "";
  const prompt = `You are the First Officer of the Hyperdrift Bridge. You report to the captain, who runs a small fleet of live apps: you bring the agenda, record decisions, and answer questions about the ships. You are talking out loud, like a trusted colleague across the table.
${table}The captain now says: "${question}"

Voice: warm, plain, direct. Strengths first; a gap is a next step, never a fault. No alarm words (bleeding, dying, killing, disaster, failing). No jargon you were not given. Never invent a number, a name or a fact: if what you know below does not settle it, say what you would check first.
Skill (${skill}): ${GUIDES[skill]}
${ship ? `What we know about ${ship}:\n${[flat(req.body?.facts), lastRead].filter(Boolean).join("\n") || "(nothing recorded)"}\n` : fleet}On the agenda${ship ? ` for ${ship}` : ""}:
${items || "(nothing)"}

Answer for the ear in under 60 words, in full sentences: your opinion first, then the one fact above that decides it, then stop. No lists, no headings. Then on a final separate line propose exactly one next step as JSON:
PROPOSAL: {"kind": "note|mission|read|none", "title": "<one line>", "ask": "<Shall I ...? in ten words>"}`;
  let raw = "", model = MODEL;
  try {
    const thought = await think(prompt);
    if (thought.busy) { res.status(429).json({ ok: false, error: "the model line is busy", retry_after: thought.busy }); return; }
    raw = thought.text; model = thought.model;
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err.message || err) });
    return;
  }
  let say = raw.trim(), proposal = null;
  const m = say.match(/PROPOSAL:\s*(\{[\s\S]*\})\s*$/);
  if (m) { try { proposal = JSON.parse(m[1]); } catch { proposal = null; } say = say.slice(0, m.index).trim(); }
  if (proposal && (!proposal.kind || proposal.kind === "none")) proposal = null;
  if (proposal) proposal = { kind: String(proposal.kind), title: String(proposal.title || "").slice(0, 160), ask: String(proposal.ask || "Shall I?").slice(0, 120), ship, question };
  res.status(200).json({ ok: true, contract: "hd.voice.ask.v1", skill, ship, model, say, proposal });
}
