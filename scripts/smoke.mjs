#!/usr/bin/env node
// Headless kill-gate: token → WebSocket → session.ready → greeting audio → a text turn that must fire a tool call.
// Measures the turn-to-tool latency the browser will see (minus mic capture). No microphone needed.
//   node scripts/smoke.mjs ["show me revela" open_ship]   (reads .env)
//   node scripts/smoke.mjs --audio show_me_revela.wav open_ship    (streams 24 kHz PCM16 WAV in real time; measures end of speech → tool.call)
const argv = process.argv.slice(2);
const AUDIO = argv.includes("--audio") ? argv[argv.indexOf("--audio") + 1] : "";
const rest = argv.filter((a, i) => !a.startsWith("--") && !(argv[i - 1] || "").match(/^--(audio|min-silence|turn)$/));
const [UTTERANCE = "show me revela", EXPECT = "open_ship"] = AUDIO ? [AUDIO, rest[0] || "open_ship"] : rest;
import { readFileSync, existsSync } from "node:fs";
import { mintToken } from "../api/voice-token.js";

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
if (argv.includes("--turn")) SESSION.input.turn_detection = JSON.parse(argv[argv.indexOf("--turn") + 1]);
const EAGER = argv.includes("--eager-result");

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
const done = (code) => { try { ws.send(JSON.stringify({ type: "session.end" })); } catch {} setTimeout(() => process.exit(code), 500); };
setTimeout(() => { console.error(stamp(), "TIMEOUT"); done(2); }, 45000);

ws.onopen = () => { console.log(stamp(), "socket open → session.update"); ws.send(JSON.stringify({ type: "session.update", session: SESSION })); };
ws.onclose = (e) => console.log(stamp(), "closed", e.code);
const VERBOSE = argv.includes("--verbose");
ws.onmessage = ({ data }) => {
  const ev = JSON.parse(data);
  if (VERBOSE && ev.type !== "reply.audio" && ev.type !== "transcript.agent.delta" && ev.type !== "transcript.user.delta") console.log(stamp(), "  ev", ev.type, ev.status || ev.reply_id || "");
  switch (ev.type) {
    case "session.ready": console.log(stamp(), "session.ready voice=" + ev.config?.output?.voice, "tools=" + (ev.config?.tools || []).length); break;
    case "reply.started": firstAudioAt = 0; break;
    case "input.speech.stopped": console.log(stamp(), `input.speech.stopped (${Date.now() - speechEnd}ms after end of speech)`); break;
    case "transcript.user": console.log(stamp(), `transcript.user ${JSON.stringify(ev.text)} (${Date.now() - speechEnd}ms after end of speech)`); break;
    case "reply.audio": audioBytes += ev.data.length; if (!firstAudioAt) { firstAudioAt = Date.now(); if (turnSent) console.log(stamp(), `first audio ${firstAudioAt - turnSent}ms after turn`); } break;
    case "transcript.agent": console.log(stamp(), "agent:", JSON.stringify(ev.text)); break;
    case "tool.call":
      console.log(stamp(), `tool.call ${ev.name} ${JSON.stringify(ev.arguments)}  (${Date.now() - turnSent}ms after turn)`);
      toolCalls.push(ev);
      if (EAGER) { ws.send(JSON.stringify({ type: "tool.result", call_id: ev.call_id, result: JSON.stringify({ ship: "revela", position: "#3", stage: "Rigged", constraint: "trust", confidence: "0.42", visitors: "0" }) })); console.log(stamp(), "tool.result sent eagerly"); }
      break;
    case "reply.done":
      replies += 1;
      if (toolCalls.length && replies === 2 && !EAGER) {
        ws.send(JSON.stringify({ type: "tool.result", call_id: toolCalls[0].call_id, result: JSON.stringify({ ship: "revela", position: "#3", stage: "Rigged", constraint: "trust", confidence: "0.42", visitors: "0", read_line: "Tracking needs a clean read before tactical calls." }) }));
        console.log(stamp(), "tool.result sent");
      } else if (replies === 1) {
        console.log(stamp(), `greeting done, ${audioBytes} b64 chars of audio → sending text turn ${JSON.stringify(UTTERANCE)}`);
        if (AUDIO) streamWav(AUDIO);
        else {
          ws.send(JSON.stringify({ type: "conversation.message", role: "user", content: UTTERANCE }));
          turnSent = Date.now();
          ws.send(JSON.stringify({ type: "reply.create" }));
        }
      } else if (replies >= 3) {
        const ok = toolCalls[0]?.name === EXPECT;
        console.log(stamp(), ok ? `PASS: greeting → turn → ${EXPECT} → spoken result` : `FAIL: expected ${EXPECT}, got ${toolCalls[0]?.name || "no tool.call"}`);
        done(ok ? 0 : 1);
      }
      break;
    case "session.error": console.error(stamp(), "session.error", ev.code, ev.message, ev.param || ""); if (!ev.code?.startsWith("invalid")) done(1); break;
    case "session.ended": console.log(stamp(), `session.ended ${ev.session_duration_seconds}s`); break;
  }
};
