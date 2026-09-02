#!/usr/bin/env node
// Local server: static public/ + POST /api/voice-token. Zero dependencies.
//   ASSEMBLYAI_API_KEY=... node scripts/dev.mjs   (or put the key in .env)
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { mintToken } from "../api/voice-token.js";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const PORT = Number(process.env.PORT || 8787);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/api/voice-token") {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const { status, body } = await mintToken({ ip: req.socket.remoteAddress, origin: req.headers.origin, host: req.headers.host });
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
    return;
  }
  const file = join("public", path === "/" ? "index.html" : path);
  if (!existsSync(file)) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(readFileSync(file));
}).listen(PORT, "127.0.0.1", () => console.log(`bridge-voice → http://127.0.0.1:${PORT}  (key ${process.env.ASSEMBLYAI_API_KEY ? "set" : "MISSING"})`));
