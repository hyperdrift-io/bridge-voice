// Demo host: mint a single-use AssemblyAI temp token. The API key never reaches the browser.
// Vercel-style Node handler; scripts/dev.mjs uses the same function locally.
// On the real Bridge the equivalent lives in the Crew API (scripts/commander/voice.py in the monorepo).
const TOKEN_URL = "https://agents.assemblyai.com/v1/token";
const TOKEN_TTL_S = 60; // browser must open the socket within a minute
const SESSION_CAP_S = 300; // hard stop per session — there is no free tier
const PER_IP_PER_HOUR = 12;
const hits = new Map();

export async function mintToken({ ip, origin, host }) {
  if (!process.env.ASSEMBLYAI_API_KEY) return { status: 500, body: { error: "ASSEMBLYAI_API_KEY is not set" } };
  if (origin && host && new URL(origin).host !== host) return { status: 403, body: { error: "cross-origin token requests are refused" } };
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  if (recent.length >= PER_IP_PER_HOUR) return { status: 429, body: { error: "too many sessions from this address; try again later" } };
  hits.set(ip, [...recent, now]);

  const url = new URL(TOKEN_URL);
  url.searchParams.set("expires_in_seconds", String(TOKEN_TTL_S));
  url.searchParams.set("max_session_duration_seconds", String(SESSION_CAP_S));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}` } });
  if (!res.ok) return { status: 502, body: { error: `token mint failed: ${res.status}` } };
  const { token } = await res.json();
  // With OFFICER_AGENT_ID set, the browser binds to the stored agent whose model is this host's own /api/voice/llm
  // (scripts/agent.mjs creates it). Without it, the island configures the session itself and uses the managed model.
  return { status: 200, body: { token, session_cap_seconds: SESSION_CAP_S, agent_id: process.env.OFFICER_AGENT_ID || null } };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "POST only" }); return; }
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";
  const { status, body } = await mintToken({ ip, origin: req.headers.origin, host: req.headers.host });
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}
