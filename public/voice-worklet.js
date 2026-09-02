// Microphone → 24 kHz PCM16 chunks. Runs on the audio thread.
// Resamples when the context refuses 24 kHz (Safari runs at hardware rate).
class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { inputSampleRate = sampleRate, targetSampleRate = 24000, chunkMs = 50 } = options.processorOptions || {};
    this.ratio = inputSampleRate / targetSampleRate;
    this.chunk = Math.round((targetSampleRate * chunkMs) / 1000);
    this.buffer = new Int16Array(this.chunk);
    this.filled = 0;
    this.cursor = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (; this.cursor < input.length; this.cursor += this.ratio) {
      const s = input[Math.floor(this.cursor)];
      this.buffer[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.chunk) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.chunk);
        this.filled = 0;
      }
    }
    this.cursor -= input.length;
    return true;
  }
}
registerProcessor("pcm-processor", PcmProcessor);
