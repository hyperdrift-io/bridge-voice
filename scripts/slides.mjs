#!/usr/bin/env node
// Print docs/slides/index.html to the submission PDF (one 16:9 page per <section>). Zero dependencies: Chrome + CDP.
//   node scripts/slides.mjs [docs/slides/index.html] [docs/slides/first-officer.pdf]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const [input = "docs/slides/index.html", output = "docs/slides/first-officer.pdf"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const tmp = mkdtempSync(join(tmpdir(), "slides-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--remote-debugging-port=9395", `--user-data-dir=${join(tmp, "p")}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let target; for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch("http://127.0.0.1:9395/json/list")).json()).find((t) => t.type === "page"); } catch {} }
const cdp = new WebSocket(target.webSocketDebuggerUrl); await new Promise((ok) => (cdp.onopen = ok));
let seq = 0; const pending = new Map();
cdp.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); } };
const call = (method, params = {}) => new Promise((ok) => { const id = ++seq; pending.set(id, ok); cdp.send(JSON.stringify({ id, method, params })); });
await call("Page.navigate", { url: `file://${resolve(input)}` }); await sleep(900);
// --facts-only: a complete deck without the slides only the founder can write (they are marked data-yours); the title
// slide keeps the project's own name. A fallback for the deadline, never a substitute for his words.
if (process.argv.includes("--facts-only")) await call("Runtime.evaluate", { expression: `document.querySelectorAll("section[data-yours]").forEach((s, i) => { if (i === 0) { s.removeAttribute("data-yours"); s.querySelector("h1").innerHTML = "The <em>First Officer</em>"; s.querySelector("p").textContent = "Bridge Voice: a voice that reports to the captain over the Hyperdrift Bridge."; } else s.remove(); })` });
// 1600x900 CSS px at 96 dpi = 16.667 x 9.375 in; the page's own @page rule sets the same size, margins zero.
const { data } = await call("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, paperWidth: 16.667, paperHeight: 9.375, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
writeFileSync(output, Buffer.from(data, "base64")); chrome.kill();
console.log(`→ ${output}`);
