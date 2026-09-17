// The officer's microphone: getUserMedia → AudioWorklet → 24 kHz PCM16 chunks, and a health read so the dock can
// always say which of these is true: listening · hearing · heard · silent · unheard · stalled · blocked.
// Written after 2026-09-04, when the captain heard the opening line and nothing else, and the dock could not say why.
// Loaded before voice.js (like router.js). open() never throws: a microphone that fails is a state, not an exception.
(() => {
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
  const FLOOR = 0.0004; // below this a chunk is digital silence: a muted or wrong input, never a quiet room
  const LOUD = 0.03; // a voice at arm's length
  const TYPE = "Typing works meanwhile.";
  const BLOCKED = {
    NotAllowedError: `The browser has not handed me the microphone yet. Click the mic icon in the address bar, allow it, then reopen the watch. ${TYPE}`,
    NotFoundError: `I can't find a microphone on this machine. Pick one in the sound settings, then reopen the watch. ${TYPE}`,
    NotReadableError: `Another app is holding the microphone. Close it, then reopen the watch. ${TYPE}`,
  };

  async function open({ ctx, rate, onChunk, onHealth }) {
    const health = { state: "opening", text: "Opening the microphone…", level: 0 };
    const report = (state, text) => { health.state = state; health.text = text; onHealth({ ...health }); };
    let stream, track;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      track = stream.getAudioTracks()[0];
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" })));
    } catch (err) {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      report("blocked", BLOCKED[err.name] || `The microphone did not open (${err.name}: ${err.message}). ${TYPE}`);
      return { close() {}, note() {} };
    }
    const label = track.label || "microphone";
    const started = performance.now();
    let lastChunk = started, lastSound = 0, peakNow = 0, loudSince = 0, quietSince = started, speechAt = 0, heard = "", heardAt = 0, officer = false;
    const worklet = new AudioWorkletNode(ctx, "pcm-processor", { processorOptions: { inputSampleRate: ctx.sampleRate, targetSampleRate: rate } });
    ctx.createMediaStreamSource(stream).connect(worklet);
    worklet.connect(ctx.destination); // it writes no output; the connection keeps every browser pulling the node
    worklet.port.onmessage = ({ data }) => {
      const pcm = new Int16Array(data);
      let peak = 0;
      for (let i = 0; i < pcm.length; i++) { const v = Math.abs(pcm[i]); if (v > peak) peak = v; }
      peak /= 0x8000;
      lastChunk = performance.now();
      if (peak > FLOOR) lastSound = lastChunk;
      if (peak > peakNow) peakNow = peak;
      onChunk(data);
    };
    const timer = setInterval(() => {
      const now = performance.now();
      health.level = Math.min(1, Math.sqrt(peakNow));
      const loud = peakNow > LOUD;
      peakNow = 0;
      if (loud) { if (!loudSince) loudSince = now; quietSince = 0; } else if (!quietSince) quietSince = now; else if (now - quietSince > 600) loudSince = 0;
      if (ctx.state === "suspended") ctx.resume();
      if (track.readyState === "ended") report("stalled", `The ${label} went away. Reopen the watch to pick it up again. ${TYPE}`);
      else if (now - lastChunk > 1500) report("stalled", `No audio is leaving the browser: its audio engine is paused. Click the page once, or reopen the watch. ${TYPE}`);
      else if (track.muted || (now - started > 3000 && now - lastSound > 3000)) report("silent", `The ${label} is open but sends pure silence. Check the input device and its mute in the sound settings. ${TYPE}`);
      else if (officer) report("listening", `Listening · ${label}`); // the officer's own voice can leak past echo cancellation; it is not the captain
      else if (loudSince && now - loudSince > 1500 && speechAt < loudSince) report("unheard", `Your voice reaches the browser, and the speech service has not picked it up yet. Keep going; if this stays, reopen the watch.`);
      else if (loudSince) report("hearing", "I hear you…");
      else if (heard && now - heardAt < 8000) report("heard", `Heard: “${heard}”`);
      else report("listening", `Listening · ${label}`);
    }, 200);
    report("listening", `Listening · ${label}`);
    return {
      // voice.js tells the mic what the service did with the audio: "speech" (it detected a voice), "heard" (a final transcript),
      // and "officer" (true while the officer is talking).
      note(what, text) { if (what === "officer") officer = Boolean(text); if (what === "speech") speechAt = performance.now(); if (what === "heard") { heard = text; heardAt = performance.now(); speechAt = heardAt; loudSince = 0; } },
      close() { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); try { worklet.disconnect(); } catch {} },
    };
  }

  globalThis.officerMic = { open };
})();
