#!/usr/bin/env node
// Record the demo take from a live page with a reactive captain: each line is spoken a set moment after the officer
// actually finishes (or cuts in mid-line on purpose), never at a guessed timestamp. The first takes used a fixed schedule
// and a third of the video was dead air (founder, 2026-09-29: "long blank between questions and answers").
// Keeps what assemble-take.mjs needs: 2x frames at Chrome's timestamps, the officer's audio per reply, the captain's
// lines where they were spoken. On screen, video-only: live captions and the measured answer time of every turn.
//   node scripts/take.mjs <out-dir> --url https://… --voices <dir with u0.wav…> --script docs/video/script.json [--gap 0.7]
// script.json: [{ "say": "Cargo." }, { "say": "Intel.", "cutIn": 3 }, { "say": "The reads.", "after": 2 }]
//   cutIn: seconds into the officer's next line at which the captain interrupts; after: officer lines to let finish first.
// The microphone is a stream the page is handed in place of getUserMedia; the gate for the real capture path is mic-test.mjs.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const OUT = argv[0];
const URL_BASE = flag("--url", "");
const VOICES = flag("--voices", "");
const SCRIPT = JSON.parse(readFileSync(flag("--script", "docs/video/script.json"), "utf8"));
const GAP = Number(flag("--gap", 0.7));
const MAX_S = Number(flag("--max", 200));
if (!OUT || !URL_BASE || !VOICES) { console.error("usage: take.mjs <out-dir> --url <page> --voices <dir> [--script file] [--gap s]"); process.exit(2); }
mkdirSync(join(OUT, "frames"), { recursive: true });
const lines = SCRIPT.map((t, i) => ({ ...t, wav: readFileSync(join(VOICES, `u${i}.wav`)).toString("base64") }));

const INSTRUMENT = `(() => {
  const LINES = ${JSON.stringify(lines)}, GAP = ${GAP};
  const now = () => Date.now() / 1000;
  window.__audio = []; window.__captain = []; window.__events = [];
  const note = (ev, text) => window.__events.push({ at: now(), ev, text: text || "" });

  // The captain's microphone: a stream this page owns. A little room tone, then each line when its moment comes.
  const ctx = new AudioContext({ sampleRate: 48000 });
  const mic = ctx.createMediaStreamDestination();
  const room = ctx.createBufferSource(); const tone = ctx.createBuffer(1, 48000, 48000);
  for (let i = 0, d = tone.getChannelData(0); i < d.length; i++) d[i] = (Math.random() - 0.5) * 0.002;
  room.buffer = tone; room.loop = true; room.connect(mic); room.start();
  navigator.mediaDevices.getUserMedia = async () => { await ctx.resume(); note("mic.open"); return mic.stream; };
  const voices = Promise.all(LINES.map(async (l) => {
    const bytes = Uint8Array.from(atob(l.wav), (c) => c.charCodeAt(0));
    const buffer = await ctx.decodeAudioData(bytes.buffer);
    const d = buffer.getChannelData(0); let last = d.length - 1;
    while (last > 0 && Math.abs(d[last]) < 0.02) last--; // where the voice really ends: answer times are measured from here
    return { buffer, spoken: last / buffer.sampleRate };
  }));

  // Video-only chrome: what the captain was heard to say, the officer's line as it is spoken, and the measured times.
  // Two rows, because the answer starts a fraction of a second after the order: both must be readable together.
  const rows = {}; let pace = 0;
  function row(who) {
    if (!rows[who]) {
      let bar = document.getElementById("take-caption");
      if (!bar) { bar = document.createElement("div"); bar.id = "take-caption"; document.body.append(bar); }
      const p = document.createElement("p"); p.dataset.who = who; p.innerHTML = "<span></span><b></b><i></i>";
      p.querySelector("span").textContent = who === "officer" ? "First Officer" : "Captain";
      who === "captain" ? bar.prepend(p) : bar.append(p);
      rows[who] = p;
    }
    return rows[who];
  }
  const caption = (who, text, perWord) => {
    const p = row(who), b = p.querySelector("b");
    if (who === "officer") clearInterval(pace);
    p.hidden = !text;
    if (!perWord) { b.textContent = text; return; }
    const words = text.split(" "); let n = 0; b.textContent = "";
    pace = setInterval(() => { n += 1; b.textContent = words.slice(0, n).join(" "); if (n >= words.length) clearInterval(pace); }, perWord);
  };
  const badge = (who, text) => { row(who).querySelector("i").textContent = text; };
  document.addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style");
    st.textContent = "#voice > p,#voice > small,#voice form{display:none}#take-caption{position:fixed;left:3.5rem;right:26rem;bottom:2.2rem;z-index:60;display:grid;gap:1rem;pointer-events:none;font:inherit}#take-caption p{margin:0;display:grid;gap:.2rem}#take-caption p[hidden]{display:none}#take-caption span{font-size:.8rem;letter-spacing:.08em;text-transform:uppercase}#take-caption b{font-weight:600;color:#e6e9ef;text-shadow:0 2px 12px rgb(0 0 0/.7)}#take-caption i{font:500 .9rem ui-monospace,Menlo,monospace;color:#4bd08a;min-height:1.2em}#take-caption [data-who=captain] span{color:#4bd08a}#take-caption [data-who=captain] b{font-size:1.45rem;line-height:1.2}#take-caption [data-who=officer] span{color:#e8b04b}#take-caption [data-who=officer] b{font-size:2rem;line-height:1.25}";
    document.head.append(st);
  });

  // The captain's turn-taking: a line goes out a moment after the officer has finished (voiceTools.busy() covers the line
  // being generated, its audio still playing, and an order being carried out), or cuts in where the script says so.
  let ear = "";
  let turn = 0, finished = 0, reply = null, spokeUntil = 0, awaiting = false, waitTimer = 0, cutTimer = 0, wasBusy = false;
  async function speak() {
    const i = turn; if (i >= LINES.length) return;
    turn += 1; finished = 0; clearTimeout(waitTimer); clearTimeout(cutTimer); cutTimer = 0;
    const v = (await voices)[i];
    const src = ctx.createBufferSource(); src.buffer = v.buffer; src.connect(mic); src.start();
    const at = now();
    window.__captain.push({ text: LINES[i].say, file: "captain-" + i + ".wav", at, seconds: v.buffer.duration });
    spokeUntil = at + v.spoken; awaiting = true;
    caption("captain", "…", 0); badge("captain", ""); caption("officer", "", 0); badge("officer", ""); // a new exchange: the captain is speaking
    note("captain", LINES[i].say);
  }
  const plan = () => {
    const next = LINES[turn]; if (!next || next.cutIn) return;
    if (finished >= (next.after || 1)) setTimeout(speak, GAP * 1000);
    else { clearTimeout(waitTimer); waitTimer = setTimeout(speak, 25000); } // a line that never comes must not end the take in silence
  };
  setInterval(() => {
    const busy = Boolean(window.voiceTools && window.voiceTools.busy());
    if (!busy && wasBusy && !awaiting) { finished += 1; plan(); } // while the captain waits for an answer, silence is not the end of a line
    wasBusy = busy;
  }, 50);
  document.addEventListener("officer:cut", () => { if (reply) { reply.cut = now(); reply.interrupted = true; } reply = null; caption("officer", "", 0); badge("officer", ""); note("cut"); });

  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(...a) {
      super(...a);
      this.addEventListener("message", ({ data }) => {
        if (typeof data !== "string") return;
        const m = JSON.parse(data);
        if (m.type === "reply.audio") {
          const id = m.reply_id || "reply";
          if (!reply || reply.id !== id || reply.socket !== this) {
            const line = (window.voiceTools && window.voiceTools.mirrored && window.voiceTools.mirrored()) || "";
            reply = { id, socket: this, at: now(), chunks: [], text: line };
            window.__audio.push(reply);
            if (line) caption("officer", line, 1000 / 2.7);
            if (awaiting) { awaiting = false; const s = Math.max(0, reply.at - spokeUntil); reply.answeredIn = s; badge("officer", "answered in " + s.toFixed(1) + " s"); note("answered", s.toFixed(2)); }
            else { badge("officer", reply.text.startsWith("Captain,") ? "unprompted" : ""); caption("captain", "", 0); } // a line nobody asked for: a report, an interrupt
            const next = LINES[turn];
            if (next && next.cutIn && !cutTimer) cutTimer = setTimeout(speak, next.cutIn * 1000);
          }
          reply.chunks.push(m.audio || m.data);
          return;
        }
        if (m.type === "Begin" && m.configuration) ear = m.configuration.model === "universal-3-6-pro" ? "Universal-3.6 Pro Realtime" : m.configuration.model;
        if (m.type === "Turn" && m.transcript && m.end_of_turn) { caption("captain", m.transcript, 0); badge("captain", "heard by " + ear); note("heard", m.transcript); } // the ear (Streaming API); partials are not shown: on a one-word order they are guesses
        if (m.type === "transcript.user") { caption("captain", m.text, 0); badge("captain", "heard by the voice agent"); note("heard", m.text); } // the voice agent hearing for itself
        if (m.type === "transcript.agent") { note("officer", m.text); if (reply && !reply.text) { reply.text = m.text; caption("officer", m.text, 0); } }
        if (m.type === "reply.done" && reply && reply.socket === this) { reply.done = now(); if (m.status === "interrupted") { reply.cut = now(); reply.interrupted = true; caption("officer", "", 0); badge("officer", ""); } reply = null; }
        if (m.type === "session.error") note("error", m.code + " " + m.message);
      });
    }
  };
})();`;

const tmp = mkdtempSync(join(tmpdir(), "take-"));
const chrome = spawn(process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-port=9379", `--user-data-dir=${join(tmp, "profile")}`, "--no-first-run", "--no-default-browser-check",
  "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--hide-scrollbars", "--window-size=1280,720", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch("http://127.0.0.1:9379/json/list")).json()).find((t) => t.type === "page"); } catch {} }
if (!target) { console.error("Chrome did not open its debugging port"); chrome.kill(); process.exit(2); }
const cdp = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => (cdp.onopen = ok));
let seq = 0; const pending = new Map(); const frames = [];
cdp.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); }
  if (m.method === "Page.screencastFrame") {
    const file = join(OUT, "frames", `f${String(frames.length).padStart(5, "0")}.png`);
    writeFileSync(file, Buffer.from(m.params.data, "base64"));
    frames.push({ file, t: m.params.metadata.timestamp });
    cdp.send(JSON.stringify({ id: ++seq, method: "Page.screencastFrameAck", params: { sessionId: m.params.sessionId } }));
  }
};
const call = (method, params = {}) => new Promise((ok) => { const id = ++seq; pending.set(id, ok); cdp.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true })).result?.value;

await call("Page.enable");
await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false });
await call("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
await call("Page.navigate", { url: /[#?]/.test(URL_BASE) ? URL_BASE : `${URL_BASE.replace(/\/$/, "")}/` });
for (let i = 0; i < 40 && !(await evaluate("Boolean(document.querySelector('#voice button'))")); i++) await sleep(250);
await sleep(600);
await call("Page.startScreencast", { format: "png", maxWidth: 2560, maxHeight: 1440, everyNthFrame: 1 });
await sleep(400);
const start = Date.now() / 1000;
await evaluate("document.querySelector('#voice button').click()");

const events = [];
while (Date.now() / 1000 - start < MAX_S) {
  await sleep(500);
  for (const e of JSON.parse((await evaluate("JSON.stringify(window.__events.splice(0))")) || "[]")) { events.push(e); console.log(`${(e.at - start).toFixed(1).padStart(6)} s  ${e.ev}  ${e.text.slice(0, 150)}`); }
  if (["ended", "error"].includes(await evaluate("document.querySelector('#voice').dataset.state"))) break;
}
await sleep(1200);
await call("Page.stopScreencast");
const replies = JSON.parse((await evaluate("JSON.stringify(window.__audio.map(({ socket, ...r }) => r))")) || "[]");
let free = 0; // the island queues audio behind what is still playing; the master places it the same way
for (const [i, r] of replies.entries()) {
  const pcm = Buffer.concat(r.chunks.map((c) => Buffer.from(c, "base64")));
  r.file = `officer-${String(i).padStart(2, "0")}.pcm`; writeFileSync(join(OUT, r.file), pcm); delete r.chunks;
  r.at = Math.max(r.at, free);
  free = r.interrupted ? r.cut : r.at + pcm.length / 48000;
}
const captain = JSON.parse((await evaluate("JSON.stringify(window.__captain)")) || "[]");
captain.forEach((c, i) => copyFileSync(join(VOICES, `u${i}.wav`), join(OUT, c.file)));
writeFileSync(join(OUT, "take.json"), JSON.stringify({ start, url: URL_BASE, frames, replies, captain, events }, null, 1));
const answered = replies.filter((r) => r.answeredIn !== undefined).map((r) => r.answeredIn.toFixed(1));
console.log(`\ntake: ${frames.length} frames · ${replies.length} officer lines · ${captain.length}/${lines.length} captain lines · answered in ${answered.join(", ")} s → ${OUT}`);
chrome.kill();
process.exit(captain.length === lines.length ? 0 : 1);
