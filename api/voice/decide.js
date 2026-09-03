// Demo host: record a decision on the frozen agenda (in memory) and say what comes next.
// On the live Bridge the same call records through the fleet's own paths: heal decisions + execute,
// contest and read decisions as notifications, stale reads as real Commander jobs.
import { decided, load } from "./agenda.js";

const DECISIONS = {
  approve: "approve", act: "approve", "do it": "approve", yes: "approve", run: "approve", "run it": "approve",
  reject: "reject", no: "reject", drop: "reject",
  defer: "defer", park: "defer", later: "defer", "not now": "defer",
  acknowledge: "acknowledge", ack: "acknowledge", noted: "acknowledge",
};
const SPOKEN = { approve: "Logged as approved.", reject: "Logged as rejected.", defer: "Parked; I will bring it back.", acknowledge: "Noted." };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.status(405).json({ error: "POST only" }); return; }
  const key = String(req.body?.key || "");
  const verdict = DECISIONS[String(req.body?.decision || "").toLowerCase()];
  if (!key) { res.status(400).json({ ok: false, error: "key is required" }); return; }
  if (!verdict) { res.status(400).json({ ok: false, error: `'${req.body?.decision}' is not a decision I can record: approve, reject, defer or acknowledge.` }); return; }
  const before = load();
  const idx = before.items.findIndex((i) => i.key === key);
  if (idx < 0) { res.status(404).json({ ok: false, error: `'${key}' is not on the agenda any more.` }); return; }
  const item = before.items[idx];
  decided.set(key, verdict);
  const nextItem = before.items[idx + 1] || before.items[0];
  const next = nextItem && nextItem.key !== key ? { key: nextItem.key, headline: nextItem.headline, ui: nextItem.ui } : null;
  let done = SPOKEN[verdict];
  if (item.kind === "heal" && verdict === "approve") done = `Approved ${item.keys.length} finding(s); on the live fleet this hands them to an agent.`;
  if (item.kind === "read" && key.endsWith(":run") && verdict === "approve") done = `On the live fleet this starts a Commander read on ${item.ship}. Here it is logged.`;
  res.status(200).json({ ok: true, key, decision: verdict, done, next, demo: true });
}
