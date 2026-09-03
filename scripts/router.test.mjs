// node --test scripts/router.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

new Function(readFileSync("public/router.js", "utf8"))();
const route = globalThis.officerRoute;

const cases = [
  ["why is that first", { intent: "why" }],
  ["Why?", { intent: "why" }],
  ["give me the brief", { intent: "brief" }],
  ["what's on the agenda", { intent: "brief" }],
  ["next", { intent: "next" }],
  ["skip that", { intent: "next" }],
  ["do it", { intent: "decide", decision: "approve" }],
  ["Yes, run it.", { intent: "decide", decision: "approve" }],
  ["ship it", { intent: "decide", decision: "approve" }],
  ["no, drop it", { intent: "decide", decision: "reject" }],
  ["park that until Friday", { intent: "decide", decision: "defer" }],
  ["not now", { intent: "decide", decision: "defer" }],
  ["noted", { intent: "decide", decision: "acknowledge" }],
  ["show me revela", { intent: "open_ship", ship: "revela" }],
  ["Show me Revela.", { intent: "open_ship", ship: "revela" }],
  ["how is hyper cv doing", { intent: "open_ship", ship: "hyper-cv" }],
  ["open intel", { intent: "open_ship", ship: "intel" }],
  ["web3", { intent: "open_ship", ship: "web3-capital" }],
  ["what's the read on intel", { intent: "read", ship: "intel" }],
  ["what does the commander say about hyper-cv", { intent: "read", ship: "hyper-cv" }],
  ["open the commands", { intent: "navigate", target: "commands" }],
  ["search for signals", { intent: "navigate", target: "search signals" }],
  ["click advanced fleet controls", { intent: "navigate", target: "advanced fleet controls" }],
  ["close that", { intent: "navigate", target: "close" }],
  ["start over", { intent: "open" }],
  ["what would you do about the contest", { intent: "free" }],
];

for (const [text, expected] of cases) {
  test(`"${text}"`, () => {
    const got = route(text);
    for (const [k, v] of Object.entries(expected)) assert.equal(got[k], v, `${k}: ${JSON.stringify(got)}`);
  });
}
