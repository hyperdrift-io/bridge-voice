// Demo host: the judges' write path. Only Helm's sandbox app ("cargo") is operable here; the production
// ships are driven from the real Bridge through the Crew API. Rate-limited so a public URL cannot flap it.
const HELM_URL = process.env.HELM_URL || "https://helm-294160018950.europe-west1.run.app";
const OPERABLE = { cargo: "cargo" };
const MODES = { maintenance: "maintenance", off: "maintenance", online: "online", on: "online" };
const PER_IP_PER_HOUR = 6;
const hits = new Map();

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const app = String((req.method === "GET" ? req.query?.app : req.body?.app) || "").toLowerCase();
  const helmApp = OPERABLE[app];
  if (!helmApp) { res.status(400).json({ error: `'${app || "?"}' is not operable on the public demo. Only the sandbox ship 'cargo' is.` }); return; }

  if (req.method === "GET") {
    const r = await fetch(`${HELM_URL}/probe?app=${helmApp}`);
    const body = await r.json();
    res.status(200).json({ app, mode: body.mode || (body.http === 200 ? "online" : "offline"), http: body.http, url: body.url });
    return;
  }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); res.status(405).json({ error: "GET or POST" }); return; }
  const mode = MODES[String(req.body?.mode || "").toLowerCase()];
  if (!mode) { res.status(400).json({ error: "mode must be maintenance or online" }); return; }
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  if (recent.length >= PER_IP_PER_HOUR) { res.status(429).json({ error: "too many changes from this address; try again later" }); return; }
  hits.set(ip, [...recent, now]);
  const r = await fetch(`${HELM_URL}/control/${helmApp}/${mode}`, { method: "POST" });
  const body = await r.json();
  if (!body.started) { res.status(409).json({ error: body.reason || "Helm refused", app }); return; }
  res.status(200).json({ app, mode, started: true });
}
