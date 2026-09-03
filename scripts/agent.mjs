#!/usr/bin/env node
// Stored AssemblyAI agents for the First Officer: a BYO model through AssemblyAI's LLM Gateway and the
// officer's tools as HTTP tools the platform calls server-side. The browser then connects with agent_id only.
//   node scripts/agent.mjs create <public-base-url> [model] [--header name=value]   → prints the agent id
//   node scripts/agent.mjs list | delete <id>
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const KEY = process.env.ASSEMBLYAI_API_KEY;
if (!KEY) { console.error("ASSEMBLYAI_API_KEY missing"); process.exit(1); }
const API = "https://agents.assemblyai.com/v1/agents";
const GATEWAY = "https://llm-gateway.assemblyai.com/v1";
const [cmd, ...rest] = process.argv.slice(2);
const args = rest.filter((a) => !a.startsWith("--"));
const headers = rest.filter((a, i) => rest[i - 1] === "--header").map((h) => { const [name, ...v] = h.split("="); return { name, value: v.join("=") }; });

const voice = readFileSync("public/voice.js", "utf8");
const promptSrc = voice.slice(voice.indexOf("system_prompt: [") + "system_prompt: ".length, voice.indexOf("].join(\" \")") + 1);
const SYSTEM_PROMPT = new Function(`return ${promptSrc}`)().join(" ")
  .replace("Ships: revela", "Open the watch with the open tool and say its 'say' text. Ships: revela");

const tool = (base, name, description, properties = {}, required = []) => ({
  type: "http", name, description,
  parameters: { type: "object", properties, required },
  execution_mode: "interactive", timeout_seconds: 15,
  http: { url: `${base}/api/voice/officer?tool=${name}`, http_method: "POST", headers: [{ name: "bypass-tunnel-reminder", value: "1" }, ...headers] },
});
const tools = (base) => [
  tool(base, "open", "Call this once at the start of the watch, or when the captain asks to start over. Returns the opening line to say."),
  tool(base, "why", "Call this when the captain asks why, what the evidence is, or why an item is first. Do not call this to decide. Returns the evidence to say and the question to repeat."),
  tool(base, "decide", "Call this only when the captain has said a decision word about the current item: yes, do it, approve, run it, no, drop, park, later, not now, noted. Never for a question. Records the decision and returns what to say next.",
    { decision: { type: "string", enum: ["approve", "reject", "defer", "acknowledge"], description: "approve for yes/do it/act/run it; reject for no/drop; defer for park/later/not now; acknowledge for noted" }, note: { type: "string", description: "Anything the captain added, verbatim" } }, ["decision"]),
  tool(base, "next", "Call this when the captain says next, skip, move on, or what else. Do not call this to decide. Advances the agenda and returns the next item to say."),
  tool(base, "brief", "Call this when the captain asks for the brief, the summary, the overview, or what is on the agenda. Returns the summary to say."),
];

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) { console.error(r.status, JSON.stringify(json, null, 1)); process.exit(1); }
  return json;
}

if (cmd === "create") {
  const [base, model = "claude-haiku-4-5-20251001"] = args; // pass "default" to keep the platform's own model
  if (!base) { console.error("usage: create <public-base-url> [model]"); process.exit(1); }
  const agent = await call("POST", API, {
    name: `first-officer ${model}`,
    system_prompt: SYSTEM_PROMPT,
    voice: { voice_id: "anna" },
    input: { turn_detection: { min_silence: 200, max_silence: 500 }, transcription_mode: "min_latency", keyterms: ["revela", "hyper-cv", "intel", "web3-capital", "mcp-maker", "Commander"] },
    ...(model === "default" ? {} : { llm: [{ base_url: GATEWAY, model, api_key: KEY }] }),
    tools: tools(base),
  });
  console.log(agent.id);
} else if (cmd === "list") {
  const { agents } = await call("GET", API);
  agents.forEach((a) => console.log(a.id, a.name, a.llm?.[0]?.model || a.llm?.model || "default-llm", (a.tools || []).length + " tools"));
} else if (cmd === "delete") {
  await call("DELETE", `${API}/${args[0]}`);
  console.log("deleted", args[0]);
} else {
  console.error("usage: agent.mjs create <base-url> [model] | list | delete <id>");
  process.exit(1);
}
