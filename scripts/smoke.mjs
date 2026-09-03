#!/usr/bin/env node
// Headless kill-gate: token → WebSocket → session.ready → greeting audio → a text turn that must fire a tool call.
// Measures the turn-to-tool latency the browser will see (minus mic capture). No microphone needed.
//   node scripts/smoke.mjs ["show me revela" open_ship]   (reads .env)
//   node scripts/smoke.mjs --audio show_me_revela.wav open_ship    (streams 24 kHz PCM16 WAV in real time; measures end of speech → tool.call)
const argv = process.argv.slice(2);
const AUDIO = argv.includes("--audio") ? argv[argv.indexOf("--audio") + 1] : "";
const rest = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1] || "").match(/^--(audio|min-silence|turn|agent|llm|save-audio|say)$/));
const [UTTERANCE = "show me revela", EXPECT = "open_ship"] = AUDIO ? [AUDIO, rest[0] || "open_ship"] : rest;
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { mintToken } from "../api/voice/token.js";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const voice = readFileSync("public/voice.js", "utf8");
const sessionSrc = voice.slice(voice.indexOf("const SESSION = {") + "const SESSION = ".length, voice.indexOf("\n  };\n", voice.indexOf("const SESSION = {")) + 4);
const SESSION = new Function(`return ${sessionSrc}`)();
const MIN_SILENCE = argv.includes("--min-silence") ? Number(argv[argv.indexOf("--min-silence") + 1]) : 0;
if (MIN_SILENCE) SESSION.input.turn_detection = { min_silence: MIN_SILENCE };
if (argv.includes("--short-prompt")) SESSION.system_prompt = SESSION.system_prompt.split(" Examples:")[0];
if (argv.includes("--hold")) SESSION.tools.forEach((t) => { t.execution_mode = "hold"; });
if (argv.includes("--llm")) SESSION.llm = JSON.parse(argv[argv.indexOf("--llm") + 1]);
if (argv.includes("--turn")) SESSION.input.turn_detection = JSON.parse(argv[argv.indexOf("--turn") + 1]);
const EAGER = argv.includes("--eager-result");
const WATCH = argv.includes("--watch");
const BASE = SESSION.greeting || WATCH ? 1 : 0; // replies before the test turn
const DEMO = process.env.DEMO_URL || "http://127.0.0.1:8787";
const AGENT_ID = argv.includes("--agent") ? argv[argv.indexOf("--agent") + 1] : "";
const SAVE = argv.includes("--save-audio") ? argv[argv.indexOf("--save-audio") + 1] : "";
const SAY = argv.includes("--say") ? argv[argv.indexOf("--say") + 1] : "";
const RAW = argv.includes("--raw"); // hand the line back as a plain JSON string instead of {say}
if (argv.includes("--resp")) SESSION.tools.forEach((t) => { t.response_instructions = { success: "Read the result aloud exactly as written, word for word. Add nothing. Never say the tool name.", error: "Say the error in one sentence." }; }); // fidelity mode: answer any tool.call with {say}; judge the spoken transcript
const pcmOut = [];
let afterTurn = false, judged = false;

let seqBefore = 0;
async function judgeByState() {
  const st = await (await fetch(`${DEMO}/api/voice/officer?tool=state`)).json();
  const tool = st.seq > seqBefore ? st.last?.tool : "no tool";
  const ok = tool === EXPECT;
  console.log(stamp(), ok ? `PASS: turn → ${EXPECT} (server-side)` : `FAIL: expected ${EXPECT}, got ${tool} (server-side)`);
  done(ok ? 0 : 1);
}
async function startTurn() {
  if (AGENT_ID) seqBefore = (await (await fetch(`${DEMO}/api/voice/officer?tool=state`)).json()).seq || 0;
  afterTurn = true;
  console.log(stamp(), `→ sending turn ${JSON.stringify(UTTERANCE)}`);
  setTimeout(() => { if (!judged) { judged = true; if (AGENT_ID) judgeByState(); else { console.log(stamp(), "FAIL: no tool.call within 20 s of the turn"); done(1); } } }, 20000);
  if (AUDIO) streamWav(AUDIO);
  else {
    ws.send(JSON.stringify({ type: "conversation.message", role: "user", content: UTTERANCE }));
    turnSent = Date.now();
    ws.send(JSON.stringify({ type: "reply.create" }));
  }
}
const t0 = Date.now();
const stamp = () => `${String(Date.now() - t0).padStart(5)}ms`;
const { status, body } = await mintToken({ ip: "smoke", host: "x", origin: "http://x" });
if (status !== 200) { console.error("token:", status, body); process.exit(1); }
console.log(stamp(), "token minted");

const url = new URL("wss://agents.assemblyai.com/v1/ws");
url.searchParams.set("token", body.token);
const ws = new WebSocket(url);
let audioBytes = 0, replies = 0, toolCalls = [], turnSent = 0, firstAudioAt = 0, speechEnd = 0;
function streamWav(file) {
  const pcm = readFileSync(file).subarray(44);
  const chunk = 2400; // 50 ms of 24 kHz PCM16
  let lastLoud = 0;
  for (let i = 0; i < pcm.length; i += 2) if (Math.abs(pcm.readInt16LE(i)) > 600) lastLoud = i;
  const loudEnd = Math.ceil(lastLoud / chunk) * chunk;
  let off = 0, silenceLeft = 60; // then 3 s of silence so turn detection can fire
  const silence = Buffer.alloc(chunk).toString("base64");
  const timer = setInterval(() => {
    if (off < pcm.length) {
      ws.send(JSON.stringify({ type: "input.audio", audio: pcm.subarray(off, off + chunk).toString("base64") }));
      off += chunk;
      if (off >= loudEnd && !speechEnd) { speechEnd = Date.now(); turnSent = speechEnd; console.log(stamp(), `end of speech (last loud chunk sent; ${((pcm.length - loudEnd) / 48000).toFixed(2)}s of file silence follows)`); }
    } else if (silenceLeft-- > 0) ws.send(JSON.stringify({ type: "input.audio", audio: silence }));
    else clearInterval(timer);
  }, 50);
}
const done = (code) => {
  try { ws.send(JSON.stringify({ type: "session.end" })); } catch {}
  if (SAVE && pcmOut.length) {
    const pcm = Buffer.concat(pcmOut); const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
    writeFileSync(SAVE, Buffer.concat([h, pcm])); console.log(stamp(), `saved ${SAVE} (${(pcm.length / 48000).toFixed(1)} s)`);
  }
  setTimeout(() => process.exit(code), 500);
};
setTimeout(() => { console.error(stamp(), "TIMEOUT"); done(2); }, 45000);

ws.onopen = () => {
  console.log(stamp(), "socket open → session.update" + (AGENT_ID ? ` (stored agent ${AGENT_ID})` : ""));
  ws.send(JSON.stringify({ type: "session.update", session: AGENT_ID ? { agent_id: AGENT_ID } : SESSION }));
};
ws.onclose = (e) => console.log(stamp(), "closed", e.code);
const VERBOSE = argv.includes("--verbose");
ws.onmessage = ({ data }) => {
  const ev = JSON.parse(data);
  if (VERBOSE && ev.type !== "reply.audio" && ev.type !== "transcript.agent.delta" && ev.type !== "transcript.user.delta") console.log(stamp(), "  ev", ev.type, ev.status || ev.reply_id || "");
  switch (ev.type) {
    case "session.ready":
      console.log(stamp(), "session.ready voice=" + ev.config?.output?.voice, "tools=" + (ev.config?.tools || []).length);
      if (AGENT_ID && WATCH) {
        ws.send(JSON.stringify({ type: "reply.create", instructions: "Open the watch: call the open tool, then say its 'say' text word for word." }));
      } else if (WATCH) {
        fetch(`${DEMO}/api/voice/agenda`).then((r) => r.json()).then((a) => {
          const top = a.items.slice(0, 8).map((i) => `${i.rank}. [${i.kind}${i.ship ? " " + i.ship : ""}] ${i.headline} Options: ${i.options.join("/")} (default ${i.default}).`);
          ws.send(JSON.stringify({ type: "conversation.message", role: "system", content: `Agenda for the captain, ${a.items.length} item(s), most urgent first:\n${top.join("\n")}` }));
          ws.send(JSON.stringify({ type: "reply.create", instructions: `Open the watch: greet the captain in three words, then state item 1 in one sentence and ask for a decision using its options (${a.items[0].options.join(" or ")}).` }));
        });
      } else if (!SESSION.greeting) startTurn();
      break;
    case "reply.started": firstAudioAt = 0; break;
    case "input.speech.stopped": console.log(stamp(), `input.speech.stopped (${Date.now() - speechEnd}ms after end of speech)`); break;
    case "transcript.user": console.log(stamp(), `transcript.user ${JSON.stringify(ev.text)} (${Date.now() - speechEnd}ms after end of speech)`); break;
    case "reply.audio": audioBytes += ev.data.length; if (SAVE) pcmOut.push(Buffer.from(ev.data, "base64")); if (!firstAudioAt) { firstAudioAt = Date.now(); if (turnSent) console.log(stamp(), `first audio ${firstAudioAt - turnSent}ms after turn`); } break;
    case "transcript.agent":
      console.log(stamp(), "agent:", JSON.stringify(ev.text));
      if (SAY && afterTurn && toolCalls.length && !judged) {
        judged = true;
        const words = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
        const want = words(SAY), got = new Set(words(ev.text));
        const hit = want.filter((w) => got.has(w)).length / Math.max(1, want.length);
        const clean = !/captain_said|\(text=|\[call/i.test(ev.text);
        console.log(stamp(), hit >= 0.85 && clean ? `PASS: fidelity ${(hit * 100).toFixed(0)}%, clean` : `FAIL: fidelity ${(hit * 100).toFixed(0)}%${clean ? "" : ", tool syntax spoken aloud"}`);
        setTimeout(() => done(hit >= 0.85 && clean ? 0 : 1), 300);
      }
      break;
    case "tool.call":
      console.log(stamp(), `tool.call ${ev.name} ${JSON.stringify(ev.arguments)}  (${afterTurn ? Date.now() - turnSent + "ms after turn" : "before the turn"})`);
      if (SAY) { ws.send(JSON.stringify({ type: "tool.result", call_id: ev.call_id, result: JSON.stringify(RAW ? SAY : { say: SAY }) })); console.log(stamp(), "tool.result {say} sent"); toolCalls.push(ev); break; }
      if (afterTurn && !judged) {
        judged = true;
        const ok = ev.name === EXPECT;
        console.log(stamp(), ok ? `PASS: turn → ${EXPECT}` : `FAIL: expected ${EXPECT}, got ${ev.name}`);
        setTimeout(() => done(ok ? 0 : 1), 6000); // let the spoken result print
      }
      toolCalls.push(ev);
      if (EAGER) { ws.send(JSON.stringify({ type: "tool.result", call_id: ev.call_id, result: JSON.stringify({ ship: "revela", position: "#3", stage: "Rigged", constraint: "trust", confidence: "0.42", visitors: "0" }) })); console.log(stamp(), "tool.result sent eagerly"); }
      break;
    case "reply.done":
      replies += 1;
      if (toolCalls.length && replies === BASE + 1 && !EAGER) {
        ws.send(JSON.stringify({ type: "tool.result", call_id: toolCalls[0].call_id, result: JSON.stringify({ ship: "revela", position: "#3", stage: "Rigged", constraint: "trust", confidence: "0.42", visitors: "0", read_line: "Tracking needs a clean read before tactical calls." }) }));
        console.log(stamp(), "tool.result sent");
      } else if (replies === BASE && BASE) {
        console.log(stamp(), `opening done, ${audioBytes} b64 chars of audio`);
        startTurn();
      } else if (AGENT_ID && afterTurn && !judged) {
        judged = true;
        judgeByState();
      } else if (replies >= BASE + 2) {
        const ok = toolCalls[0]?.name === EXPECT;
        console.log(stamp(), ok ? `PASS: greeting → turn → ${EXPECT} → spoken result` : `FAIL: expected ${EXPECT}, got ${toolCalls[0]?.name || "no tool.call"}`);
        done(ok ? 0 : 1);
      }
      break;
    case "session.error": console.error(stamp(), "session.error", ev.code, ev.message, ev.param || ""); if (ev.code === "invalid_config" || ev.code === "invalid_value") done(1); if (!ev.code?.startsWith("invalid")) done(1); break;
    case "session.ended": console.log(stamp(), `session.ended ${ev.session_duration_seconds}s`); break;
  }
};
