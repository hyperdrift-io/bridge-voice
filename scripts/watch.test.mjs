// node --test scripts/watch.test.mjs — whole conversations, offline: the router hears, the watch answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

new Function(readFileSync("public/router.js", "utf8"))();
new Function(readFileSync("public/watch.js", "utf8"))();
const agenda = () => JSON.parse(readFileSync("fixtures/agenda.json", "utf8"));
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

test("pick by name, hear why a line at a time, decide, and get the rest offered", async () => {
  const { w, log, hear } = watch();
  w.open();
  const item = await hear("the hackathon");
  assert.match(item, /closes 2026-09-30.*Go for it, park it, or hear why\?$/);
  assert.match(await hear("why?"), /Five equal winners.*Want more, or shall we decide\?$/);
  assert.match(await hear("go on"), /We are enrolled.*Go for it, or park it\?$/);
  const after = await hear("park it");
  assert.deepEqual(log, ["contest:lablab-ai-assemblyai-voice-agent-hackathon=defer"]);
  assert.match(after, /^Parked; I will bring it back\. Two things left: eleven small fixes an agent can take and four ships overdue a read\. Which one first\?$/);
});

test("a group can be taken whole", async () => {
  const { w, log, hear } = watch();
  w.open();
  assert.match(await hear("the fixes"), /nine agent-guide fixes and two skill-routing fixes\. Hand them all to an agent, go through them, or park them\?$/);
  assert.match(await hear("hand them all over"), /^Done, both logged\. Two things left/);
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
