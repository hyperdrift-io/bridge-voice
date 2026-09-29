// Bridge Voice — the First Officer: a voice that reports to the captain over the Bridge.
// The AssemblyAI Voice Agent API hosts the conversation (turn-taking, barge-in, speaking first, TTS).
// The fleet does the thinking: /api/voice/agenda (what to decide, with the why), /api/voice/decide,
// /api/voice/ask (a question routed to the right fleet skill), /api/voice/interrupts (spoken unprompted).
// Three ways to hold the conversation, fastest first; the island takes the first one the host offers:
//   ear      AssemblyAI's streaming model (Universal-3.6 Pro Realtime) hears; the island decides the line; the voice speaks it
//   agent    the voice agent hears and asks the officer-as-LLM endpoint (api/voice/llm.js) for every line; the island mirrors
//   managed  the voice agent's own model carries every utterance to one tool and reads back the line it returns
// router.js and watch.js decide what was meant, deterministically, in all three. Cockpit tools drive the page's own
// functions (window.bridge).
(() => {
  const WS_URL = "wss://agents.assemblyai.com/v1/ws";
  const API = "/api/voice";
  const SAMPLE_RATE = 24000;
  const IDLE_MS = 120000; // no speech for 2 minutes → end the session (there is no free tier)
  const INTERRUPT_EVERY_MS = 20000;
  const AGENT_PROMPT = "You are the First Officer of the Hyperdrift Bridge. You report to the captain. Short sentences. Every line ends on a question.";
  const ORDER_PATIENCE_MS = 40000; // how long an order may take before the officer says it has not landed
  const THINKING_LINES = [
    "Give me a moment; I am reading the signals.",
    "Still on it. I want to give you a straight answer, not a fast one.",
    "Nearly there.",
  ];
  const TEXT_ONLY = location.hash === "#text";

  const SESSION = {
    system_prompt: [
      "You are the First Officer of the Hyperdrift Bridge. You report to the captain, who runs a small fleet of live apps.",
      "For everything the captain says, call captain_said with their words, exactly once per thing they say, then say the result's 'say' text word for word and nothing else.",
      "Once captain_said has returned, never call it again until the captain speaks again. Just read the 'say' text.",
      "Never repeat a line you have already said, and never answer from memory. If you cannot call captain_said, say only: Say that again, Captain?",
      "If the result has no 'say' but has 'context', answer from the context in two short sentences, opinion first.",
      "When an instruction tells you to say something exactly, say exactly that.",
      "Never speak a tool name, its arguments, brackets or code. Only the 'say' text.",
      "Never invent a number, a deadline, an option or a reason. Short sentences. Numbers said plainly.",
      "Strengths first; a gap is a next step, never a fault. You never talk down to the captain.",
    ].join(" "),
    input: {
      transcription_mode: "min_latency",
      // Measured 2026-09-03: ~1 s faster than adaptive for short commands. Re-measured 2026-09-18 over six spaced spoken turns:
      // this setting answered in 1.6–2.1 s; the docs' default (adaptive, balanced) answered in 3.6–4.6 s. Keep it.
      turn_detection: { min_silence: 200, max_silence: 500 },
      // Ship names, plus the short command words min_latency mishears most ("menu" came back as "Many" on 4 of 6 turns).
      keyterms: ["revela", "hyper-cv", "intel", "web3-capital", "mcp-maker", "Commander", "First Officer", "menu", "park it", "go for it", "the fixes", "the reads", "hackathon"],
    },
    output: { voice: "anna" },
    tools: [
      {
        type: "function",
        name: "captain_said",
        description: "Call this once for each thing the captain says, passing their words verbatim. Never answer without calling it; never call it twice for the same words. Returns 'say', the exact line to speak.",
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
    <meter min="0" max="1" value="0" aria-label="Microphone level"></meter>
    <small aria-live="polite"></small>
    <output aria-live="polite"></output>
    <form><input name="say" autocomplete="off" placeholder="…or type to the officer" aria-label="Type to the officer"></form>
    <p>The officer opens with what matters. <q>why?</q> · <q>do it</q> · <q>next</q> · <q>the brief</q> · <q>show me intel</q> · or ask anything.</p>`;
  document.body.append(dock);
  // The screen follows the conversation: what is on the table is shown, the ships being discussed are marked, and the
  // choices are buttons that go through the very same conversation as the spoken words.
  const cockpit = globalThis.officerCockpit.create({ dock, bridge: window.bridge, showFleet: () => showFleet(), onChoice: (words) => typed(words) });
  const button = dock.querySelector("button");
  const out = dock.querySelector("output");
  const meter = dock.querySelector("meter");
  const micLine = dock.querySelector("small");
  // Mic health, always in view: listening · hearing · heard · silent · unheard · stalled · blocked (mic.js decides which).
  const showMic = ({ state, text, level }) => { dock.dataset.mic = state; meter.value = level; if (micLine.textContent !== text) micLine.textContent = text; };
  dock.dataset.mic = "off";
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
  let watch = null; // the conversation (watch.js)
  let ear = null; // the streaming ear (ear.js); while it is open the island hears and decides, and the voice only speaks
  let queue = []; // ear mode: the officer's lines not yet handed to the voice
  let inFlight = false; // ear mode: a line is with the voice (asked for, not yet done)
  let ready = false; // the voice session is up
  let volume = null; // master gain: the officer lowers its voice the moment the captain starts, before a word is recognised
  let carrying = false; // an order is with Helm; its report is the officer's next unprompted line
  let ordered = { ship: "", at: 0 }; // the last order carried out from this watch: Helm's own record of it is not news to the captain
  let agentId = null; // set when the host binds us to the stored agent whose model is the officer itself (api/voice/llm.js)
  let mirrorAsked = false, lastAgentLine = "", mirrored = ""; // mirrored: the line the endpoint is about to say, as the island worked it out too (takes caption from it) // own-LLM mode: the island only mirrors the conversation so the cockpit can follow
  let closing = false; // true once the captain said goodbye, "said" once the farewell was spoken; then the session ends
  let userSpeaking = false;
  let lastUserText = "";
  let lastUserAt = 0;
  let interruptTimer = null;
  let interruptsSince = "";
  let pendingProposal = null;
  let turn = 0; // one per captain utterance, spoken or typed
  let answered = { turn: -1, result: null }; // the default model sometimes calls the tool twice for one utterance (seen 2026-09-17); the second call gets the same answer and acts on nothing
  let pendingTurn = 0; // the captain's turn count when the proactive line was issued
  let pendingSay = ""; // a proactive line; if the model routes it through the tool instead of saying it, the tool hands it back

  const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const sayExactly = (text) => {
    if (ear) { speak(text); return; }
    if (agentId) { mirrored = text; inFlight = true; send({ type: "reply.create", instructions: `OFFICER_SAY ${text}` }); return; } // the instructions reach the endpoint as the last system message (measured 2026-09-29)
    pendingSay = text; pendingTurn = turn; send({ type: "reply.create", instructions: `Say exactly: "${text.replace(/"/g, "'")}"` });
  };
  const touchIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => end("Watch ended after two quiet minutes."), IDLE_MS); };

  async function start() {
    setState("connecting", "");
    try {
      const grant = await fetch(`${API}/token`, { method: "POST" }).then((r) => { if (!r.ok) throw new Error(`token ${r.status}`); return r.json(); });
      agentId = TEXT_ONLY ? null : grant.agent_id || null; // typed turns are injected messages, which a custom model is not handed (2026-09-24): typing stays on the managed session
      ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      volume = ctx.createGain(); volume.connect(ctx.destination);
      const hearing = agentId && grant.ear && !location.hash.startsWith("#ear=off") ? globalThis.officerEar.open({ ...grant.ear, rate: SAMPLE_RATE, keyterms: SESSION.input.keyterms, onSpeech: captainStarted, onWords: captainWords, onTurn: captainTurn, onLost: () => { if (ctx) end("The ear dropped. Reopen the watch."); } }) : null;
      if (!TEXT_ONLY) mic = await globalThis.officerMic.open({ ctx, rate: SAMPLE_RATE, onHealth: showMic, onChunk: (pcm) => { if (ear) ear.send(pcm); else if (ready) send({ type: "input.audio", audio: b64(pcm) }); } });
      ear = await hearing;
      dock.dataset.ear = ear ? ear.model : "";
      connect(grant.token, () => { playhead = 0; setState("listening", ""); touchIdle(); openWatch(); });
    } catch (err) {
      console.error(err);
      teardown(String(err.message || err));
    }
  }
  // The voice session. Events from a socket that is no longer ours (hung up on, see redial) are ignored.
  function connect(token, onReady) {
    const url = new URL(WS_URL);
    url.searchParams.set("token", token);
    const socket = new WebSocket(url);
    ws = socket; ready = false;
    socket.onopen = () => send({ type: "session.update", session: agentId ? { agent_id: agentId } : SESSION });
    socket.onclose = (e) => { if (socket === ws && dock.dataset.state !== "ended") teardown(e.code === 1006 ? "Connection refused — token expired or invalid." : "Connection closed."); };
    socket.onerror = () => { if (socket === ws) teardown("Connection error."); };
    socket.onmessage = ({ data }) => {
      if (socket !== ws) return;
      const ev = JSON.parse(data);
      switch (ev.type) {
        case "session.ready": ready = true; onReady(); break;
        case "input.speech.started": userSpeaking = true; if (mic) mic.note("speech"); touchIdle(); setState("listening"); break;
        case "input.speech.stopped": userSpeaking = false; watchLostWords(turn); break;
        case "transcript.user.delta": out.textContent = ev.text; break;
        case "transcript.user": userSpeaking = false; turn += 1; lastUserText = ev.text; lastUserAt = Date.now(); if (mic) mic.note("heard", ev.text); out.textContent = ev.text; if (agentId) answer(ev.text, { mirror: true }).catch(() => {}); break;
        case "reply.started": if (mic) mic.note("officer", true); if (dock.dataset.state !== "thinking") setState("speaking"); break;
        case "reply.audio": play(ev.data); break;
        case "transcript.agent": if (!ear) out.textContent = ev.text; lastAgentLine = ev.text; if (closing && /fair winds/i.test(ev.text)) closing = "said"; break; // the farewell has been spoken: the next reply.done ends the session
        case "reply.done": inFlight = false; if (ear && queue.length && closing !== "said") { sayNext(); break; } if (mic) mic.note("officer", false); pendingSay = ""; if (closing === "said") { closing = false; setTimeout(() => end("Watch closed. Fair winds."), ctx ? Math.max(0, playhead - ctx.currentTime) * 1000 + 400 : 400); break; } if (ev.status === "interrupted") flush(); if (dock.dataset.state !== "thinking") setState("listening"); break;
        case "tool.call": runTool(ev); break;
        case "session.error": console.error("session.error", ev); if (!ready) teardown(`${ev.code}: ${ev.message}`); else out.textContent = ev.message; break;
        case "session.ended": teardown("Watch ended.", "ended"); break;
      }
    };
  }
  function end(text) {
    send({ type: "session.end" }); // stops billing now instead of after the 30 s resume window
    teardown(text || "Watch ended.", "ended");
  }
  function teardown(text, state = "error") {
    clearTimeout(idleTimer);
    clearInterval(interruptTimer);
    flush();
    queue = []; inFlight = false; carrying = false; ready = false;
    if (ear) { ear.close(); ear = null; }
    if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
    if (mic) { mic.close(); mic = null; }
    showMic({ state: "off", text: "", level: 0 });
    if (ctx) { ctx.close(); ctx = null; }
    setState(state, text);
    cockpit.clear();
  }
  button.addEventListener("click", () => (ctx ? end() : start()));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    if (!ctx) { start().then(() => typed(text)); return; }
    typed(text);
  });
  function typed(text) {
    const go = () => {
      if (!ws || ws.readyState !== 1 || dock.dataset.state === "connecting") { setTimeout(go, 500); return; }
      if (ear) { captainTurn(text); return; } // the island decides: typed words take the same road as spoken ones
      turn += 1; lastUserText = text; lastUserAt = Date.now(); out.textContent = text; touchIdle();
      send({ type: "conversation.message", role: "user", content: text });
      send({ type: "reply.create", instructions: `The captain just said: "${text.replace(/"/g, "'")}". Handle it with your tool as usual, then read the 'say' text aloud word for word.` });
    };
    go();
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden && ctx) end("Watch ended while the tab was hidden."); });
  window.addEventListener("pagehide", () => { if (ctx) end(); });

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
    src.connect(volume);
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

  // ── Ear mode: the island hears, decides, and tells the voice what to say ──
  // Measured 2026-09-29: the ear calls the turn 0.39–0.49 s after the captain's voice stops, and the voice starts
  // 0.13–0.35 s after it is handed a line. The voice cannot be stopped once it has one (a reply.create queues behind the
  // reply in progress; there is no cancel), so when the captain speaks over the officer the island drops the audio at
  // once, hangs up on that voice session and dials a new one while the captain is still talking (redial).
  const officerTalking = () => inFlight || playing.length > 0;
  function speak(line) { queue.push(line); if (!inFlight) sayNext(); }
  function sayNext() {
    if (!ready || !queue.length) return;
    const line = queue.shift();
    inFlight = true; mirrored = line;
    if (volume) volume.gain.setTargetAtTime(1, ctx.currentTime, 0.02);
    send({ type: "reply.create", instructions: `OFFICER_SAY ${line}` });
  }
  async function redial() {
    const old = ws;
    ws = null; ready = false; inFlight = false; queue = [];
    try { old.send(JSON.stringify({ type: "session.end" })); old.close(); } catch {}
    try {
      const grant = await fetch(`${API}/token?voice=1`, { method: "POST" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`token ${r.status}`))));
      if (ctx) connect(grant.token, () => { if (dock.dataset.state === "connecting") setState("listening"); sayNext(); });
    } catch (err) { teardown(String(err.message || err)); }
  }
  let duckTimer = 0;
  function captainStarted() {
    userSpeaking = true; if (mic) mic.note("speech"); touchIdle();
    if (!officerTalking() || !volume) return;
    volume.gain.setTargetAtTime(0.25, ctx.currentTime, 0.03); // lower the voice at the first sound; a recognised word stops it
    clearTimeout(duckTimer); duckTimer = setTimeout(() => { if (volume && ctx) volume.gain.setTargetAtTime(1, ctx.currentTime, 0.1); }, 1200);
  }
  function captainWords(words) {
    if (!ctx) return;
    out.textContent = words;
    if (!officerTalking() || globalThis.officerEar.echoes(words, mirrored)) return;
    clearTimeout(duckTimer);
    flush(); volume.gain.setTargetAtTime(1, ctx.currentTime, 0.02);
    if (mic) mic.note("officer", false);
    document.dispatchEvent(new CustomEvent("officer:cut"));
    setState("listening");
    redial();
  }
  async function captainTurn(words) {
    if (!ctx || (officerTalking() && globalThis.officerEar.echoes(words, mirrored))) return;
    captainWords(words); // a turn so short that no partial came first still stops the officer
    userSpeaking = false; turn += 1; lastUserText = words; lastUserAt = Date.now(); touchIdle();
    if (mic) mic.note("heard", words);
    out.textContent = words;
    const t = turn;
    const result = await answer(words).then(forTheEar).catch((err) => ({ say: `I hit a problem: ${String(err.message || err)}. Would you say that again?` }));
    if (t !== turn || !ctx || !result.say) return; // the captain has spoken again meanwhile: this answer is stale
    speak(result.say);
  }

  // ── Orders: Helm carries them out, the officer checks the result and reports ──
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  async function carryOut({ ship, mode }) {
    const since = new Date(Date.now() - 2000).toISOString().replace(/\.\d+Z$/, "Z"), started = Date.now();
    const view = (headline, steps, options = []) => cockpit.show({ view: { kind: "order", label: ship, headline, lines: steps.map((s) => s.step), options, ships: [ship] } });
    let outcome = { ship, mode, ok: false, seconds: ORDER_PATIENCE_MS / 1000 }, steps = [];
    carrying = true;
    try {
      await api("/control", { method: "POST", body: JSON.stringify({ app: ship, mode }) });
      for (let good = 0; Date.now() - started < ORDER_PATIENCE_MS && ctx; ) {
        await sleep(700);
        const now = await api(`/control?app=${encodeURIComponent(ship)}&since=${encodeURIComponent(since)}`).catch(() => null);
        if (!now) continue;
        steps = now.steps.length ? now.steps : steps;
        cockpit.berth({ ship, http: now.http, ms: now.ms, working: true });
        view(mode === "online" ? "Helm is bringing it back online" : "Helm is taking it offline", steps);
        good = (mode === "online") === (now.http === 200) ? good + 1 : 0; // the ship itself, probed from outside: twice in a row or it does not count
        if (good >= 2) { outcome = { ship, mode, ok: true, checks: good, ms: mode === "online" ? now.ms : 0 }; cockpit.berth({ ship, http: now.http, ms: now.ms }); break; }
      }
    } catch (err) { outcome.error = String(err.message || err); }
    carrying = false; ordered = { ship, at: Date.now() };
    if (!ctx || !watch) return;
    const report = watch.report(outcome);
    while (ctx && userSpeaking) await sleep(200); // never over the captain
    if (!ctx) return;
    cockpit.show({ view: { ...report.view, lines: steps.map((s) => s.step) } });
    sayExactly(globalThis.officerForEar(report.say));
  }

  // ── The watch ───────────────────────────────────────────────────────────
  const api = (path, init) => fetch(`${API}${path}`, { headers: { "Content-Type": "application/json" }, ...init }).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error || `${path} ${r.status}`), { status: r.status, body });
    return body;
  });
  // The conversation lives in watch.js (pure, tested offline): the officer offers, the captain chooses, short turns.
  const OPEN_QUESTIONS = ["What next, Captain?", "Where to now?"];
  let openQuestion = 0;
  const asksSomething = (text) => /\?["”']?\s*$/.test(text);
  async function loadAgenda() {
    agenda = await api("/agenda");
    if (agenda.sandbox) cockpit.berth(agenda.sandbox);
    watch = globalThis.officerWatch.create(agenda, { decide: (key, decision, note) => api("/decide", { method: "POST", body: JSON.stringify({ key, decision, note }) }) });
    return agenda;
  }
  async function openWatch() {
    try { await loadAgenda(); } catch (err) { sayExactly(`Captain, I could not load the agenda: ${err.message}. Would you ask me about a ship instead?`); return; }
    interruptsSince = agenda.generated || new Date().toISOString();
    const opening = watch.open();
    cockpit.show(opening);
    mirrored = globalThis.officerForEar(opening.say);
    if (ear) speak(globalThis.officerForEar(opening.say));
    else if (agentId) { // the officer is the model: hand it what is live and the cockpit's facts with the session, then let it open the watch itself
      send({ type: "session.update", session: { system_prompt: `${AGENT_PROMPT}\nOFFICER_STATE ${JSON.stringify({ live: agenda.live || [], ships: ships().map(shipFacts), fleet: TOOLS.read_commander({}) })}\n` } });
      send({ type: "reply.create" });
    } else sayExactly(globalThis.officerForEar(opening.say));
    clearInterval(interruptTimer);
    interruptTimer = setInterval(pollInterrupts, INTERRUPT_EVERY_MS);
  }
  async function pollInterrupts() {
    if (!ws || userSpeaking || carrying || dock.dataset.state === "thinking") return;
    let body;
    try { body = await api(`/interrupts?since=${encodeURIComponent(interruptsSince)}`); } catch { return; }
    const all = body.interrupts || [];
    if (all.length) interruptsSince = all[all.length - 1].ts || body.now || interruptsSince;
    const fresh = all.filter((f) => !(f.kind === "control" && f.ship === ordered.ship && Date.now() - ordered.at < 120000));
    if (!fresh.length) return;
    if (userSpeaking) return; // the captain started talking meanwhile; it comes round again
    if (fresh[0].ship) showFor({ ship: fresh[0].ship });
    sayExactly(globalThis.officerForEar(`Captain, ${fresh.map((f) => f.say).join(" ")} Shall I act on it, or carry on?`));
  }
  function showFor(ui) {
    if (!ui) return;
    try {
      if (ui.ship && findShip(ui.ship)) { TOOLS.open_ship({ ship: ui.ship }); return; }
      if (!ui.panel) return;
      const target = document.getElementById(`${ui.panel}-title`) || document.querySelector(`[data-search-keywords*="${ui.panel}"]`) || document.getElementById(ui.panel);
      if (target) { showFleet(); target.scrollIntoView({ block: "start", behavior: "smooth" }); }
      // No such panel on this page (the judges' snapshot scrubs some): stay put. Guessing a control to click once left the page mid-watch.
    } catch { /* the cockpit following is best effort */ }
  }
  async function askOfficer(question) {
    setState("thinking");
    let n = 0;
    const ticker = setInterval(() => { if (n < THINKING_LINES.length) sayExactly(THINKING_LINES[n++]); }, 9000);
    try {
      const state = watch ? watch.state() : {};
      const ship = globalThis.officerShipWord(question) || "";
      const card = ship && findShip(ship);
      const body = await api("/ask", { method: "POST", body: JSON.stringify({ question, ship, facts: card ? shipFacts(card) : null, fleet: card ? null : TOOLS.read_commander({}), state }) });
      // The brain may recognise an order said in words the router does not know ("let's leave that one for now"): it comes back as an intent.
      if (body.intent && watch) { const heard = await watch.hear({ intent: body.intent, decision: body.decision, text: question }); if (heard) { showFor(heard.ui); return heard; } }
      pendingProposal = body.proposal || null;
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
      .catch((err) => ({ error: String(err.message || err), say: `I hit a problem: ${String(err.message || err)}. Would you say that again?` }))
      // Sent the moment the tool returns; measured 2026-09-03 the server accepts it during the reply and answers ~2.3 s sooner.
      // The model gets the line and nothing else: it reads, it does not think, and every extra field is a reason to improvise.
      .then((result) => send({ type: "tool.result", call_id: ev.call_id, result: JSON.stringify(result.error ? { error: result.error, say: result.say } : { say: result.say }), is_error: Boolean(result.error) }));
  }
  // A turn can get lost when the captain speaks over the tail of the officer's line: the service drops the words
  // (speech.stopped, never a transcript; seen 2026-09-18). A person would say "sorry, I talked over you". So does the officer,
  // but only into silence: a reply.create queues behind a reply in progress and cannot cancel it (measured the same night:
  // a watchdog that muted an improvised reply and queued the right line left the captain in 13 s of silence; removed).
  let sorryAt = 0;
  function watchLostWords(t) {
    setTimeout(() => {
      if (!ws || turn !== t || userSpeaking || dock.dataset.state !== "listening" || !mic || mic.spoke(4000) < 350 || Date.now() - sorryAt < 15000) return;
      sorryAt = Date.now();
      sayExactly("Sorry, Captain, I was still talking. Say that again?");
    }, 1300);
  }
  async function captainSaid({ text }) {
    // A proactive line the model routed through the tool instead of saying it: hand it straight back. The captain has not
    // spoken since it was issued (every utterance bumps `turn` before its tool call), so these words cannot be theirs;
    // routing them once parked the first agenda item off the officer's own "…or park it?" (2026-09-17).
    if (pendingSay && pendingTurn === turn) { const say = pendingSay; pendingSay = ""; return { say }; }
    if (answered.turn === turn) return answered.result; // same utterance, second call: same answer, nothing acted on twice
    const result = answer(text).then(forTheEar);
    answered = { turn, result };
    return result;
  }
  // The last word on every line: written for the ear, and ending on a question.
  function forTheEar(result) {
    let say = globalThis.officerForEar(result.say || "");
    if (say && !asksSomething(say) && !result.close && !result.hold) say = `${say} ${OPEN_QUESTIONS[openQuestion++ % OPEN_QUESTIONS.length]}`; // a farewell is the one line that asks nothing
    return { ...result, say };
  }
  async function answer(text, { mirror = false } = {}) {
    const fresh = Date.now() - lastUserAt < 15000 && lastUserText;
    const words = fresh ? lastUserText : String(text || "");
    if (!watch) { try { await loadAgenda(); } catch {} }
    if (!watch) return askOfficer(words);
    const proposal = mirror ? (mirrorAsked && globalThis.officerWatch.proposes(lastAgentLine) ? { mirrored: true } : null) : pendingProposal;
    pendingProposal = null; mirrorAsked = false;
    const turnOf = await watch.converse(words, { proposal: Boolean(proposal) }); // the order of the turn lives in watch.js
    switch (turnOf.kind) {
      case "proposal-yes": pendingProposal = proposal; return mirror ? {} : acceptProposal();
      case "watch": cockpit.show(turnOf); if (turnOf.close) { closing = true; cockpit.clear(); } if (mirror) mirrored = globalThis.officerForEar(turnOf.say); if (turnOf.order) carryOut(turnOf.order); return turnOf; // the cockpit owns the screen now
      case "cockpit": {
        const r = turnOf.route;
        if (r.intent === "navigate") { const f = TOOLS.navigate({ target: r.target }); return { ...f, say: f.error || f.done }; }
        const f = r.intent === "read" ? TOOLS.read_commander({ ship: r.ship }) : TOOLS.open_ship({ ship: r.ship });
        if (f.error) return { say: f.error };
        const say = r.intent === "read" ? globalThis.officerWatch.readLine(f) : globalThis.officerWatch.shipLine(f);
        // Asked to see a ship: its own panel opens, and the officer's surface says what it is reading out.
        cockpit.show({ view: { kind: "ship", label: f.ship, headline: f.read_line || "", lines: [f.stage && `Stage: ${f.stage}`, f.constraint && `Constraint: ${f.constraint}`, f.visitors && `Visitors: ${f.visitors}`].filter(Boolean), options: ["back to the agenda"], ships: [f.ship], modal: true } });
        return { ...f, say };
      }
      default: // a real question: the brain's (in mirror mode the officer-as-LLM endpoint answers it; the cockpit only follows)
        // A question about a ship marks that ship; its panel opens only when the captain asks to see it (founder, 2026-09-18).
        // The panel opening here once buried the whole screen, dock included, at the question beat of a take (2026-09-24).
        if (turnOf.ship && findShip(turnOf.ship)) cockpit.show({ view: { kind: "question", label: turnOf.ship, headline: words, lines: [], options: [], ships: [turnOf.ship] } });
        if (mirror) { mirrorAsked = true; mirrored = ""; return {}; } // the brain's answer is not known here
        try { return await askOfficer(words); } catch (err) {
          return watch.hear(err.status === 429 ? { intent: "busy", seconds: err.body.retry_after } : { intent: "unclear" });
        }
    }
  }
  async function acceptProposal() {
    const p = pendingProposal; pendingProposal = null;
    const body = await api("/ask", { method: "POST", body: JSON.stringify({ accept: p }) });
    return { say: body.say || `Logged: ${p.title}.`, proposal: p };
  }
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
  window.voiceTools = { ...TOOLS, mirrored: () => mirrored, busy: () => officerTalking() || queue.length > 0 || carrying, ear: () => (ear ? ear.model : ""), route: (t) => { turn += 1; lastUserText = t; lastUserAt = Date.now(); return captainSaid({ text: t }); }, loadAgenda }; // console: voiceTools.route("why?")
})();
