#!/usr/bin/env node
// Local server: static public/ + every api/voice/<name>.js handler at /api/voice/<name>. Zero dependencies.
//   node scripts/dev.mjs   (reads .env for ASSEMBLYAI_API_KEY)
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { connect } from "node:net";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const PORT = Number(process.env.PORT || 8787);
const CREW_PORT = Number(process.env.CREW_API_PORT || 8765);

// The Bridge's guided-work buttons post jobs to the Crew API (`hd commander serve`).
// Start it alongside the dashboard when nothing listens yet, so a click never dead-ends.
function ensureCrewApi() {
  if (process.env.CREW_API === "0") return;
  const probe = connect({ host: "127.0.0.1", port: CREW_PORT });
  probe.once("connect", () => { probe.end(); console.log(`crew api   → http://127.0.0.1:${CREW_PORT}  (already running)`); });
  probe.once("error", () => {
    const child = spawn("hd", ["commander", "serve", "--port", String(CREW_PORT)], { stdio: "inherit" });
    child.once("error", (err) => console.warn(`crew api   → not started (${err.message}); run \`hd commander serve\` yourself`));
    process.once("exit", () => child.kill());
    process.once("SIGINT", () => process.exit(0));
    process.once("SIGTERM", () => process.exit(0));
  });
}
ensureCrewApi();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const handlers = new Map();

async function handlerFor(name) {
  if (!/^[a-z-]+$/.test(name)) return null;
  const file = join("api", "voice", `${name}.js`);
  if (!existsSync(file)) return null;
  if (!handlers.has(name)) handlers.set(name, (await import(pathToFileURL(file).href)).default);
  return handlers.get(name);
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (process.env.LOG_REQUESTS) console.log(new Date().toISOString(), req.method, req.url, req.headers["user-agent"] || "");
  const api = url.pathname.match(/^\/api\/voice\/([a-z-]+)$/) || url.pathname.match(/^\/api\/voice\/(llm)\/chat\/completions$/); // the second is what AssemblyAI calls: {base_url}/chat/completions
  if (api) {
    if (process.env.ONLY && api[1] !== process.env.ONLY) { res.writeHead(404).end("not served here"); return; } // ONLY=llm: a tunnel that exposes the officer's LLM endpoint and nothing else
    const handler = await handlerFor(api[1]);
    if (!handler) { res.writeHead(404).end("no such function"); return; }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const shim = {
      raw: res, // for handlers that stream (api/voice/llm.js)
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { res.writeHead(this.statusCode, { ...this.headers, "content-type": "application/json" }).end(JSON.stringify(b)); },
    };
    try {
      await handler({ method: req.method, headers: req.headers, socket: req.socket, query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : {} }, shim);
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }
  if (process.env.API_ONLY) { res.writeHead(404).end("api only"); return; }
  const file = join("public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!existsSync(file)) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(readFileSync(file));
}).listen(PORT, process.env.HOST || "127.0.0.1", () => console.log(`bridge-voice → http://127.0.0.1:${PORT}  (key ${process.env.ASSEMBLYAI_API_KEY ? "set" : "MISSING"})`));
