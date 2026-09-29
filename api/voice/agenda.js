// Demo host: the First Officer's agenda, frozen from a real day and scrubbed (fixtures/agenda.json).
// The live Bridge serves the same contract from the Crew API (scripts/commander/agenda.py in the monorepo).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURE = process.env.AGENDA_FIXTURE || fileURLToPath(new URL("../../fixtures/agenda.json", import.meta.url)); // the offline tests pin the day they were written against
export const decisions = []; // what captains decided on this demo process, newest last; the live fleet records these for real

// Every watch starts from the whole frozen day. A decision belongs to the conversation it was made in (the watch keeps its
// own state, in the browser and in the officer-as-LLM replay alike), so one visitor never finds another's agenda half done.
// `live` is what is true right now and goes first: see now().
export const OPERABLE = ["cargo"]; // the ships this host may switch: Helm's sandbox ship, never a production one
export function load({ live = [] } = {}) {
  const agenda = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const open = agenda.items.filter((i) => !i.closes || Date.parse(i.closes) > Date.now()); // a deadline that has passed is no longer the captain's to decide
  agenda.items = [...live, ...open].map((i, n) => ({ ...i, rank: n + 1 }));
  agenda.operable = OPERABLE;
  agenda.generated = new Date().toISOString();
  return agenda;
}

// The one part of this agenda that is not frozen: the sandbox ship is probed from outside on every request. When it does
// not answer, that leads the agenda, with the order that brings it back. Helm (the fleet's agent at the wheel) carries
// the order out; api/voice/control.js hands it over and reads the result back.
const HELM_URL = process.env.HELM_URL || "https://helm-294160018950.europe-west1.run.app";
const helm = (path) => fetch(`${HELM_URL}${path}`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
const ago = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 90 ? `${m} minute${m === 1 ? "" : "s"} ago` : `${Math.round(m / 60)} hours ago`; };
export async function now() {
  let probe;
  try { probe = await helm("/probe?app=cargo"); } catch { return { sandbox: null, items: [] }; }
  const sandbox = { ship: "cargo", http: probe.http, ms: probe.latency_ms, url: probe.url };
  if (probe.http === 200) return { sandbox, items: [] };
  const rows = await helm("/recent").catch(() => []);
  const down = rows.filter((r) => r.kind === "control" && r.app === "cargo" && r.done && r.mode === "maintenance").pop();
  return { sandbox, items: [{
    key: "incident:cargo", kind: "incident", ship: "cargo", short: "Cargo stopped answering",
    headline: `Cargo stopped answering${down ? ` ${ago(Date.now() - Date.parse(down.ts))}` : ""}.`,
    why: [`I probed it from outside a moment ago: it returns ${probe.http}.`, "Helm can restore its ingress in a few seconds, and I check the result myself before I tell you."],
    options: ["restore", "defer"], default: "restore", urgency: 100, order: { ship: "cargo", mode: "online" }, keys: ["incident:cargo"],
    rationale: "A ship that does not answer loses every visitor until it is back.",
  }] };
}

// What the officer says once a decision is recorded. Shared with api/voice/llm.js, whose replay must say the same words.
const SPOKEN = { approve: "Logged as approved.", reject: "Logged as rejected.", defer: "Parked; I will bring it back.", acknowledge: "Noted." };
export function doneLine(item, verdict) {
  if (item.kind === "incident") return verdict === "defer" ? "Parked; the ship stays as it is." : "Logged.";
  if (item.kind === "heal" && verdict === "approve") return `Approved ${item.keys.length} findings; on the live fleet this hands them to an agent.`;
  if (item.kind === "signal" && verdict === "approve") return "Handed over. On the live fleet an agent takes it from here.";
  if (item.kind === "read" && item.fresh && verdict === "approve") return `Logged. On the live fleet this becomes today's mission for ${item.ship}.`;
  if (item.kind === "read" && verdict === "approve") return `On the live fleet this starts a Commander read on ${item.ship}. Here it is logged.`;
  return SPOKEN[verdict] || "Logged.";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { sandbox, items } = await now();
  res.status(200).json({ ...load({ live: items }), sandbox, live: items });
}
