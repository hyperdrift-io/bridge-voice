// Demo host: real interrupts from Helm's sandbox. When a judge presses the red button (or flips cargo
// by voice), Helm's recent events become something the First Officer says unprompted.
const HELM_URL = process.env.HELM_URL || "https://helm-294160018950.europe-west1.run.app";

function say(row) {
  if (row.kind === "control") {
    if (!row.done) return "";
    const off = row.mode === "maintenance" || row.mode === "off";
    return `${row.app} is ${off ? "in maintenance" : "back online"}.`;
  }
  if (row.kind === "event") return `${row.event_desc || `${row.event?.app || "fleet"} ${row.event?.kind || "event"}`}. Helm's crew is on it.`;
  if (row.kind === "cycle_end") {
    const verdict = String(row.verdict || "").split("\n").find((l) => l.startsWith("VERDICT:")) || "";
    const action = String(row.verdict || "").split("\n").find((l) => l.startsWith("ACTION:")) || "";
    return `Helm's crew finished. ${verdict.replace("VERDICT:", "Verdict:").trim()} ${action.replace("ACTION:", "").replace(/\(https?:[^)]*\)/g, "").trim()}`.trim();
  }
  return "";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const since = String(req.query?.since || "");
  let rows = [];
  try { rows = await (await fetch(`${HELM_URL}/recent`)).json(); } catch { rows = []; }
  const fresh = rows
    .map((r) => ({ id: `${r.seq || r.ts}-${r.kind}`, ts: String(r.ts || ""), kind: r.kind, ship: r.app || r.event?.app || "cargo", say: say(r) }))
    .filter((r) => r.say && r.ts && (!since || r.ts > since))
    .sort((a, b) => (a.ts < b.ts ? -1 : 1))
    .slice(-5);
  res.status(200).json({ ok: true, contract: "hd.voice.agenda.v1", now: new Date().toISOString(), interrupts: fresh });
}
