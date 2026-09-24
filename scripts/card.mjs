#!/usr/bin/env node
// Render an HTML card to a 2560x1440 PNG (1280x720 at 2x) and, optionally, a still clip. Zero dependencies: Chrome + CDP.
//   node scripts/card.mjs docs/video/credits.html out/credits.png [--url https://…] [--clip out/credits.mp4 --seconds 4]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const [input, output] = process.argv.slice(2);
const flag = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
let html = readFileSync(input, "utf8");
if (flag("--url")) html = html.replace(/<span data-url>[^<]*<\/span>/, `<span data-url>${flag("--url")}</span>`);
const tmp = mkdtempSync(join(tmpdir(), "card-")); const page = join(tmp, "card.html"); writeFileSync(page, html);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--remote-debugging-port=9393", `--user-data-dir=${join(tmp, "p")}`, "--no-first-run", "--hide-scrollbars", "--window-size=1280,720", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let target; for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch("http://127.0.0.1:9393/json/list")).json()).find((t) => t.type === "page"); } catch {} }
const cdp = new WebSocket(target.webSocketDebuggerUrl); await new Promise((ok) => (cdp.onopen = ok));
let seq = 0; const pending = new Map();
cdp.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); } };
const call = (method, params = {}) => new Promise((ok) => { const id = ++seq; pending.set(id, ok); cdp.send(JSON.stringify({ id, method, params })); });
await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 2, mobile: false });
await call("Page.navigate", { url: `file://${resolve(page)}` }); await sleep(700);
const { data } = await call("Page.captureScreenshot", { format: "png" });
writeFileSync(output, Buffer.from(data, "base64")); chrome.kill();
if (flag("--clip")) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-t", flag("--seconds", "4"), "-i", output, "-f", "lavfi", "-t", flag("--seconds", "4"), "-i", "anullsrc=r=48000:cl=mono", "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "16", "-c:a", "aac", "-b:a", "192k", "-shortest", flag("--clip")]);
console.log(`→ ${output}${flag("--clip") ? ` + ${flag("--clip")}` : ""}`);
