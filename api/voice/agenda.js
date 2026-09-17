// Demo host: the First Officer's agenda, frozen from a real day and scrubbed (fixtures/agenda.json).
// The live Bridge serves the same contract from the Crew API (scripts/commander/agenda.py in the monorepo).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(new URL("../../fixtures/agenda.json", import.meta.url));
export const decisions = []; // what captains decided on this demo process, newest last; the live fleet records these for real

// Every watch starts from the whole frozen day. A decision belongs to the conversation it was made in (the watch keeps its
// own state, in the browser and in the officer-as-LLM replay alike), so one visitor never finds another's agenda half done.
export function load() {
  const agenda = JSON.parse(readFileSync(FIXTURE, "utf8"));
  agenda.items = agenda.items.map((i, n) => ({ ...i, rank: n + 1 }));
  agenda.generated = new Date().toISOString();
  return agenda;
}

// What the officer says once a decision is recorded. Shared with api/voice/llm.js, whose replay must say the same words.
const SPOKEN = { approve: "Logged as approved.", reject: "Logged as rejected.", defer: "Parked; I will bring it back.", acknowledge: "Noted." };
export function doneLine(item, verdict) {
  if (item.kind === "heal" && verdict === "approve") return `Approved ${item.keys.length} findings; on the live fleet this hands them to an agent.`;
  if (item.kind === "read" && verdict === "approve") return `On the live fleet this starts a Commander read on ${item.ship}. Here it is logged.`;
  return SPOKEN[verdict] || "Logged.";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(load());
}
