// The officer's ear: AssemblyAI's streaming speech model hears the captain and calls the end of the turn.
// Universal-3.6 Pro Realtime (released 2026-09-29) was trained on real voice-agent conversations: short replies, names,
// turn-taking. Measured that day on the captain's own orders: six of six heard right, the turn called 0.39–0.49 s after
// the voice stopped. With the ear open the island hears, decides the line at once (router.js, watch.js) and hands it to
// the voice; without it the voice agent hears for itself and asks the officer-as-LLM endpoint. open() resolves to null
// when the ear cannot open: a missing ear is a slower path, never an error.
(() => {
  const URL = "wss://streaming.assemblyai.com/v3/ws";
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

  function open({ token, model, rate, keyterms = [], onSpeech, onWords, onTurn, onLost }) {
    return new Promise((done) => {
      const q = new URLSearchParams({ token, speech_model: model, sample_rate: rate, encoding: "pcm_s16le", min_turn_silence: 100, max_turn_silence: 500, keyterms_prompt: JSON.stringify(keyterms) });
      let ws, ready = false, closed = false, last = { text: "", at: 0 };
      try { ws = new WebSocket(`${URL}?${q}`); } catch { done(null); return; }
      const giveUp = setTimeout(() => { if (!ready) { try { ws.close(); } catch {} done(null); } }, 4000);
      ws.onmessage = ({ data }) => {
        const m = JSON.parse(data);
        if (m.type === "Begin") { ready = true; clearTimeout(giveUp); done({ model, send(pcm) { if (ws.readyState === 1) ws.send(pcm); }, close() { closed = true; try { ws.send(JSON.stringify({ type: "Terminate" })); ws.close(); } catch {} } }); return; }
        if (m.type === "SpeechStarted") { onSpeech(); return; }
        if (m.type !== "Turn" || !norm(m.transcript)) return;
        if (!m.end_of_turn) { onWords(m.transcript); return; }
        const text = norm(m.transcript), now = Date.now();
        if (text === last.text && now - last.at < 1500) return; // the same turn, sent again once formatted
        last = { text, at: now };
        onTurn(m.transcript);
      };
      ws.onclose = () => { clearTimeout(giveUp); if (!ready) done(null); else if (!closed) onLost(); };
      ws.onerror = () => {};
    });
  }

  // Is this the officer's own voice coming back through the microphone? Echo cancellation lets some of it through on
  // open speakers; words that are the officer's current line are not the captain's.
  function echoes(heard, line) {
    const words = norm(heard).split(" ").filter(Boolean), said = new Set(norm(line).split(" "));
    return words.length > 0 && words.filter((w) => said.has(w)).length / words.length >= 0.7 && (words.length > 1 || norm(line).split(" ").length < 4);
  }

  globalThis.officerEar = { open, echoes };
})();
