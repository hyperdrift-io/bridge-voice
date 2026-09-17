#!/usr/bin/env node
// Freeze a rendered Bridge snapshot into the public demo page.
//
//   cd ~/dev/hyperdrift/scripts && python3 -m bau.cli fleet-status --html --out /tmp/bridge.html
//   node scripts/build-demo.mjs /tmp/bridge.html [--reads ~/dev/hyperdrift/.nightcrew] [--out public/index.html]
//
// What it does, in order:
//   1. scrubs private surfaces (notifications, notebook, commands, contests, strategy drawers)
//   2. rewrites each ship's headline line to its Commander read line
//   3. inlines the last recorded Commander read per ship as #bridge-reads
//   4. exposes the page's own functions as window.bridge (the script is one IIFE)
//   5. attaches the voice island as files (router.js, mic.js, voice.js, voice.css), dropping any copy the renderer inlined
// It prints a scrub report; the founder reads it before the file goes anywhere public.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!input) {
  console.error("usage: node scripts/build-demo.mjs <rendered-bridge.html> [--reads <nightcrew-dir>] [--out public/index.html]");
  process.exit(1);
}
const out = opt("out", "public/index.html");
const readsDir = opt("reads", "");

let html = readFileSync(input, "utf8");
const report = [];
const count = (re) => (html.match(re) || []).length;

// Remove a whole element (with nesting) whose opening tag matches `openRe`.
function removeBlocks(tag, openRe, label) {
  let removed = 0;
  for (;;) {
    const m = openRe.exec(html);
    if (!m) break;
    const start = m.index;
    const openTag = new RegExp(`<${tag}\\b`, "g");
    const closeTag = new RegExp(`</${tag}\\s*>`, "g");
    let depth = 0;
    let pos = start;
    let end = -1;
    for (;;) {
      openTag.lastIndex = pos;
      closeTag.lastIndex = pos;
      const o = openTag.exec(html);
      const c = closeTag.exec(html);
      if (!c) break;
      if (o && o.index < c.index) {
        depth += 1;
        pos = o.index + 1;
      } else {
        depth -= 1;
        pos = c.index + c[0].length;
        if (depth === 0) {
          end = pos;
          break;
        }
      }
    }
    if (end < 0) break;
    html = html.slice(0, start) + html.slice(end);
    removed += 1;
    openRe.lastIndex = 0;
  }
  report.push(`${label}: removed ${removed}`);
}

// 1. Scrub.
html = html.replace(
  /(<script type="application\/json" id="notif-data">)[\s\S]*?(<\/script>)/,
  "$1[]$2"
);
report.push("notifications: emptied");
removeBlocks("aside", /<aside\b[^>]*id="notif-panel"[^>]*>/, "notifications panel");
removeBlocks("button", /<button\b[^>]*id="notif-bell"[^>]*>/, "notification bell");
removeBlocks("section", /<section\b[^>]*id="commander-dock"[^>]*>/, "commander dock");
removeBlocks("section", /<section\b[^>]*id="mcp-maker-roadmap"[^>]*>/, "mcp-maker roadmap");
removeBlocks("section", /<section\b[^>]*data-search-keywords="contest[^"]*"[^>]*>/, "contests panel");
removeBlocks("details", /<details\b[^>]*id="[a-z0-9-]+-(?:notes|tactics|memory|backlog)"[^>]*>/, "strategy drawers");
removeBlocks("form", /<form\b(?![^>]*captain-form)[^>]*>/, "forms (kept captain form)");
removeBlocks("div", /<div\b[^>]*class="mission-actions"[^>]*>/, "mission action buttons");
removeBlocks("li", /<li\b[^>]*>(?:(?!<\/li>)[\s\S])*?data-command=/, "palette command entries");
html = html.replace(/\s+data-command="[^"]*"/g, "");
html = html.replace(/\s+data-crew-api-base="[^"]*"/g, "");
html = html.replace(/\s+data-trigger-[a-z]+="[^"]*"/g, "");
report.push("data-command / crew api attributes: stripped");

// 2. Each ship's headline is its read line, not the distribution queue.
html = html.replace(
  /(<article class="ship[^"]*" data-app="([^"]+)"[^>]*>(?:(?!<\/button>)[\s\S])*?<span class="ship-move">)[\s\S]*?(<\/span>)/g,
  (whole, head, app, tail) => {
    const modal = html.match(new RegExp(`<dialog[^>]*id="modal-${app}"[\\s\\S]*?<\\/dialog>`));
    const line = modal && modal[0].match(/<section class="traffic-panel[^"]*">[\s\S]*?<\/div>\s*<p>([^<]+)<\/p>/);
    return head + (line ? line[1] : "Read pending.") + tail;
  }
);
report.push("ship headline lines: rewritten to the Commander read line");
html = html.replace(/\s+data-tip="[^"]*reddit[^"]*"/gi, "");
html = html.replace(/<[^>]+>[^<]*reddit[^<]*<\/[^>]+>/gi, "");
report.push("reddit-bearing tips and lines: dropped");

// 3. Inline the last recorded Commander read per ship.
const reads = {};
if (readsDir && existsSync(readsDir)) {
  for (const app of readdirSync(readsDir)) {
    const dir = join(readsDir, app);
    let files;
    try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort(); } catch { continue; }
    for (const f of files.reverse()) {
      const lines = readFileSync(join(dir, f), "utf8").trim().split("\n").reverse();
      const hit = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .find((r) => r && r.kind === "read" && r.data);
      if (hit) {
        reads[app] = {
          date: hit.data.date || f.replace(".jsonl", ""),
          verdict: hit.data.verdict || "",
          pragmatic: hit.data.pragmatic || hit.summary || "",
          opportunity: hit.data.opportunity || "",
          confidence: hit.data.confidence || "",
        };
        break;
      }
    }
  }
}
report.push(`commander reads inlined: ${Object.keys(reads).join(", ") || "none"}`);

// 3b. The snapshot is offline: no manifest, no service worker, and the Bridge's Crew API calls fail fast and quietly.
html = html.replace(/<link rel="manifest"[^>]*>\s*/, "");
html = html.replace(/\s*if \("serviceWorker" in navigator[\s\S]*?\.catch\(\(\) => \{\}\);?\s*\}/, "");
const iifeStart = html.indexOf("<script>\n(() => {\n");
if (iifeStart < 0) throw new Error("could not find the Bridge IIFE start — page shape changed");
html = html.replace("<script>\n(() => {\n", "<script>\n(() => {\n  window.__bridgeSnapshot = true;\n  const fetch = () => Promise.reject(new Error(\"offline snapshot\"));\n");
report.push("offline: manifest + service worker dropped, Crew API fetches short-circuited");

// 4. Expose the page's functions. The whole script is one IIFE ending in `})();`.
const exportLine = `
  window.bridge = { focusShip, exitFocusMode, visibleShips, selectedShip, openShip, applyFleetView, activeSortMode, updateRanks, showWorkspace, renderFleetSearch, searchEntries, activateSearchEntry, openCommandPalette, closeCommandPalette };
`;
if (!html.includes("window.bridge = {")) {
  const iifeEnd = html.lastIndexOf("})();\n</script>");
  if (iifeEnd < 0) throw new Error("could not find the Bridge IIFE end — page shape changed");
  html = html.slice(0, iifeEnd) + exportLine + html.slice(iifeEnd);
}

// 5. Attach the voice island: exactly one, as files next to the page (public/router.js, mic.js, voice.js, voice.css), so the
// snapshot never goes stale against the island. A Bridge rendered with BRIDGE_VOICE on already carries an inlined copy;
// the scrub strips that copy's <form>, which kills its script half-way (seen 2026-09-09: two docks, one dead). Drop it.
html = html.replace(/<style>\s*\/\* Bridge Voice dock[\s\S]*?<\/style>\s*/g, "").replace(/<script>\s*\/\/ The officer's ear[\s\S]*?<\/script>\s*/g, "");
html = html.replace("</head>", `<meta name="robots" content="noindex">\n<link rel="stylesheet" href="voice.css">\n</head>`);
html = html.replace(
  "</body>",
  `<script type="application/json" id="bridge-reads">${JSON.stringify(reads)}</script>\n<script src="router.js"></script>\n<script src="mic.js"></script>\n<script src="voice.js"></script>\n</body>`
);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);

// Report.
report.push(`remaining £/$ amounts: ${count(/£\s?[\d,.]+|\$\s?[\d,.]+k?/g)}`);
report.push(`remaining "reddit" mentions: ${count(/reddit/gi)}`);
report.push(`remaining data-command: ${count(/data-command=/g)}`);
report.push(`remaining forms: ${count(/<form\b/g)} (captain form expected)`);
report.push(`ships: ${(html.match(/<article class="ship[^"]*" data-app="([^"]+)"/g) || []).map((s) => s.match(/data-app="([^"]+)"/)[1]).join(", ")}`);
report.push(`size: ${(html.length / 1024).toFixed(0)} KB → ${out}`);
console.log(report.map((l) => `- ${l}`).join("\n"));
