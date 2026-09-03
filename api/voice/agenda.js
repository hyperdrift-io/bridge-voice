// Demo host: the First Officer's agenda, frozen from a real day and scrubbed (fixtures/agenda.json).
// The live Bridge serves the same contract from the Crew API (scripts/commander/agenda.py in the monorepo).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(new URL("../../fixtures/agenda.json", import.meta.url));
export const decided = new Map(); // key → decision, per demo process; the live fleet records these for real

export function load() {
  const agenda = JSON.parse(readFileSync(FIXTURE, "utf8"));
  agenda.items = agenda.items.filter((i) => !decided.has(i.key)).map((i, n) => ({ ...i, rank: n + 1 }));
  agenda.generated = new Date().toISOString();
  return agenda;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(load());
}
