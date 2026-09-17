// Demo host: record a decision on the frozen agenda (in memory) and say what comes next.
// On the live Bridge the same call records through the fleet's own paths: heal decisions + execute,
// contest and read decisions as notifications, stale reads as real Commander jobs.
import { decisions, doneLine, load } from "./agenda.js";

const DECISIONS = {
  approve: "approve", act: "approve", "do it": "approve", yes: "approve", run: "approve", "run it": "approve",
  reject: "reject", no: "reject", drop: "reject",
  defer: "defer", park: "defer", later: "defer", "not now": "defer",
  acknowledge: "acknowledge", ack: "acknowledge", noted: "acknowledge",
};
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "POST only" }); return; }
  const key = String(req.body?.key || "");
  const verdict = DECISIONS[String(req.body?.decision || "").toLowerCase()];
  if (!key) { res.status(400).json({ ok: false, error: "key is required" }); return; }
  if (!verdict) { res.status(400).json({ ok: false, error: `'${req.body?.decision}' is not a decision I can record: approve, reject, defer or acknowledge.` }); return; }
  const item = load().items.find((i) => i.key === key);
  if (!item) { res.status(404).json({ ok: false, error: `'${key}' is not on the agenda.` }); return; }
  decisions.push({ key, decision: verdict, note: String(req.body?.note || "").slice(0, 300), ts: new Date().toISOString() });
  if (decisions.length > 500) decisions.shift();
  res.status(200).json({ ok: true, key, decision: verdict, done: doneLine(item, verdict), demo: true });
}
