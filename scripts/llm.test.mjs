// node --test scripts/llm.test.mjs — the officer as the model: a chat-completions history in, the next line out.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.AGENDA_FIXTURE = "fixtures/agenda.2026-09-17.json"; // the day these conversations were written against
const { reply } = await import("../api/voice/llm.js");

const u = (content) => ({ role: "user", content });
const a = (content) => ({ role: "assistant", content });
const neverAsk = { ask: async () => { throw new Error("the brain must not be asked here"); } };

test("no captain yet: the opening offers the topics", async () => {
  assert.match(await reply([{ role: "system", content: "You are the First Officer." }], neverAsk), /Three things today: the voice hackathon deadline, .* Which one first\?$/);
});

test("the state is rebuilt from the transcript alone", async () => {
  const history = [u("You choose."), a("I would start with the voice hackathon deadline. Shall we?"), u("Yes."), a("…"), u("Why?"), a("…"), u("Go on.")];
  assert.match(await reply(history, neverAsk), /^We are enrolled\. .* Go for it, or park it\?$/);
});

test("a decision says the same words the island hears from /decide", async () => {
  assert.match(await reply([u("the fixes"), a("…"), u("one by one"), a("…"), u("do it")], neverAsk), /^Approved 9 findings; on the live fleet this hands them to an agent\. Next in that set: Two skill-routing findings/);
});

test("a question in the past is not asked again; yes takes its proposal, anything else lets it go", async () => {
  const past = [u("what is holding intel back?"), a("The capture path needs checking first. Shall I run the intel read now?")];
  assert.match(await reply([...past, u("yes")], neverAsk), /^Logged as a next step: run the intel read now\./);
  assert.match(await reply([...past, u("the fixes")], neverAsk), /^Eleven small fixes an agent can take/);
});

test("the live question goes to the brain with the ship's facts handed over by the island", async () => {
  let asked = null;
  // as the platform hands it over: the session's system prompt, the island's state on a line of its own, the platform's own rules after it
  const facts = { role: "system", content: `You are the First Officer.\nOFFICER_STATE ${JSON.stringify({ ships: [{ ship: "intel", position: "#2", stage: "Rigged", constraint: "trust", read_line: "Tracking needs a clean read." }] })}\n\nOutput is spoken aloud. Plain conversational text only.` };
  const line = await reply([facts, u("what is holding intel back?")], { ask: async (q) => { asked = q; return { say: "Trust in the numbers.", proposal: { ask: "Shall I run the read?" } }; } });
  assert.equal(line, "Trust in the numbers. Shall I run the read?");
  assert.equal(asked.ship, "intel");
  assert.equal(asked.facts.constraint, "trust");
  assert.match(await reply([facts, u("show me intel")], neverAsk), /^intel is ranked second, at the Rigged stage\. What holds it back is trust\. Tracking needs a clean read\. What next, Captain\?$/);
});

test("a throttled brain offers the choices; goodbye asks nothing", async () => {
  assert.match(await reply([u("how do we grow revela faster?")], { ask: async () => ({ busy: 30 }) }), /^Give me about 30 seconds .* Which one first\?$/);
  assert.equal(await reply([u("that's all for today")], neverAsk), "Watch closed. Nothing decided, nothing lost. Fair winds, Captain.");
});

test("the island can have the officer speak unprompted, once", async () => {
  const interrupt = { role: "system", content: "OFFICER_SAY Captain, cargo is back online. Shall I act on it, or carry on?" };
  assert.equal(await reply([u("the fixes"), a("…"), interrupt], neverAsk), "Captain, cargo is back online. Shall I act on it, or carry on?");
  assert.match(await reply([u("the fixes"), a("…"), interrupt, a("Captain, cargo is back online…"), u("carry on")], neverAsk), /\?$/);
});

test("what is live on the agenda arrives with the session, and an order is acknowledged without a question", async () => {
  const cargo = { key: "incident:cargo", kind: "incident", ship: "cargo", short: "Cargo stopped answering", headline: "Cargo stopped answering 12 minutes ago.", why: ["It returns 404."], options: ["restore", "defer"], default: "restore", order: { ship: "cargo", mode: "online" } };
  const state = { role: "system", content: `Prompt.\nOFFICER_STATE ${JSON.stringify({ live: [cargo] })}\n\nOutput is spoken aloud.` };
  assert.match(await reply([state], neverAsk), /Four things today: Cargo stopped answering, /);
  assert.match(await reply([state, a("…"), u("Cargo")], neverAsk), /^Cargo stopped answering 12 minutes ago\. Bring it online, park it, or hear why\?$/);
  assert.equal(await reply([state, a("…"), u("Cargo"), a("…"), u("bring it back")], neverAsk), "On it. Helm is bringing Cargo back online.");
  assert.match(await reply([state, a("…"), u("Cargo"), a("…"), u("bring it back"), a("On it."), u("the reads")], neverAsk), /overdue a Commander read/);
});
