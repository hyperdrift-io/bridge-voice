// node --test scripts/watch.test.mjs — whole conversations, offline: the router hears, the watch answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

new Function(readFileSync("public/router.js", "utf8"))();
new Function(readFileSync("public/watch.js", "utf8"))();
const agenda = () => JSON.parse(readFileSync("fixtures/agenda.2026-09-17.json", "utf8"));
function watch() {
  const log = [];
  const w = globalThis.officerWatch.create(agenda(), { hour: 20, decide: async (key, decision) => { log.push(`${key}=${decision}`); return { done: decision === "defer" ? "Parked; I will bring it back." : "Logged." }; } });
  const hear = async (text) => { const out = await w.hear(globalThis.officerRoute(text)); return out && out.say; };
  return { w, log, hear };
}
const endsOnQuestion = (line) => assert.match(line, /\?$/, line);
const short = (line) => assert.ok(line.split(" ").length <= 45, `${line.split(" ").length} words: ${line}`);

test("the opening offers choices instead of marching through item one", () => {
  const { w } = watch();
  const line = w.open().say;
  assert.match(line, /^Evening, Captain\. Three things today: the voice hackathon deadline, eleven small fixes an agent can take, and four ships overdue a read\. Which one first\?$/);
});

test("'why?' before anything is on the table answers about the agenda, and yes takes it", async () => {
  const { w, hear } = watch();
  w.open();
  assert.match(await hear("why?"), /^Nothing is on the table yet\. The voice hackathon deadline is the most pressing, because the only open step is a quick check on your side, and the entry closes 2026-09-30\. Shall we take it\?$/);
  assert.match(await hear("yes"), /^The AssemblyAI voice hackathon closes 2026-09-30/);
});

test("pick by name, hear why a line at a time, decide, and get the rest offered", async () => {
  const { w, log, hear } = watch();
  w.open();
  const item = await hear("the hackathon");
  assert.match(item, /closes 2026-09-30.*Go for it, park it, or hear why\?$/);
  assert.match(await hear("why?"), /Five equal winners.*Want more, or shall we decide\?$/);
  assert.match(await hear("go on"), /We are enrolled.*Go for it, or park it\?$/);
  const after = await hear("park it");
  assert.deepEqual(log, ["contest:lablab-ai-assemblyai-voice-agent-hackathon=defer"]);
  assert.match(after, /^Parked; I will bring it back\. Two left: eleven small fixes an agent can take and four ships overdue a read\. Which one first\?$/);
});

test("a group can be taken whole", async () => {
  const { w, log, hear } = watch();
  w.open();
  assert.match(await hear("the fixes"), /nine agent-guide fixes and two skill-routing fixes\. Hand them all to an agent, go through them, or park them\?$/);
  assert.match(await hear("hand them all over"), /^Done, both logged\. Two left/);
  assert.deepEqual(log, ["heal:app-context=approve", "heal:skill-routing=approve"]);
});

test("or walked through, or a ship picked out of it", async () => {
  const { w, log, hear } = watch();
  w.open();
  await hear("the second one");
  assert.match(await hear("one by one"), /^Nine app-context findings/);
  assert.match(await hear("do it"), /Next in that set: Two skill-routing findings/);
  await hear("menu");
  await hear("the reads");
  assert.equal(await hear("blue bananas"), null); // not the watch's: the island decides it is not a question either, and asks for the choices again
  assert.match((await w.hear({ intent: "unclear" })).say, /^I did not catch an order in that\. Run them all, pick a ship, or park them\?$/);
  assert.match(await hear("intel"), /^intel has had no Commander read since 2026-07-08\. Run it, park it, or hear why\?$/);
  assert.match(await hear("run it"), /Three left in that set\. Hyper-cv, revela, and web3-capital are overdue a Commander read\. Run them all, pick a ship, or park them\?$/);
  assert.deepEqual(log, ["heal:app-context=approve", "read:intel:run=approve"]);
});

test("'you choose' gets an opinion with its reason, and yes acts on it", async () => {
  const { w, log, hear } = watch();
  w.open();
  assert.match(await hear("you choose"), /^I would start with the voice hackathon deadline\. Shall we\?$/);
  await hear("yes");
  assert.match(await hear("what do you recommend"), /^I would go for it\. The only open step is a quick check on your side.*Shall I\?$/);
  await hear("yes");
  assert.deepEqual(log, ["contest:lablab-ai-assemblyai-voice-agent-hackathon=approve"]);
});

test("repeat, thanks, and a clean goodbye", async () => {
  const { w, hear } = watch();
  const opening = w.open().say;
  assert.equal(await hear("sorry, say that again"), opening);
  assert.match(await hear("thanks"), /^Any time\./);
  assert.match(await hear("that's all for now"), /^Watch closed\. Nothing decided, nothing lost\. Fair winds, Captain\.$/);
});

test("a real question is not the watch's to answer", async () => {
  const { w, hear } = watch();
  w.open();
  assert.equal(await hear("is a paid tier worth pursuing for intel?"), null);
  assert.equal(await hear("how do we get more traffic to revela"), null);
  await hear("the reads");
  assert.equal(await hear("what is holding revela back?"), null); // even with revela on the table
});

test("every line is short and ends on a question", async () => {
  const { w, hear } = watch();
  const lines = [w.open().say];
  for (const t of ["the hackathon", "why", "more", "more", "you choose", "no", "next", "one by one", "why", "park it", "menu", "the reads", "run them all"]) lines.push(await hear(t));
  for (const line of lines) { assert.ok(line, "a line"); short(line); endsOnQuestion(line); }
});

// A ship that stopped answering: the order goes to Helm, the officer holds the line and reports back once it is checked.
const CARGO = { key: "incident:cargo", kind: "incident", ship: "cargo", short: "Cargo stopped answering", headline: "Cargo stopped answering twelve minutes ago.", why: ["Its health check fails from outside.", "Helm can restore its ingress in a few seconds."], options: ["restore", "defer"], default: "restore", order: { ship: "cargo", mode: "online" }, rationale: "A ship that does not answer loses every visitor until it is back." };
function incident() {
  const a = agenda(); a.items = [CARGO, ...a.items]; a.operable = ["cargo"];
  const w = globalThis.officerWatch.create(a, { hour: 9, decide: async () => ({ done: "Logged." }) });
  return { w, say: async (text) => (await w.converse(text)) };
}

test("a ship that stopped answering leads the agenda, and the order goes out in one breath", async () => {
  const { w, say } = incident();
  assert.match(w.open().say, /^Morning, Captain\. Four things today: Cargo stopped answering, the voice hackathon deadline, eleven small fixes an agent can take, and one more\. Which one first\?$/);
  assert.match((await say("Cargo")).say, /^Cargo stopped answering twelve minutes ago\. Bring it online, park it, or hear why\?$/);
  const turn = await say("bring it online");
  assert.equal(turn.say, "On it. Helm is bringing Cargo back online.");
  assert.deepEqual(turn.order, { ship: "cargo", mode: "online" });
  assert.equal(turn.hold, true);
  assert.deepEqual(turn.view.ships, ["cargo"]);
  assert.equal(w.report({ ship: "cargo", mode: "online", ok: true, ms: 25 }).say, "Captain, Cargo answers again. Checked twice, 25 milliseconds. Three left. Next: the voice hackathon deadline. Shall we?");
});

test("'bring it back' and 'yes' are the same order when the ship is on the table", async () => {
  for (const words of ["bring it back", "yes", "do it", "restore it", "bring Cargo back online"]) {
    const { w, say } = incident(); w.open(); await say("Cargo");
    assert.deepEqual((await say(words)).order, { ship: "cargo", mode: "online" }, words);
  }
});

test("an order needs no agenda item, and only the sandbox ship takes one here", async () => {
  const { w, say } = incident(); w.open();
  const off = await say("take Cargo offline");
  assert.deepEqual(off.order, { ship: "cargo", mode: "maintenance" });
  assert.match(off.say, /^Cargo is the sandbox ship, so that is safe\. Helm is taking it offline\.$/);
  assert.match(w.report({ ship: "cargo", mode: "maintenance", ok: true }).say, /^Captain, Cargo is offline\. Checked twice\. Say bring it online when you want it back\.$/);
  const no = await say("take intel offline");
  assert.equal(no.order, undefined);
  assert.match(no.say, /^Intel takes its orders from the live Bridge\. From here I can switch Cargo\./);
});

test("a report leaves the watch where the captain's words left it", async () => {
  const { w, say } = incident(); w.open(); await say("Cargo"); await say("bring it online");
  await say("the reads");
  assert.match(w.report({ ship: "cargo", mode: "online", ok: true, ms: 31 }).say, /^Captain, Cargo answers again\. Checked twice, 31 milliseconds\. Run them all, pick a ship, or park them\?$/);
  assert.match((await say("park them")).say, /^Done, all four logged\./);
  assert.match(w.report({ ship: "cargo", mode: "online", ok: false, seconds: 40 }).say, /has not answered after 40 seconds/);
});
