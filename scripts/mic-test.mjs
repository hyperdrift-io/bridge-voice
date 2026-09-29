#!/usr/bin/env node
// Spoken-path gate: a real Chrome, the real getUserMedia → worklet → socket path, and a WAV standing in for the
// microphone (Chrome's fake capture device). smoke.mjs skips the browser; this is the part the captain actually uses.
// Prints a timeline and, per spoken turn, last loud mic chunk → tool.call → first answer audio.
//   node scripts/mic-test.mjs "why@16" "next@34"        utterance@seconds-after-the-mic-opens
//   node scripts/mic-test.mjs --tail 12 --headed "why@16"
//   OFFICER_AGENT_ID=agent_… node scripts/mic-test.mjs "why@16"   the own-LLM path: the island binds to the stored agent
//   OFFICER_AGENT_ID=agent_… node scripts/mic-test.mjs --live --take <dir>   the founder's own take: real mic, headed Chrome; ends on the goodbye
// Opens a paid AssemblyAI session for as long as the schedule runs. Zero dependencies (CDP over Node's WebSocket).
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const TAIL_S = Number(flag("--tail", 14)); // listen this long after the last utterance
const PORT = Number(flag("--port", 8799));
const CDP_PORT = Number(flag("--cdp", 9377));
const HEADED = argv.includes("--headed");
const SESSION_PATCH = JSON.parse(flag("--session", "null"));
const LIVE = argv.includes("--live"); // the founder's own take: a headed Chrome, the real microphone, no schedule; the rig records the page, the officer and the mic
const MAX_S = Number(flag("--max", 240)); // a live take ends when the session ends (a goodbye), or here
const URL_BASE = flag("--url", ""); // run against a deployed page (the judges' URL) instead of a local host
const VOICES = flag("--voices", ""); // pre-rendered captain lines (u0.wav, u1.wav … 48 kHz mono PCM16) instead of macOS say
const TAKE = flag("--take", ""); // record a take: 2x screencast frames, the officer's audio per reply and live captions → <dir>; assemble with scripts/assemble-take.mjs
if (TAKE) mkdirSync(join(TAKE, "frames"), { recursive: true }); // test a session setting without touching the island: merged into the island's own session.update
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const RATE = 48000;
const turns = argv.filter((a) => /@\d/.test(a)).map((a) => { const at = a.lastIndexOf("@"); return { text: a.slice(0, at), at: Number(a.slice(at + 1)) }; });
if (!turns.length && !LIVE) turns.push({ text: "why", at: 16 });

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
const REAL = LIVE && !turns.length; // a live take with a schedule is a rehearsal of the live path: same recording, the test microphone
const total = !turns.length ? 2 : Math.ceil((turns[turns.length - 1].at + TAIL_S + 10) * RATE) * 2;
const pcm = Buffer.alloc(total);
// A real microphone in a quiet room is never digital silence; without a floor the dock rightly reports "sends pure silence".
for (let i = 0; i < total; i += 2) pcm.writeInt16LE(Math.round((Math.random() - 0.5) * 40), i);
turns.forEach((t, i) => {
  const wav = join(dir, `u${i}.wav`);
  if (VOICES) writeFileSync(wav, readFileSync(join(VOICES, `u${i}.wav`)));
  else execFileSync("say", ["-o", wav, `--data-format=LEI16@${RATE}`, t.text]);
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
  const PATCH = ${JSON.stringify(SESSION_PATCH)};
  const TAKE = ${JSON.stringify(Boolean(TAKE))};
  // A take keeps the officer's audio per reply (24 kHz PCM16, base64, in arrival order) with epoch times, and shows live
  // captions: the officer's words paced to the speech, the captain's the moment they are heard. Video-only chrome.
  window.__audio = []; let reply = null;
  const LIVE = ${JSON.stringify(LIVE)};
  window.__mic = { at: 0, chunks: [] }; // a live take keeps what the page sends the service: the captain's own voice, 24 kHz PCM16
  let caption = null, captionTimer = 0;
  const showCaption = (who, text, pace) => {
    if (!TAKE) return;
    if (!caption) { caption = document.createElement("div"); caption.id = "take-caption"; caption.innerHTML = "<span></span><b></b>"; document.body.append(caption); }
    clearInterval(captionTimer);
    caption.dataset.who = who; caption.querySelector("span").textContent = who === "officer" ? "First Officer" : "Captain";
    const b = caption.querySelector("b");
    if (!pace) { b.textContent = text; caption.hidden = !text; return; }
    const words = text.split(" "); let n = 0; caption.hidden = false; b.textContent = "";
    captionTimer = setInterval(() => { n += 1; b.textContent = words.slice(0, n).join(" "); if (n >= words.length) clearInterval(captionTimer); }, pace);
  };
  if (TAKE) document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "#voice > p,#voice > small,#voice form{display:none}#take-caption{position:fixed;left:3.5rem;right:26rem;bottom:2.4rem;z-index:60;display:grid;gap:.25rem;pointer-events:none;font:inherit}#take-caption span{font-size:.85rem;letter-spacing:.06em;text-transform:uppercase;opacity:.7}#take-caption b{font-size:2rem;line-height:1.25;font-weight:600;color:#e6e9ef;text-shadow:0 2px 12px rgb(0 0 0/.7)}#take-caption[data-who=officer] span{color:#e8b04b}#take-caption[data-who=captain] span{color:#4bd08a}#take-caption[hidden]{display:none}"; document.head.append(st); });
  const merge = (a, b) => { for (const [k, v] of Object.entries(b || {})) { if (v === null) delete a[k]; else if (v && typeof v === "object" && !Array.isArray(v)) a[k] = merge(a[k] || {}, v); else a[k] = v; } return a; };
  const t0 = performance.now(), log = (window.__log = []);
  const push = (o) => log.push({ t: Math.round(performance.now() - t0), abs: Date.now() / 1000, ...o });
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
        if (m.type === "reply.audio") {
          if (!audio) { audio = true; push({ ev: "reply.audio.first" }); }
          // The words usually stream before the first audio chunk, so a new reply takes whatever has been said so far.
          // Own-LLM replies stream no text deltas (seen 2026-09-24), but the island has worked out the same line the endpoint
          // is about to say (mirror mode), so the caption comes from there; a managed-model reply falls back to the deltas.
          if (TAKE) { if (!reply || reply.id !== m.reply_id) { const line = said || (window.voiceTools && window.voiceTools.mirrored && window.voiceTools.mirrored()) || ""; reply = { id: m.reply_id || String(window.__audio.length), at: Date.now() / 1000, chunks: [], text: line }; window.__audio.push(reply); if (line) showCaption("officer", line, 1000 / 2.6); } reply.chunks.push(m.audio || m.data); }
          return;
        }
        if (m.type === "transcript.agent.delta") { said = m.text.length >= said.length && m.text.startsWith(said) ? m.text : said + m.text; if (reply && !reply.text) { reply.text = said; showCaption("officer", said, 1000 / 2.6); } return; }
        if (m.type === "transcript.user") showCaption("captain", m.text, 0);
        if (m.type === "transcript.agent" && TAKE && reply && !reply.text) { reply.text = m.text; showCaption("officer", m.text, 0); } // a line nobody could predict (the brain's): captioned as it ends
        if (m.type === "reply.done") { if (reply) { reply.cut = Date.now() / 1000; reply.interrupted = m.status === "interrupted"; if (m.status === "interrupted") showCaption("officer", "", 0); } reply = null; }
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
      if (PATCH && m.type === "session.update" && m.session && !m.session.agent_id) { merge(m.session, PATCH); data = JSON.stringify(m); push({ ev: "session.patched", text: JSON.stringify(m.session.input) }); }
      if (m.type === "input.audio") {
        if (LIVE && TAKE) { if (!window.__mic.at) window.__mic.at = Date.now() / 1000; window.__mic.chunks.push(m.audio); }
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
const server = URL_BASE ? { kill() {} } : spawn(process.execPath, ["scripts/dev.mjs"], { env: { ...process.env, PORT: String(PORT), CREW_API: "0" }, stdio: ["ignore", "pipe", "inherit"] });
if (!URL_BASE) await new Promise((ok) => server.stdout.once("data", ok));
const chrome = spawn(CHROME, [
  ...(HEADED || REAL ? [] : ["--headless=new"]), `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(dir, "profile")}`, "--no-first-run", "--no-default-browser-check", "--disable-features=AudioServiceSandbox", // the sandboxed audio service cannot read the WAV (silence, no error)
  "--use-fake-ui-for-media-stream", ...(REAL ? [] : ["--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${micWav}%noloop`]),
  "--autoplay-policy=no-user-gesture-required", ...(REAL ? [] : ["--mute-audio"]), ...(TAKE ? ["--window-size=1280,720"] : []), "about:blank",
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
const frames = [];
cdp.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); }
  if (m.method === "Page.screencastFrame") {
    const file = join(TAKE, "frames", `f${String(frames.length).padStart(5, "0")}.png`);
    writeFileSync(file, Buffer.from(m.params.data, "base64"));
    frames.push({ file, t: m.params.metadata.timestamp }); // seconds since the epoch, Chrome's own clock
    cdp.send(JSON.stringify({ id: ++seq, method: "Page.screencastFrameAck", params: { sessionId: m.params.sessionId } }));
  }
};
const call = (method, params = {}) => new Promise((ok) => { const id = ++seq; pending.set(id, ok); cdp.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true })).result?.value;

await call("Page.enable");
if (TAKE) await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false });
await call("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
await call("Page.navigate", { url: URL_BASE ? `${URL_BASE.replace(/\/$/, "")}/` : `http://127.0.0.1:${PORT}/` });
for (let i = 0; i < 40 && !(await evaluate("Boolean(document.querySelector('#voice button'))")); i++) await sleep(250);
if (TAKE) { await call("Page.startScreencast", { format: "png", maxWidth: 2560, maxHeight: 1440, everyNthFrame: 1 }); await sleep(400); }
const takeStart = Date.now() / 1000;
await evaluate("document.querySelector('#voice button').click()");

const all = [];
let micOpenAt = 0;
const runFor = LIVE ? MAX_S * 1000 : (turns[turns.length - 1].at + TAIL_S) * 1000;
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
if (TAKE) {
  await sleep(1200); // let the last line settle on screen
  await call("Page.stopScreencast");
  const replies = JSON.parse((await evaluate("JSON.stringify(window.__audio)")) || "[]");
  for (const [i, r] of replies.entries()) { writeFileSync(join(TAKE, `officer-${String(i).padStart(2, "0")}.pcm`), Buffer.concat(r.chunks.map((c) => Buffer.from(c, "base64")))); delete r.chunks; r.file = `officer-${String(i).padStart(2, "0")}.pcm`; }
  const micAt = all.find((e) => e.ev === "mic.open");
  writeFileSync(join(TAKE, "take.json"), JSON.stringify({ start: takeStart, frames: frames.map((f) => ({ file: f.file, t: f.t })), replies, captain: turns.map((t, i) => ({ text: t.text, seconds: t.seconds, file: `captain-${i}.wav`, at: takeStart + (micAt ? micAt.t / 1000 : 0) + t.at })) }, null, 1));
  if (LIVE) {
    const mic = JSON.parse(await evaluate("JSON.stringify(window.__mic)"));
    writeFileSync(join(TAKE, "captain.pcm"), Buffer.concat(mic.chunks.map((c) => Buffer.from(c, "base64"))));
    const take = JSON.parse(readFileSync(join(TAKE, "take.json"), "utf8"));
    take.captain = mic.at ? [{ text: "(live microphone)", file: "captain.pcm", pcm: true, at: mic.at }] : [];
    take.heard = all.filter((e) => e.ev === "transcript.user").map((e) => ({ at: e.abs, text: e.text }));
    // When the captain actually spoke, by the service's own detection (it lags the first syllable by about half a second).
    // The browser's auto-gain lifts the room between utterances; the assembler keeps the mic only inside these windows.
    const starts = all.filter((e) => e.ev === "input.speech.started");
    take.segments = starts.map((a) => { const b = all.find((e) => e.abs >= a.abs && (e.ev === "input.speech.stopped" || e.ev === "transcript.user")); return { from: a.abs - 0.9, to: (b ? b.abs : a.abs + 2) + 0.15 }; });
    writeFileSync(join(TAKE, "take.json"), JSON.stringify(take, null, 1));
  } else turns.forEach((t, i) => writeFileSync(join(TAKE, `captain-${i}.wav`), readFileSync(join(dir, `u${i}.wav`))));
  console.log(`take: ${frames.length} frames, ${replies.length} officer replies → ${TAKE}`);
}
const dockSays = await evaluate("JSON.stringify({ state: document.querySelector('#voice').dataset.state, mic: document.querySelector('#voice').dataset.mic, table: (document.querySelector('#voice section') || {}).innerText, marks: [...document.querySelectorAll('.ship')].map(s => s.dataset.app + ':' + (s.dataset.officer || '-')).join(' '), topic: document.documentElement.dataset.officer })");
await evaluate("(() => { const b = document.querySelector('#voice button'); if (document.querySelector('#voice').dataset.state !== 'ended') b.click(); })()");
await sleep(800);

// ── Verdict per spoken turn ──────────────────────────────────────────────────────────────────────────────────
all.sort((a, b) => a.t - b.t);
console.log(`\ndock at the end: ${String(dockSays).replace(/\\n+/g, " / ")}`);
const sent = all.filter((e) => e.ev === "mic.sent");
console.log(`mic: ${all.find((e) => e.ev === "mic.open")?.text || all.find((e) => e.ev === "mic.error")?.text || "never opened"}`);
console.log(`audio sent: ${sent.map((e) => e.text.replace(" chunks, peak ", "/").replace(", ahead ", " +")).join("  ")}  (chunks/peak per 5 s, then audio sent ahead of the wall clock)`);
let fail = false;
const agentMode = Boolean(process.env.OFFICER_AGENT_ID) || Boolean(URL_BASE); // the local host hands the island a stored agent: no tool calls, the officer is the model
const ends = all.filter((e) => e.ev === "mic.loud.end");
if (LIVE) console.log(`live take: ${all.filter((e) => e.ev === "transcript.user").length} captain turns heard`);
turns.forEach((turn, i) => {
  const expected = micOpenAt + (turn.at + turn.seconds) * 1000;
  const end = ends.reduce((best, e) => (Math.abs(e.t - expected) < Math.abs((best?.t ?? 1e12) - expected) ? e : best), null);
  const after = (ev, from) => all.find((e) => e.t >= from && e.ev === ev);
  const begin = end && all.filter((e) => e.ev === "mic.loud.start" && e.t <= end.t).pop();
  const detected = begin && after("input.speech.started", begin.t);
  const heard = end && after("transcript.user", end.t - 3000);
  const tool = end && after("tool.call", end.t);
  const firstSound = end && after("reply.audio.first", end.t);
  // With a tool, the first sound is the filler and the answer follows the tool call; with the officer as the model
  // (a stored own-LLM agent, no tool) the first sound is the answer itself.
  const answer = tool ? after("reply.audio.first", tool.t) : agentMode ? firstSound : null;
  const line = answer && after("transcript.agent", answer.t);
  if (!heard || !answer) fail = true;
  console.log(`turn ${i + 1} "${turn.text}": heard ${heard ? JSON.stringify(heard.text) : "NOTHING"} · start of speech → service detects it ${detected ? detected.t - begin.t + " ms" : "—"} · end of speech → ${agentMode ? "answer audio" : "tool.call"} ${tool ? tool.t - end.t + " ms" : answer ? answer.t - end.t + " ms" : "—"}${agentMode ? "" : ` · → first sound ${firstSound ? firstSound.t - end.t + " ms" : "—"} · → answer audio ${answer ? answer.t - end.t + " ms" : "—"}`}${line ? `\n        officer: ${JSON.stringify(line.text)}` : ""}`);
});
cleanup();
setTimeout(() => process.exit(fail ? 1 : 0), 700);
