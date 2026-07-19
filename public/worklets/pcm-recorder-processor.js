// AudioWorklet processor that runs on the audio thread. It receives mono
// Float32 frames at the capture AudioContext's sample rate (we create that
// context at 16 kHz, so no manual resampling is needed here), converts them to
// 16-bit PCM, and posts fixed-size chunks back to the main thread for the
// Gemini Live API.
//
// This file is loaded verbatim via audioWorklet.addModule(), so it must be
// plain browser JS with no imports/bundling.

const CHUNK_SAMPLES = 2048; // ~128 ms at 16 kHz — small enough for low latency.

class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(CHUNK_SAMPLES);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this._buffer[this._offset++] = channel[i];
      if (this._offset === CHUNK_SAMPLES) {
        this._flush();
        this._offset = 0;
      }
    }
    return true;
  }

  _flush() {
    const pcm = new Int16Array(CHUNK_SAMPLES);
    for (let i = 0; i < CHUNK_SAMPLES; i++) {
      // Clamp to [-1, 1] then scale to signed 16-bit.
      const s = Math.max(-1, Math.min(1, this._buffer[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    // Transfer the underlying buffer to avoid a copy.
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
  }
}

registerProcessor('pcm-recorder-processor', PcmRecorderProcessor);
