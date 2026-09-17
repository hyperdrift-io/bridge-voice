#!/usr/bin/env node
// The stored AssemblyAI agent whose model is the officer itself ("Connect your own LLM"): the platform calls
// POST <public-base-url>/api/voice/llm/chat/completions for every reply, and the browser connects with agent_id only.
//   node scripts/agent.mjs create <public-base-url>    needs OFFICER_LLM_KEY in .env; prints the id → OFFICER_AGENT_ID in .env
//   node scripts/agent.mjs point <id> <public-base-url>  move an agent to a new host, or rotate the key
//   node scripts/agent.mjs list | delete <id>
// The host must be public HTTPS. Serve only that endpoint with: ONLY=llm API_ONLY=1 node scripts/dev.mjs
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const KEY = process.env.ASSEMBLYAI_API_KEY;
if (!KEY) { console.error("ASSEMBLYAI_API_KEY missing"); process.exit(1); }
const API = "https://agents.assemblyai.com/v1/agents";
const [cmd, ...args] = process.argv.slice(2);

const llm = (base) => {
  if (!/^https:\/\//.test(base || "")) { console.error("the base URL must be public https"); process.exit(1); }
  if (!process.env.OFFICER_LLM_KEY) { console.error("OFFICER_LLM_KEY missing: put a long random value in .env; the platform sends it as the Bearer key and api/voice/llm.js checks it"); process.exit(1); }
  return [{ base_url: `${base.replace(/\/$/, "")}/api/voice/llm`, model: "first-officer", api_key: process.env.OFFICER_LLM_KEY }];
};
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!r.ok) { console.error(r.status, JSON.stringify(json, null, 1)); process.exit(1); }
  return json;
}

if (cmd === "create") {
  const agent = await call("POST", API, {
    name: "first-officer (own LLM)",
    // The endpoint decides every line; the prompt only matters if the platform ever falls back to its own model.
    system_prompt: "You are the First Officer of the Hyperdrift Bridge. You report to the captain. Short sentences. Every line ends on a question.",
    voice: { voice_id: "anna" },
    input: { turn_detection: { min_silence: 200, max_silence: 500 }, transcription_mode: "min_latency", keyterms: ["revela", "hyper-cv", "intel", "web3-capital", "Commander", "First Officer"] },
    llm: llm(args[0]),
  });
  console.log(agent.id);
} else if (cmd === "point") {
  await call("PUT", `${API}/${args[0]}`, { llm: llm(args[1]) });
  console.log("pointed", args[0], "→", args[1]);
} else if (cmd === "list") {
  const { agents } = await call("GET", API);
  agents.forEach((a) => console.log(a.id, a.name, a.llm?.[0]?.base_url || "managed model"));
} else if (cmd === "delete") {
  await call("DELETE", `${API}/${args[0]}`);
  console.log("deleted", args[0]);
} else {
  console.error("usage: agent.mjs create <public-base-url> | point <id> <public-base-url> | list | delete <id>");
  process.exit(1);
}
