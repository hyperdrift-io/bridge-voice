#!/usr/bin/env node
// Spoken-path gate: a real Chrome, the real getUserMedia → worklet → socket path, and a WAV standing in for the
// microphone (Chrome's fake capture device). smoke.mjs skips the browser; this is the part the captain actually uses.
// Prints a timeline and, per spoken turn, last loud mic chunk → tool.call → first answer audio.
//   node scripts/mic-test.mjs "why@16" "next@34"        utterance@seconds-after-the-mic-opens
//   node scripts/mic-test.mjs --tail 12 --headed "why@16"
// Opens a paid AssemblyAI session for as long as the schedule runs. Zero dependencies (CDP over Node's WebSocket).
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const TAIL_S = Number(flag("--tail", 14)); // listen this long after the last utterance
const PORT = Number(flag("--port", 8799));
const CDP_PORT = Number(flag("--cdp", 9377));
const HEADED = argv.includes("--headed");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RATE = 48000;
const turns = argv.filter((a) => /@\d/.test(a)).map((a) => { const at = a.lastIndexOf("@"); return { text: a.slice(0, at), at: Number(a.slice(at + 1)) }; });
if (!turns.length) turns.push({ text: "why", at: 16 });

// ── The microphone: silence, with each utterance (macOS `say`) dropped in at its second ──────────────────────
const dir = mkdtempSync(join(tmpdir(), "bridge-voice-mic-"));
function pcmOf(file) {
  const b = readFileSync(file);
  for (let off = 12; off + 8 <= b.length; ) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === "data") return b.subarray(off + 8, Math.min(b.length, off + 8 + size));
    off += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}
const total = Math.ceil((turns[turns.length - 1].at + TAIL_S + 10) * RATE) * 2;
const pcm = Buffer.alloc(total);
turns.forEach((t, i) => {
  const wav = join(dir, `u${i}.wav`);
  execFileSync("say", ["-o", wav, `--data-format=LEI16@${RATE}`, t.text]);
  const speech = pcmOf(wav);
  speech.copy(pcm, Math.round(t.at * RATE) * 2);
  t.seconds = speech.length / 2 / RATE;
});
const header = Buffer.alloc(44);
header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
const micWav = join(dir, "mic.wav");
writeFileSync(micWav, Buffer.concat([header, pcm]));

// ── Runs inside the page before the island: logs the mic, every socket event, and the level of what is sent ──
const INSTRUMENT = `(() => {
  const t0 = performance.now(), log = (window.__log = []);
  const push = (o) => log.push({ t: Math.round(performance.now() - t0), ...o });
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    try { const s = await gum(c); const tr = s.getAudioTracks()[0]; push({ ev: "mic.open", text: tr.label + " " + JSON.stringify(tr.getSettings()) }); return s; }
    catch (e) { push({ ev: "mic.error", text: e.name + ": " + e.message }); throw e; }
  };
  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(...a) {
      super(...a);
      let audio = false, said = "";
      this.addEventListener("message", ({ data }) => {
        const m = JSON.parse(data);
        if (m.type === "reply.audio") { if (!audio) { audio = true; push({ ev: "reply.audio.first" }); } return; }
        if (m.type === "transcript.agent.delta") { said = m.text.length >= said.length && m.text.startsWith(said) ? m.text : said + m.text; return; }
        if (/delta$/.test(m.type)) return;
        if (m.type === "reply.started" || m.type === "reply.done") audio = false;
        if (m.type === "reply.done") { push({ ev: "reply.done", text: m.status + (said ? " · said: " + said : "") }); said = ""; return; }
        push({ ev: m.type, text: m.text || m.message || m.status || (m.name ? m.name + " " + JSON.stringify(m.arguments) : "") });
      });
      this.addEventListener("close", (e) => push({ ev: "ws.close", text: String(e.code) }));
      this.chunks = 0; this.peak = 0; this.loud = false; this.lastLoud = 0;
      this.stats = setInterval(() => { push({ ev: "mic.sent", text: this.chunks + " chunks, peak " + this.peak + ", ahead " + Math.round(this.samples / 24 - (performance.now() - this.firstAt)) + " ms" + (this.bufferedAmount ? ", buffered " + this.bufferedAmount : "") }); this.chunks = 0; this.peak = 0; }, 5000);
    }
    send(data) {
      const m = JSON.parse(data);
      if (m.type === "input.audio") {
        const bin = atob(m.audio); let peak = 0;
        for (let i = 0; i + 1 < bin.length; i += 2) { const v = Math.abs((bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8)) << 16 >> 16); if (v > peak) peak = v; }
        this.chunks += 1; if (peak > this.peak) this.peak = peak;
        if (!this.firstAt) { this.firstAt = performance.now(); this.samples = 0; } this.samples += bin.length / 2; // audio sent vs wall clock: "ahead" growing means the service falls behind
        const now = Math.round(performance.now() - t0);
        if (peak > 600) { if (!this.loud) { this.loud = true; push({ ev: "mic.loud.start" }); } this.lastLoud = now; }
        else if (this.loud && now - this.lastLoud > 400) { this.loud = false; log.push({ t: this.lastLoud, ev: "mic.loud.end" }); }
      } else push({ ev: "→ " + m.type, text: m.type === "tool.result" ? m.result : (m.instructions || "") });
      super.send(data);
    }
  };
})();`;

// ── Demo host + Chrome + CDP ─────────────────────────────────────────────────────────────────────────────────
const server = spawn(process.execPath, ["scripts/dev.mjs"], { env: { ...process.env, PORT: String(PORT), CREW_API: "0" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok) => server.stdout.once("data", ok));
const chrome = spawn(CHROME, [
  ...(HEADED ? [] : ["--headless=new"]), `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(dir, "profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-features=AudioServiceSandbox", // the sandboxed audio service cannot read the WAV (silence, no error)
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${micWav}%noloop`,
  "--autoplay-policy=no-user-gesture-required", "--mute-audio", "about:blank",
], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 500); };
process.on("SIGINT", () => { cleanup(); process.exit(130); });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let target = null;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try { target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
}
if (!target) { console.error("Chrome did not open its debugging port"); cleanup(); process.exit(2); }
const cdp = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok) => (cdp.onopen = ok));
let seq = 0;
const pending = new Map();
cdp.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); } };
const call = (method, params = {}) => new Promise((ok) => { const id = ++seq; pending.set(id, ok); cdp.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true })).result?.value;

await call("Page.enable");
await call("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
await call("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
for (let i = 0; i < 40 && !(await evaluate("Boolean(document.querySelector('#voice button'))")); i++) await sleep(250);
await evaluate("document.querySelector('#voice button').click()");

const all = [];
let micOpenAt = 0;
const runFor = (turns[turns.length - 1].at + TAIL_S) * 1000;
const started = Date.now();
while (Date.now() - started < runFor + 3000) {
  await sleep(500);
  const fresh = JSON.parse((await evaluate(`JSON.stringify(window.__log.splice(0))`)) || "[]");
  for (const e of fresh) {
    all.push(e);
    if (e.ev === "mic.open") micOpenAt = e.t;
    if (e.ev !== "mic.sent" || argv.includes("--verbose")) console.log(`${String(e.t).padStart(6)}ms  ${e.ev}${e.text ? "  " + String(e.text).slice(0, 200) : ""}`);
  }
  if (all.some((e) => e.ev === "ws.close" || e.ev === "session.ended")) break;
}
const dockSays = await evaluate("location.href + ' | ' + document.querySelector('#voice').dataset.state + ' | mic ' + document.querySelector('#voice').dataset.mic + ' | ' + document.querySelector('#voice').innerText.replace(/\\n+/g, ' / ')");
await evaluate("(() => { const b = document.querySelector('#voice button'); if (document.querySelector('#voice').dataset.state !== 'ended') b.click(); })()");
await sleep(800);

// ── Verdict per spoken turn ──────────────────────────────────────────────────────────────────────────────────
all.sort((a, b) => a.t - b.t);
console.log(`\ndock at the end: ${dockSays}`);
const sent = all.filter((e) => e.ev === "mic.sent");
console.log(`mic: ${all.find((e) => e.ev === "mic.open")?.text || all.find((e) => e.ev === "mic.error")?.text || "never opened"}`);
console.log(`audio sent: ${sent.map((e) => e.text.replace(" chunks, peak ", "/").replace(", ahead ", " +")).join("  ")}  (chunks/peak per 5 s, then audio sent ahead of the wall clock)`);
let fail = false;
const ends = all.filter((e) => e.ev === "mic.loud.end");
turns.forEach((turn, i) => {
  const expected = micOpenAt + (turn.at + turn.seconds) * 1000;
  const end = ends.reduce((best, e) => (Math.abs(e.t - expected) < Math.abs((best?.t ?? 1e12) - expected) ? e : best), null);
  const after = (ev, from) => all.find((e) => e.t >= from && e.ev === ev);
  const begin = end && all.filter((e) => e.ev === "mic.loud.start" && e.t <= end.t).pop();
  const detected = begin && after("input.speech.started", begin.t);
  const heard = end && after("transcript.user", end.t - 3000);
  const tool = end && after("tool.call", end.t);
  const answer = tool && after("reply.audio.first", tool.t);
  const firstSound = end && after("reply.audio.first", end.t);
  const line = answer && after("transcript.agent", answer.t);
  if (!heard || !tool || !answer) fail = true;
  console.log(`turn ${i + 1} "${turn.text}": heard ${heard ? JSON.stringify(heard.text) : "NOTHING"} · start of speech → service detects it ${detected ? detected.t - begin.t + " ms" : "—"} · end of speech → tool.call ${tool ? tool.t - end.t + " ms" : "—"} · → first sound ${firstSound ? firstSound.t - end.t + " ms" : "—"} · → answer audio ${answer ? answer.t - end.t + " ms" : "—"}${line ? `\n        officer: ${JSON.stringify(line.text)}` : ""}`);
});
cleanup();
setTimeout(() => process.exit(fail ? 1 : 0), 700);
