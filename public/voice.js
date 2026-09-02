// Bridge Voice — the voice island over the frozen Bridge snapshot.
// One WebSocket to AssemblyAI's Voice Agent API: STT + LLM + TTS + turn detection + tool calls.
// Tools drive the page's own functions (window.bridge) and read the data already in the DOM.
(() => {
  const WS_URL = "wss://agents.assemblyai.com/v1/ws";
  const TOKEN_URL = "/api/voice-token";
  const SAMPLE_RATE = 24000;
  const IDLE_MS = 120000; // no speech for 2 minutes → end the session (there is no free tier)
  const SHIP_ALIASES = {
    "hyper-cv": ["hypercv", "hyper cv", "next role", "nextrole", "cv"],
    "web3-capital": ["web3", "web 3", "web3 capital", "crypto"],
    "mcp-maker": ["mcp", "mcp maker", "maker"],
    revela: ["revela", "reveal", "revella"],
    intel: ["intel", "intelligence"],
  };

  // Tune here for the turn-fire moment. Adaptive pacing is the documented default; if it
  // never feels instant for two-word commands, set input.turn_detection.min_silence (ms).
  const SESSION = {
    system_prompt: [
      "You are the voice of the Hyperdrift Bridge, a cockpit for a small fleet of live apps.",
      "The captain speaks; you move the cockpit with a tool and say, in one short sentence, what you see.",
      "When in doubt, call a tool. A wasted call is fine. Answering from memory is not. Never invent a number.",
      "Speak numbers plainly. Keep replies under twenty words unless reading a verdict.",
      "Ships: revela, hyper-cv, intel, web3-capital, mcp-maker.",
      "Tone: calm, direct, on the captain's side. Name what is strong first, then the next step. Never blame.",
      "Examples:",
      "User: show me intel. You: [call open_ship ship=intel] Intel, rank one, rigged, thirteen visitors.",
      "User: how is web3 capital doing? You: [call open_ship ship=web3-capital] Web3-capital, rank four, rigged, one visitor.",
      "User: rank by traffic. You: [call sort_fleet by=traffic] By traffic: intel, hyper-cv, web3-capital.",
      "User: what needs attention? You: [call sort_fleet by=urgency] Most urgent: intel, then revela.",
      "User: back to the fleet. You: [call sort_fleet by=rank] Fleet view.",
      "User: what's the read on hyper-cv? You: [call read_commander ship=hyper-cv] Constraint trust, rigged. Last read July eighth: needs more traffic; verify the save handoff before spending.",
      "User: what should I do next? You: [call read_commander] Fleet read: seventeen visitors, no conversions; every ship needs a clean read first.",
    ].join(" "),
    greeting: "Bridge is live. Which ship?",
    input: {
      transcription_mode: "min_latency",
      // Explicit windows switch off adaptive pacing; measured 2026-09-03 they cut transcript→tool.call from ~2.1 s to ~1.2 s for two-word commands.
      turn_detection: { min_silence: 200, max_silence: 500 }, // 100/300 measured 0.2 s faster still, at the cost of clipping natural pauses
      keyterms: ["revela", "hyper-cv", "intel", "web3-capital", "mcp-maker", "Commander", "rank"],
    },
    output: { voice: "anna" },
    tools: [
      {
        type: "function",
        name: "open_ship",
        description: "Call this when the captain names one ship and wants to see it or know how it is doing. Do not call this for rankings or for the whole fleet. Puts the ship on screen and returns its position, stage, naval rank, constraint, confidence, visitors, conversions and next step.",
        parameters: {
          type: "object",
          properties: { ship: { type: "string", description: "The ship name the captain said" } },
          required: ["ship"],
        },
        execution_mode: "interactive",
        timeout_seconds: 10,
      },
      {
        type: "function",
        name: "sort_fleet",
        description: "Call this when the captain asks to rank, sort or compare the fleet, asks what needs attention, or wants to go back to the fleet. Do not call this when a single ship is named. Re-orders all ships and returns the ordered list.",
        parameters: {
          type: "object",
          properties: {
            by: { type: "string", enum: ["rank", "priority", "revenue", "traffic", "urgency", "backlog"], description: "The metric the captain asked for; urgency when they ask what needs attention; rank for the default order" },
          },
          required: ["by"],
        },
        execution_mode: "interactive",
        timeout_seconds: 10,
      },
      {
        type: "function",
        name: "read_commander",
        description: "Call this when the captain asks for the read, the verdict, the Commander's view, or what to do next. Do not call this just to look at a ship. Returns constraint, confidence, stage and the last recorded read with its pragmatic call, for one ship or the fleet.",
        parameters: {
          type: "object",
          properties: { ship: { type: "string", description: "The ship name the captain said; omit for the fleet" } },
        },
        execution_mode: "interactive",
        timeout_seconds: 10,
      },
    ],
  };

  // ── UI ──────────────────────────────────────────────────────────────────
  const dock = document.createElement("aside");
  dock.id = "voice";
  dock.setAttribute("aria-label", "Voice");
  dock.dataset.state = "idle";
  dock.innerHTML = `
    <button type="button">Talk to the Bridge</button>
    <output aria-live="polite"></output>
    <p>Try: <q>show me revela</q> · <q>rank by traffic</q> · <q>what's the read on intel</q></p>`;
  document.body.append(dock);
  const button = dock.querySelector("button");
  const out = dock.querySelector("output");
  const setState = (state, text) => {
    dock.dataset.state = state;
    button.textContent = { idle: "Talk to the Bridge", connecting: "Connecting…", listening: "Listening — tap to end", speaking: "Speaking — tap to end", ended: "Session ended — tap to restart", error: "Tap to retry" }[state];
    if (text !== undefined) out.textContent = text;
  };

  // ── Session ─────────────────────────────────────────────────────────────
  let ws = null;
  let ctx = null;
  let mic = null;
  let worklet = null;
  let playhead = 0;
  let playing = [];
  let idleTimer = null;

  const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const touchIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => end("Session ended after two quiet minutes."), IDLE_MS); };

  async function start() {
    setState("connecting", "");
    try {
      const token = await fetch(TOKEN_URL, { method: "POST" }).then((r) => { if (!r.ok) throw new Error(`token ${r.status}`); return r.json(); }).then((j) => j.token);
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      await ctx.audioWorklet.addModule("voice-worklet.js");
      worklet = new AudioWorkletNode(ctx, "pcm-processor", { processorOptions: { inputSampleRate: ctx.sampleRate, targetSampleRate: SAMPLE_RATE } });
      ctx.createMediaStreamSource(mic).connect(worklet);
      let ready = false;
      worklet.port.onmessage = ({ data }) => { if (ready) send({ type: "input.audio", audio: b64(data) }); };

      const url = new URL(WS_URL);
      url.searchParams.set("token", token);
      ws = new WebSocket(url);
      ws.onopen = () => send({ type: "session.update", session: SESSION });
      ws.onclose = (e) => { if (dock.dataset.state !== "ended") teardown(e.code === 1006 ? "Connection refused — token expired or invalid." : "Connection closed."); };
      ws.onerror = () => teardown("Connection error.");
      ws.onmessage = ({ data }) => {
        const ev = JSON.parse(data);
        switch (ev.type) {
          case "session.ready": ready = true; playhead = 0; setState("listening", ""); touchIdle(); break;
          case "input.speech.started": touchIdle(); setState("listening"); break;
          case "transcript.user.delta": out.textContent = ev.text; break;
          case "transcript.user": out.textContent = ev.text; break;
          case "reply.started": setState("speaking"); break;
          case "reply.audio": play(ev.data); break;
          case "transcript.agent": out.textContent = ev.text; break;
          case "reply.done": if (ev.status === "interrupted") flush(); setState("listening"); break;
          case "tool.call": runTool(ev); break;
          case "session.error": console.error("session.error", ev); if (!ready) teardown(`${ev.code}: ${ev.message}`); else out.textContent = ev.message; break;
          case "session.ended": teardown("Session ended.", "ended"); break;
        }
      };
    } catch (err) {
      console.error(err);
      teardown(err.name === "NotAllowedError" ? "Microphone access is needed to talk to the Bridge." : String(err.message || err));
    }
  }

  function end(text) {
    send({ type: "session.end" }); // stops billing now instead of after the 30 s resume window
    teardown(text || "Session ended.", "ended");
  }

  function teardown(text, state = "error") {
    clearTimeout(idleTimer);
    flush();
    if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
    if (mic) { mic.getTracks().forEach((t) => t.stop()); mic = null; }
    if (ctx) { ctx.close(); ctx = null; }
    setState(state, text);
  }

  button.addEventListener("click", () => (ws ? end() : start()));
  document.addEventListener("visibilitychange", () => { if (document.hidden && ws) end("Session ended while the tab was hidden."); });
  window.addEventListener("pagehide", () => { if (ws) end(); });

  // ── Audio ───────────────────────────────────────────────────────────────
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

  // ── Tools ───────────────────────────────────────────────────────────────
  function runTool(ev) {
    let result;
    try {
      result = TOOLS[ev.name] ? TOOLS[ev.name](ev.arguments || {}) : { error: `Unknown tool ${ev.name}. Tools: open_ship, sort_fleet, read_commander.` };
    } catch (err) {
      result = { error: String(err.message || err) };
    }
    // Sent the moment the tool returns. The docs say to wait for reply.done; measured 2026-09-03 the server
    // accepts it during the filler reply and starts the answer ~2.3 s sooner.
    send({ type: "tool.result", call_id: ev.call_id, result: JSON.stringify(result), is_error: Boolean(result && result.error) });
  }

  const ships = () => Array.from(document.querySelectorAll(".ship"));
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function findShip(spoken) {
    const q = norm(spoken);
    if (!q) return null;
    const all = ships();
    const byName = all.find((s) => norm(s.dataset.app) === q || norm(s.dataset.app).replace(/ /g, "") === q.replace(/ /g, ""));
    if (byName) return byName;
    for (const s of all) {
      const aliases = [s.dataset.app, ...(SHIP_ALIASES[s.dataset.app] || [])].map(norm);
      if (aliases.some((a) => a === q || q.includes(a) || a.includes(q))) return s;
    }
    return null;
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
      ship: app,
      position: text(ship, ".rank"),
      stage: text(ship, ".stage"),
      naval_rank: text(panel, ".naval-rank"),
      rank_score: stat(panel, "Rank score") || ship.dataset.scoreRank,
      constraint: stat(panel, "Constraint"),
      confidence: stat(panel, "Confidence"),
      read_line: text(panel, ":scope > p") || text(ship, ".ship-move"),
      visitors: stat(panel, "visitors"),
      conversions: stat(panel, "conversions"),
      attention: text(ship, ".why-chip") || "none flagged",
      next_step: text(modal, ".next-step"),
      last_read: reads[app] || null,
    };
  }
  function closeModals() {
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  }
  function showFleet() {
    closeModals();
    window.bridge.exitFocusMode();
    const filter = document.querySelector("#fleet-filter");
    if (filter) { filter.value = "all"; filter.dispatchEvent(new Event("change", { bubbles: true })); }
    const picker = document.querySelector("#project-picker");
    if (picker && picker.value) { picker.value = ""; picker.dispatchEvent(new Event("input", { bubbles: true })); }
  }

  const TOOLS = {
    open_ship({ ship }) {
      const card = findShip(ship);
      if (!card) return { error: `No ship called '${ship}'. Ships: ${ships().map((s) => s.dataset.app).join(", ")}. Ask the captain which one.` };
      showFleet();
      document.body.classList.add("focus-mode");
      const index = window.bridge.visibleShips().indexOf(card);
      window.bridge.focusShip(index);
      window.bridge.openShip(card);
      return shipFacts(card);
    },
    sort_fleet({ by }) {
      const mode = ["rank", "priority", "revenue", "traffic", "urgency", "backlog"].includes(by) ? by : "rank";
      showFleet();
      const btn = document.querySelector(`.sort-mode[data-sort-mode="${mode}"]`);
      if (btn) btn.click();
      const order = window.bridge.visibleShips().map((s) => ({ ship: s.dataset.app, score: Number(s.dataset[`score${mode[0].toUpperCase()}${mode.slice(1)}`] || 0), stage: text(s, ".stage"), attention: text(s, ".why-chip") }));
      return { by: mode, order, top3: order.slice(0, 3).map((o) => o.ship) };
    },
    read_commander({ ship } = {}) {
      if (ship) {
        const card = findShip(ship);
        if (!card) return { error: `No ship called '${ship}'. Ships: ${ships().map((s) => s.dataset.app).join(", ")}.` };
        const facts = TOOLS.open_ship({ ship: card.dataset.app });
        return { ...facts, how_to_read: "Verdict first (constraint + stage), then the pragmatic call from last_read if present, dated. Under forty words." };
      }
      showFleet();
      const radar = document.querySelector(".traffic-radar");
      return {
        scope: "fleet",
        summary: text(radar, ".radar-head span"),
        visitors: stat(radar, "visitors"),
        conversions: stat(radar, "conversions"),
        best_mover: stat(radar, "best mover"),
        watch: stat(radar, "watch"),
        ships: ships().map((s) => { const f = shipFacts(s); return { ship: f.ship, stage: f.stage, constraint: f.constraint, read_line: f.read_line }; }),
      };
    },
  };
  window.voiceTools = TOOLS; // handy in the console: voiceTools.open_ship({ ship: 'revela' })
})();
