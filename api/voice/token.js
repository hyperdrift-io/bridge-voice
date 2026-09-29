// Demo host: mint a single-use AssemblyAI temp token. The API key never reaches the browser.
// Vercel-style Node handler; scripts/dev.mjs uses the same function locally.
// On the real Bridge the equivalent lives in the Crew API (scripts/commander/voice.py in the monorepo).
const TOKEN_URL = "https://agents.assemblyai.com/v1/token";
const TOKEN_TTL_S = 60; // browser must open the socket within a minute
const SESSION_CAP_S = 300; // hard stop per session — there is no free tier
const PER_IP_PER_HOUR = 40; // a watch, plus a fresh voice session each time the captain cuts the officer off (voice.js, redial)
const hits = new Map();
// The ceiling on what a public link can spend in a day, whoever holds it: watches opened since midnight UTC, counted in
// this process. It holds while one instance stays up (deploy with --min-instances 1 --max-instances 1); a restart starts
// the count again. A redial inside a watch is not a new watch. WATCHES_PER_DAY=0 lifts the ceiling.
const PER_DAY = Number(process.env.WATCHES_PER_DAY ?? 30);
let day = { date: "", watches: 0 };

export async function mintToken({ ip, origin, host, voiceOnly = false }) {
  if (!process.env.ASSEMBLYAI_API_KEY) return { status: 500, body: { error: "ASSEMBLYAI_API_KEY is not set" } };
  if (origin && host && new URL(origin).host !== host) return { status: 403, body: { error: "cross-origin token requests are refused" } };
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  if (recent.length >= PER_IP_PER_HOUR) return { status: 429, body: { error: "too many sessions from this address; try again later" } };
  hits.set(ip, [...recent, now]);
  const today = new Date(now).toISOString().slice(0, 10);
  if (day.date !== today) day = { date: today, watches: 0 };
  if (PER_DAY && !voiceOnly && day.watches >= PER_DAY) return { status: 429, body: { error: "The officer has stood every watch it may stand today. The film shows it; the watch reopens at midnight UTC." } };
  if (!voiceOnly) day.watches += 1;

  const url = new URL(TOKEN_URL);
  url.searchParams.set("expires_in_seconds", String(TOKEN_TTL_S));
  url.searchParams.set("max_session_duration_seconds", String(SESSION_CAP_S));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}` } });
  if (!res.ok) return { status: 502, body: { error: `token mint failed: ${res.status}` } };
  const { token } = await res.json();
  // The ear: with OFFICER_EAR set to a streaming speech model (universal-3-6-pro), the browser also gets a token for
  // AssemblyAI's Streaming API. That model hears the captain and calls the end of the turn; the island decides the line;
  // the voice agent speaks it. A failed mint is not an error: the island then lets the voice agent hear for itself.
  let ear = null;
  if (process.env.OFFICER_EAR && process.env.OFFICER_AGENT_ID && !voiceOnly) {
    try {
      const r = await fetch(`https://streaming.assemblyai.com/v3/token?expires_in_seconds=${TOKEN_TTL_S}&max_session_duration_seconds=${SESSION_CAP_S}`, { headers: { Authorization: process.env.ASSEMBLYAI_API_KEY }, signal: AbortSignal.timeout(4000) });
      if (r.ok) ear = { token: (await r.json()).token, model: process.env.OFFICER_EAR };
    } catch { /* no ear this time */ }
  }
  // With OFFICER_AGENT_ID set, the browser binds to the stored agent whose model is this host's own /api/voice/llm
  // (scripts/agent.mjs creates it). Without it, the island configures the session itself and uses the managed model.
  return { status: 200, body: { token, session_cap_seconds: SESSION_CAP_S, agent_id: process.env.OFFICER_AGENT_ID || null, ear } };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "POST only" }); return; }
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";
  const { status, body } = await mintToken({ ip, origin: req.headers.origin, host: req.headers.host, voiceOnly: Boolean(req.query?.voice) });
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}
