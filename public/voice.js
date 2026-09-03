// Bridge Voice — the First Officer: a voice that reports to the captain over the Bridge.
// The AssemblyAI Voice Agent API hosts the conversation (turn-taking, barge-in, speaking first, TTS).
// The fleet does the thinking: /api/voice/agenda (what to decide, with the why), /api/voice/decide,
// /api/voice/ask (a question routed to the right fleet skill), /api/voice/interrupts (spoken unprompted).
// One tool carries every utterance; router.js (loaded first) decides deterministically what it meant;
// the model speaks the exact line it gets back. Cockpit tools drive the page's own functions (window.bridge).
(() => {
  const WS_URL = "wss://agents.assemblyai.com/v1/ws";
  const API = "/api/voice";
  const SAMPLE_RATE = 24000;
  const IDLE_MS = 120000; // no speech for 2 minutes → end the session (there is no free tier)
  const INTERRUPT_EVERY_MS = 20000;
  const THINKING_LINES = [
    "Give me a moment; I am reading the signals.",
    "Still on it. I want to give you a straight answer, not a fast one.",
    "Nearly there.",
  ];
  const TEXT_ONLY = location.hash === "#text";

  const SESSION = {
    system_prompt: [
      "You are the First Officer of the Hyperdrift Bridge. You report to the captain, who runs a small fleet of live apps.",
      "For everything the captain says, call captain_said with their words, every time, then say the result's 'say' text word for word and nothing else.",
      "If the result has no 'say' but has 'context', answer from the context in two short sentences, opinion first.",
      "When an instruction tells you to say something exactly, say exactly that.",
      "Never speak a tool name, its arguments, brackets or code. Only the 'say' text.",
      "Never invent a number, a deadline, an option or a reason. Short sentences. Numbers said plainly.",
      "Strengths first; a gap is a next step, never a fault. You never talk down to the captain.",
    ].join(" "),
    input: {
      transcription_mode: "min_latency",
      turn_detection: { min_silence: 200, max_silence: 500 }, // measured 2026-09-03: ~1 s faster than adaptive for short commands
      keyterms: ["revela", "hyper-cv", "intel", "web3-capital", "mcp-maker", "Commander", "First Officer"],
    },
    output: { voice: "anna" },
    tools: [
      {
        type: "function",
        name: "captain_said",
        description: "Call this for everything the captain says, every single time, passing their words verbatim. Never answer without calling it. Returns 'say', the exact line to speak.",
        parameters: { type: "object", properties: { text: { type: "string", description: "The captain's words, verbatim" } }, required: ["text"] },
        execution_mode: "interactive", // measured 2026-09-03: hold made the model narrate the call; interactive stays clean
        timeout_seconds: 120,
        // Measured 2026-09-03: without this the default model paraphrases or voices the tool name; with it, 3/3 verbatim and clean.
        response_instructions: { success: "Read the 'say' text aloud exactly as written, word for word. Add nothing. Never say the tool name.", error: "Say the error in one sentence and ask the captain to say it again." },
      },
    ],
  };

  // ── UI ──────────────────────────────────────────────────────────────────
  const dock = document.createElement("aside");
  dock.id = "voice";
  dock.setAttribute("aria-label", "First Officer");
  dock.dataset.state = "idle";
  dock.innerHTML = `
    <button type="button">Open the watch</button>
    <output aria-live="polite"></output>
    <form><input name="say" autocomplete="off" placeholder="…or type to the officer" aria-label="Type to the officer"></form>
    <p>The officer opens with what matters. <q>why?</q> · <q>do it</q> · <q>next</q> · <q>the brief</q> · <q>show me intel</q> · or ask anything.</p>`;
  document.body.append(dock);
  const button = dock.querySelector("button");
  const out = dock.querySelector("output");
  const form = dock.querySelector("form");
  const input = dock.querySelector("input");
  const setState = (state, text) => {
    dock.dataset.state = state;
    button.textContent = { idle: "Open the watch", connecting: "Connecting…", listening: "On watch — tap to end", speaking: "Speaking — tap to end", thinking: "Thinking — tap to end", ended: "Watch ended — tap to reopen", error: "Tap to retry" }[state];
    if (text !== undefined) out.textContent = text;
  };

  // ── Session ─────────────────────────────────────────────────────────────
  let ws = null;
  let ctx = null;
  let mic = null;
  let playhead = 0;
  let playing = [];
  let idleTimer = null;
  let agenda = null;
  let current = 0;
  let userSpeaking = false;
  let lastUserText = "";
  let lastUserAt = 0;
  let interruptTimer = null;
  let interruptsSince = "";
  let pendingProposal = null;
  let pendingSay = ""; // a proactive line; if the model routes it through the tool instead of saying it, the tool hands it back

  const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const sayExactly = (text) => { pendingSay = text; send({ type: "reply.create", instructions: `Say exactly: "${text.replace(/"/g, "'")}"` }); };
  const touchIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => end("Watch ended after two quiet minutes."), IDLE_MS); };

  async function start() {
    setState("connecting", "");
    try {
      const token = await fetch(`${API}/token`, { method: "POST" }).then((r) => { if (!r.ok) throw new Error(`token ${r.status}`); return r.json(); }).then((j) => j.token);
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      let ready = false;
      if (!TEXT_ONLY) {
        try {
          mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
          await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
          const worklet = new AudioWorkletNode(ctx, "pcm-processor", { processorOptions: { inputSampleRate: ctx.sampleRate, targetSampleRate: SAMPLE_RATE } });
          ctx.createMediaStreamSource(mic).connect(worklet);
          worklet.port.onmessage = ({ data }) => { if (ready) send({ type: "input.audio", audio: b64(data) }); };
        } catch (err) {
          out.textContent = "No microphone; type to the officer instead.";
        }
      }
      const url = new URL(WS_URL);
      url.searchParams.set("token", token);
      ws = new WebSocket(url);
      ws.onopen = () => send({ type: "session.update", session: SESSION });
      ws.onclose = (e) => { if (dock.dataset.state !== "ended") teardown(e.code === 1006 ? "Connection refused — token expired or invalid." : "Connection closed."); };
      ws.onerror = () => teardown("Connection error.");
      ws.onmessage = ({ data }) => {
        const ev = JSON.parse(data);
        switch (ev.type) {
          case "session.ready": ready = true; playhead = 0; setState("listening", ""); touchIdle(); openWatch(); break;
          case "input.speech.started": userSpeaking = true; touchIdle(); setState("listening"); break;
          case "input.speech.stopped": userSpeaking = false; break;
          case "transcript.user.delta": out.textContent = ev.text; break;
          case "transcript.user": userSpeaking = false; lastUserText = ev.text; lastUserAt = Date.now(); out.textContent = ev.text; break;
          case "reply.started": if (dock.dataset.state !== "thinking") setState("speaking"); break;
          case "reply.audio": play(ev.data); break;
          case "transcript.agent": out.textContent = ev.text; break;
          case "reply.done": pendingSay = ""; if (ev.status === "interrupted") flush(); if (dock.dataset.state !== "thinking") setState("listening"); break;
          case "tool.call": runTool(ev); break;
          case "session.error": console.error("session.error", ev); if (!ready) teardown(`${ev.code}: ${ev.message}`); else out.textContent = ev.message; break;
          case "session.ended": teardown("Watch ended.", "ended"); break;
        }
      };
    } catch (err) {
      console.error(err);
      teardown(String(err.message || err));
    }
  }
  function end(text) {
    send({ type: "session.end" }); // stops billing now instead of after the 30 s resume window
    teardown(text || "Watch ended.", "ended");
  }
  function teardown(text, state = "error") {
    clearTimeout(idleTimer);
    clearInterval(interruptTimer);
    flush();
    if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
    if (mic) { mic.getTracks().forEach((t) => t.stop()); mic = null; }
    if (ctx) { ctx.close(); ctx = null; }
    setState(state, text);
  }
  button.addEventListener("click", () => (ws ? end() : start()));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    if (!ws) { start().then(() => typed(text)); return; }
    typed(text);
  });
  function typed(text) {
    const go = () => {
      if (!ws || ws.readyState !== 1 || dock.dataset.state === "connecting") { setTimeout(go, 500); return; }
      lastUserText = text; lastUserAt = Date.now(); out.textContent = text; touchIdle();
      send({ type: "conversation.message", role: "user", content: text });
      send({ type: "reply.create", instructions: `The captain just said: "${text.replace(/"/g, "'")}". Handle it with your tool as usual, then read the 'say' text aloud word for word.` });
    };
    go();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden && ws) end("Watch ended while the tab was hidden."); });
  window.addEventListener("pagehide", () => { if (ws) end(); });

  // ── Audio ───────────────────────────────────────────────────────────────
  const WORKLET = `
    class PcmProcessor extends AudioWorkletProcessor {
      constructor(o) { super(); const { inputSampleRate = sampleRate, targetSampleRate = 24000, chunkMs = 50 } = o.processorOptions || {};
        this.ratio = inputSampleRate / targetSampleRate; this.chunk = Math.round(targetSampleRate * chunkMs / 1000); this.buffer = new Int16Array(this.chunk); this.filled = 0; this.cursor = 0; }
      process(inputs) { const input = inputs[0] && inputs[0][0]; if (!input) return true;
        for (; this.cursor < input.length; this.cursor += this.ratio) { const s = input[Math.floor(this.cursor)]; this.buffer[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
          if (this.filled === this.chunk) { this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]); this.buffer = new Int16Array(this.chunk); this.filled = 0; } }
        this.cursor -= input.length; return true; }
    }
    registerProcessor("pcm-processor", PcmProcessor);`;
  function b64(buffer) {
    const bytes = new Uint8Array(buffer);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function play(base64) {
    if (!ctx) return;
    const bin = atob(base64);
    const pcm = new Int16Array(bin.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) << 16 >> 16;
    const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    playhead = Math.max(playhead, ctx.currentTime + 0.02);
    src.start(playhead);
    playhead += buf.duration;
    playing.push(src);
    src.onended = () => { playing = playing.filter((s) => s !== src); };
  }
  function flush() {
    playing.forEach((s) => { try { s.stop(); } catch {} });
    playing = [];
    playhead = 0;
  }

  // ── The watch ───────────────────────────────────────────────────────────
  const api = (path, init) => fetch(`${API}${path}`, { headers: { "Content-Type": "application/json" }, ...init }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `${path} ${r.status}`);
    return body;
  });
  const item = () => (agenda && agenda.items[current]) || null;
  const ask = (it) => `${it.options.map((o, i) => (i === it.options.length - 1 && it.options.length > 1 ? `or ${o}` : o)).join(", ")}?`;
  const line = (it) => `${it.headline} ${ask(it)}`;
  const spoken = (it) => (it ? { key: it.key, rank: it.rank, kind: it.kind, ship: it.ship || undefined, headline: it.headline, options: it.options } : null);
  async function loadAgenda() { agenda = await api("/agenda"); current = 0; return agenda; }
  async function openWatch() {
    try { await loadAgenda(); } catch (err) { sayExactly(`Captain, I could not load the agenda: ${err.message}. Ask me about a ship instead.`); return; }
    interruptsSince = agenda.generated || new Date().toISOString();
    const first = item();
    if (first) { showFor(first.ui); sayExactly(`Captain, ${agenda.items.length} item${agenda.items.length === 1 ? "" : "s"} on the agenda. First: ${line(first)}`); }
    else sayExactly("Captain, the agenda is clear. Which ship shall we look at?");
    clearInterval(interruptTimer);
    interruptTimer = setInterval(pollInterrupts, INTERRUPT_EVERY_MS);
  }
  async function pollInterrupts() {
    if (!ws || userSpeaking || dock.dataset.state === "thinking") return;
    let body;
    try { body = await api(`/interrupts?since=${encodeURIComponent(interruptsSince)}`); } catch { return; }
    const fresh = body.interrupts || [];
    if (!fresh.length) return;
    interruptsSince = fresh[fresh.length - 1].ts || body.now || interruptsSince;
    if (userSpeaking) return; // the captain started talking meanwhile; it comes round again
    if (fresh[0].ship) showFor({ ship: fresh[0].ship });
    sayExactly(`Captain, ${fresh.map((f) => f.say).join(" ")} Shall I act on it, or carry on?`);
  }
  function showFor(ui) {
    if (!ui) return;
    try {
      if (ui.ship && findShip(ui.ship)) { TOOLS.open_ship({ ship: ui.ship }); return; }
      if (!ui.panel) return;
      const target = document.getElementById(`${ui.panel}-title`) || document.querySelector(`[data-search-keywords*="${ui.panel}"]`) || document.getElementById(ui.panel);
      if (target) { showFleet(); target.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
      TOOLS.navigate({ target: ui.panel });
    } catch { /* the cockpit following is best effort */ }
  }
  async function askOfficer(question) {
    setState("thinking");
    let n = 0;
    const ticker = setInterval(() => { if (n < THINKING_LINES.length) sayExactly(THINKING_LINES[n++]); }, 9000);
    try {
      const it = item();
      const ship = globalThis.officerShipWord(question) || (it && it.ship) || "";
      const body = await api("/ask", { method: "POST", body: JSON.stringify({ question, ship, item: it ? { key: it.key, headline: it.headline } : null }) });
      pendingProposal = body.proposal || null;
      if (ship && findShip(ship)) showFor({ ship });
      return { say: `${body.say}${pendingProposal ? ` ${pendingProposal.ask || "Shall I?"}` : ""}`, skill: body.skill, proposal: pendingProposal };
    } finally {
      clearInterval(ticker);
      setState("listening");
    }
  }

  // ── Dispatch ────────────────────────────────────────────────────────────
  function runTool(ev) {
    Promise.resolve()
      .then(() => (ev.name === "captain_said" ? captainSaid(ev.arguments || {}) : { error: `Unknown tool ${ev.name}.` }))
      .catch((err) => ({ error: String(err.message || err), say: `I hit a problem: ${String(err.message || err)}. Say that again, or ask for the brief.` }))
      // Sent the moment the tool returns; measured 2026-09-03 the server accepts it during the reply and answers ~2.3 s sooner.
      .then((result) => send({ type: "tool.result", call_id: ev.call_id, result: JSON.stringify(result), is_error: Boolean(result && result.error) }));
  }
  async function captainSaid({ text }) {
    const fresh = Date.now() - lastUserAt < 15000 && lastUserText;
    if (pendingSay && !fresh) { const say = pendingSay; pendingSay = ""; return { say }; }
    const words = fresh ? lastUserText : String(text || "");
    const r = globalThis.officerRoute(words);
    if (!agenda && r.intent !== "open") { try { await loadAgenda(); } catch {} }
    switch (r.intent) {
      case "open": await openWatch(); return { say: "" };
      case "why": return TOOLS.why();
      case "next": return TOOLS.next_item();
      case "brief": return TOOLS.brief();
      case "decide":
        if (pendingProposal && r.decision === "approve") return acceptProposal();
        if (pendingProposal && r.decision === "reject") { pendingProposal = null; return { say: `Understood. ${item() ? `We are on: ${line(item())}` : ""}` }; }
        return TOOLS.decide({ decision: r.decision, note: words });
      case "open_ship": { const f = TOOLS.open_ship({ ship: r.ship }); return f.error ? { say: f.error } : { ...f, say: shipLine(f) }; }
      case "read": { const f = TOOLS.read_commander({ ship: r.ship }); return f.error ? { say: f.error } : { ...f, say: readLine(f) }; }
      case "navigate": { const f = TOOLS.navigate({ target: r.target }); return { ...f, say: f.error || f.done }; }
      default: return askOfficer(words);
    }
  }
  async function acceptProposal() {
    const p = pendingProposal; pendingProposal = null;
    const body = await api("/ask", { method: "POST", body: JSON.stringify({ accept: p }) });
    return { say: body.say || `Logged: ${p.title}.`, proposal: p };
  }
  const shipLine = (f) => `${f.ship}, rank ${f.position.replace("#", "")}, ${f.stage}${f.visitors ? `, ${f.visitors} visitors` : ""}${f.constraint ? `, constraint ${f.constraint}` : ""}. ${f.read_line}`;
  const readLine = (f) => `${f.ship}: ${f.read_line} ${f.last_read ? `Last read ${f.last_read.date}: ${f.last_read.verdict}. ${f.last_read.pragmatic}` : "No recorded read yet."}`;

  // ── Cockpit tools (the page's own functions + what is already in the DOM) ───
  const ships = () => Array.from(document.querySelectorAll(".ship"));
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function findShip(spoken) {
    const q = norm(spoken);
    if (!q) return null;
    return ships().find((s) => norm(s.dataset.app) === q || norm(s.dataset.app).replace(/ /g, "") === q.replace(/ /g, "")) || null;
  }
  const text = (root, sel) => { const el = root && root.querySelector(sel); return el ? el.textContent.trim() : ""; };
  const stat = (root, label) => {
    const el = root && Array.from(root.querySelectorAll("span")).find((s) => s.querySelector("strong") && s.textContent.replace(/\s+/g, " ").toLowerCase().includes(label.toLowerCase()));
    return el ? text(el, "strong") : "";
  };
  function shipFacts(ship) {
    const app = ship.dataset.app;
    const modal = ship.querySelector(".ship-modal");
    const panel = modal && modal.querySelector(".traffic-panel");
    const reads = JSON.parse((document.getElementById("bridge-reads") || {}).textContent || "{}");
    return {
      ship: app, position: text(ship, ".rank"), stage: text(ship, ".stage"), naval_rank: text(panel, ".naval-rank"),
      rank_score: stat(panel, "Rank score") || ship.dataset.scoreRank, constraint: stat(panel, "Constraint"), confidence: stat(panel, "Confidence"),
      read_line: text(panel, ":scope > p") || text(ship, ".ship-move"), visitors: stat(panel, "visitors"), conversions: stat(panel, "conversions"),
      attention: text(ship, ".why-chip") || "none flagged", next_step: text(modal, ".next-step"), last_read: reads[app] || null,
    };
  }
  function closeModals() { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); }
  function showFleet() {
    closeModals();
    window.bridge.exitFocusMode();
    const filter = document.querySelector("#fleet-filter");
    if (filter) { filter.value = "all"; filter.dispatchEvent(new Event("change", { bubbles: true })); }
    const picker = document.querySelector("#project-picker");
    if (picker && picker.value) { picker.value = ""; picker.dispatchEvent(new Event("input", { bubbles: true })); }
  }
  const visible = (el) => el.offsetParent !== null || el.getBoundingClientRect().width > 0;
  const label = (el) => { const name = el.querySelector(".ship-name"); return norm(el.getAttribute("aria-label") || (name ? name.textContent : el.textContent)).slice(0, 60); };
  const controls = () => Array.from(document.querySelectorAll("button, a[href], summary, [role='button']")).filter((el) => !dock.contains(el) && visible(el) && label(el));
  function describeState() {
    const dialog = document.querySelector("dialog[open]");
    return { open_dialog: dialog ? (dialog.id === "command-palette" ? "command palette" : dialog.id.replace("modal-", "")) : null, focus_mode: document.body.classList.contains("focus-mode"), sort: window.bridge.activeSortMode() };
  }

  const TOOLS = {
    async why() {
      const it = item();
      if (!it) return { say: "The agenda is clear; there is nothing to explain." };
      showFor(it.ui);
      return { item: spoken(it), why: it.why, say: `${it.why.length ? it.why.join(" ") : "No evidence is attached to this item."} ${ask(it)}` };
    },
    async decide({ decision, note } = {}) {
      const it = item();
      if (!it) return { say: "There is no item to decide on. Ask me for the brief." };
      const body = await api("/decide", { method: "POST", body: JSON.stringify({ key: it.key, decision, note: note || "" }) });
      agenda.items = agenda.items.filter((i) => i.key !== it.key);
      current = Math.min(current, Math.max(0, agenda.items.length - 1));
      const next = item();
      if (next) showFor(next.ui);
      return { decided: it.headline, decision: body.decision, done: body.done, job: body.job, next: spoken(next), remaining: agenda.items.length,
               say: `${body.done} ${next ? `Next: ${line(next)}` : "That was the last item. The agenda is clear."}` };
    },
    async next_item() {
      if (!agenda || !agenda.items.length) return { next: null, say: "The agenda is clear." };
      current = (current + 1) % agenda.items.length;
      const it = item();
      showFor(it.ui);
      return { next: spoken(it), remaining: agenda.items.length, say: `Next: ${line(it)}` };
    },
    async brief() {
      if (!agenda) return { say: "I have no agenda loaded. Say 'start over'." };
      const counts = {};
      agenda.items.forEach((i) => { counts[i.kind] = (counts[i.kind] || 0) + 1; });
      const fleet = TOOLS.read_commander({});
      const kinds = Object.entries(counts).map(([k, n]) => `${n} ${k}${n === 1 ? "" : "s"}`).join(", ");
      return { total: agenda.items.length, by_kind: counts, top: agenda.items.slice(0, 3).map(spoken), current: spoken(item()),
               say: `${agenda.items.length} items: ${kinds}. Fleet: ${fleet.visitors || "no"} visitors, ${fleet.conversions || "no"} conversions. ${item() ? `We are on: ${line(item())}` : ""}` };
    },
    open_ship({ ship }) {
      const card = findShip(ship);
      if (!card) return { error: `No ship called '${ship}'. Ships: ${ships().map((s) => s.dataset.app).join(", ")}.` };
      showFleet();
      document.body.classList.add("focus-mode");
      window.bridge.focusShip(window.bridge.visibleShips().indexOf(card));
      window.bridge.openShip(card);
      return shipFacts(card);
    },
    sort_fleet({ by }) {
      const mode = ["rank", "priority", "revenue", "traffic", "urgency", "backlog"].includes(by) ? by : "rank";
      showFleet();
      const btn = document.querySelector(`.sort-mode[data-sort-mode="${mode}"]`);
      if (btn) btn.click();
      const order = window.bridge.visibleShips().map((s) => ({ ship: s.dataset.app, score: Number(s.dataset[`score${mode[0].toUpperCase()}${mode.slice(1)}`] || 0), stage: text(s, ".stage") }));
      return { by: mode, order, top3: order.slice(0, 3).map((o) => o.ship), say: `By ${mode}: ${order.slice(0, 3).map((o) => o.ship).join(", ")}.` };
    },
    read_commander({ ship } = {}) {
      if (ship) {
        const card = findShip(ship);
        if (!card) return { error: `No ship called '${ship}'. Ships: ${ships().map((s) => s.dataset.app).join(", ")}.` };
        return TOOLS.open_ship({ ship: card.dataset.app });
      }
      const radar = document.querySelector(".traffic-radar");
      return { scope: "fleet", summary: text(radar, ".radar-head span"), visitors: stat(radar, "visitors"), conversions: stat(radar, "conversions"),
               ships: ships().map((s) => { const f = shipFacts(s); return { ship: f.ship, stage: f.stage, constraint: f.constraint, read_line: f.read_line }; }) };
    },
    navigate({ target }) {
      const q = norm(target);
      if (!q) return { error: "Say what to open, click or close." };
      if (/^(close|back|escape|exit|go back|dismiss)\b/.test(q)) { window.bridge.closeCommandPalette(); closeModals(); window.bridge.exitFocusMode(); return { done: "Closed.", ...describeState() }; }
      if (/\b(command|palette|shortcut)/.test(q) || q.startsWith("search")) {
        const query = q.replace(/^(open |show )?(the )?(command palette|commands?|palette|shortcuts?|search( for)?)\s*/g, "").trim();
        window.bridge.openCommandPalette(query);
        const results = Array.from(document.querySelectorAll("#fleet-search-results li, #fleet-search-results button")).slice(0, 5).map((el) => el.textContent.trim().replace(/\s+/g, " ")).filter(Boolean);
        return { done: query ? `Searching ${query}. ${results.length ? `Top result: ${results[0]}.` : ""}` : "Command palette open.", results, ...describeState() };
      }
      const words = q.split(" ").filter((w) => !["the", "a", "click", "press", "open", "expand", "show", "button", "on", "tap", "section"].includes(w));
      const wanted = words.join(" ");
      let best = null, bestScore = 0;
      for (const el of controls()) {
        const l = label(el);
        const score = l === wanted ? 100 : (l.includes(wanted) || wanted.includes(l)) ? 60 + Math.min(l.length, wanted.length) : words.filter((w) => l.includes(w)).length * 10;
        if (score > bestScore) { best = el; bestScore = score; }
      }
      if (!best || bestScore < 10) return { error: `I can't see a control called '${target}'. I can see: ${[...new Set(controls().map(label))].slice(0, 8).join(", ")}.` };
      best.scrollIntoView({ block: "center", behavior: "smooth" });
      best.click();
      return { done: `Opened ${label(best)}.`, ...describeState() };
    },
  };
  window.voiceTools = { ...TOOLS, route: (t) => captainSaid({ text: t }), loadAgenda }; // console: voiceTools.route("why?")
})();
