#!/usr/bin/env node
// Transcribe a WAV with AssemblyAI's batch API (what the agent said, when transcript events are absent).
//   node scripts/transcribe.mjs out.wav
import { readFileSync, existsSync } from "node:fs";
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const H = { Authorization: process.env.ASSEMBLYAI_API_KEY };
const up = await (await fetch("https://api.assemblyai.com/v2/upload", { method: "POST", headers: H, body: readFileSync(process.argv[2]) })).json();
const t = await (await fetch("https://api.assemblyai.com/v2/transcript", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ audio_url: up.upload_url }) })).json();
for (;;) {
  const r = await (await fetch(`https://api.assemblyai.com/v2/transcript/${t.id}`, { headers: H })).json();
  if (r.status === "completed") { console.log(r.text); break; }
  if (r.status === "error") { console.error(r.error); process.exit(1); }
  await new Promise((res) => setTimeout(res, 1500));
}
