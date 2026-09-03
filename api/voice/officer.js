// Server-side First Officer: the agenda state and the officer's tools as one HTTP endpoint.
// A stored AssemblyAI agent calls this over HTTP (?tool=why|decide|next|brief|state); the cockpit
// follows by polling ?tool=state. Arguments arrive as the JSON body (POST) per the HTTP-tools contract.
import { decided, load } from "./agenda.js";

const state = { agenda: null, current: 0, last: null, seq: 0 };
const DECISIONS = {
  approve: "approve", act: "approve", "do it": "approve", yes: "approve", run: "approve", "run it": "approve",
  reject: "reject", no: "reject", drop: "reject", defer: "defer", park: "defer", later: "defer", "not now": "defer",
  acknowledge: "acknowledge", ack: "acknowledge", noted: "acknowledge",
};
const SPOKEN = { approve: "Logged as approved.", reject: "Logged as rejected.", defer: "Parked; I will bring it back.", acknowledge: "Noted." };

const ask = (it) => `${it.options.map((o, i) => (i === it.options.length - 1 && it.options.length > 1 ? `or ${o}` : o)).join(", ")}?`;
const line = (it) => `${it.headline} ${ask(it)}`;
const spoken = (it) => (it ? { key: it.key, rank: it.rank, kind: it.kind, ship: it.ship || undefined, headline: it.headline, options: it.options } : null);
const item = () => (state.agenda && state.agenda.items[state.current]) || null;
function refresh() { state.agenda = load(); state.current = Math.min(state.current, Math.max(0, state.agenda.items.length - 1)); }
function mark(tool, result) { state.seq += 1; state.last = { tool, ts: new Date().toISOString(), item: spoken(item()), ui: item()?.ui || null, seq: state.seq }; return { ...result, ui: item()?.ui || null }; }

export const TOOLS = {
  open() {
    refresh(); state.current = 0;
    const it = item();
    const n = state.agenda.items.length;
    return mark("open", { say: it ? `Captain, ${n} item${n === 1 ? "" : "s"} on the agenda. First: ${line(it)}` : "Captain, the agenda is clear. Which ship shall we look at?", item: spoken(it) });
  },
  why() {
    if (!state.agenda) refresh();
    const it = item();
    if (!it) return mark("why", { say: "The agenda is clear; there is nothing to explain." });
    return mark("why", { say: `${it.why.length ? it.why.join(" ") : "No evidence is attached to this item."} ${ask(it)}`, item: spoken(it), why: it.why });
  },
  decide({ decision, note } = {}) {
    if (!state.agenda) refresh();
    const it = item();
    if (!it) return mark("decide", { error: "There is no item to decide on. Ask the captain which one." });
    const verdict = DECISIONS[String(decision || "").toLowerCase()];
    if (!verdict) return mark("decide", { error: `'${decision}' is not a decision I can record. Ask the captain: ${ask(it)}` });
    decided.set(it.key, verdict);
    let done = SPOKEN[verdict];
    if (it.kind === "heal" && verdict === "approve") done = `Approved ${it.keys.length} finding${it.keys.length === 1 ? "" : "s"}; handed to an agent.`;
    if (it.kind === "read" && it.key.endsWith(":run") && verdict === "approve") done = `Reading ${it.ship} now; I will tell you when it lands.`;
    refresh();
    const next = item();
    return mark("decide", { decided: it.headline, decision: verdict, note: note || "", say: `${done} ${next ? `Next: ${line(next)}` : "That was the last item. The agenda is clear."}`, next: spoken(next), remaining: state.agenda.items.length });
  },
  next() {
    if (!state.agenda) refresh();
    if (!state.agenda.items.length) return mark("next", { say: "The agenda is clear." });
    state.current = (state.current + 1) % state.agenda.items.length;
    const it = item();
    return mark("next", { say: `Next: ${line(it)}`, item: spoken(it), remaining: state.agenda.items.length });
  },
  brief() {
    if (!state.agenda) refresh();
    const counts = {};
    state.agenda.items.forEach((i) => { counts[i.kind] = (counts[i.kind] || 0) + 1; });
    const kinds = Object.entries(counts).map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ");
    const it = item();
    return mark("brief", { say: `${state.agenda.items.length} items: ${kinds}. ${it ? `We are on: ${line(it)}` : ""}`.trim(), by_kind: counts, top: state.agenda.items.slice(0, 3).map(spoken) });
  },
  state() { return { ok: true, current: spoken(item()), ui: item()?.ui || null, last: state.last, seq: state.seq, remaining: state.agenda ? state.agenda.items.length : null }; },
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const tool = String(req.query?.tool || "").toLowerCase();
  const fn = TOOLS[tool];
  if (!fn) { res.status(404).json({ error: `no such tool '${tool}'. Tools: ${Object.keys(TOOLS).join(", ")}` }); return; }
  try {
    res.status(200).json(fn(req.body || {}));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
