import { base64ToArrayBuffer, int16PcmToFloat32 } from './pcm';

const OUTPUT_SAMPLE_RATE = 24000; // Gemini Live audio output is 24 kHz PCM.

/**
 * Plays the model's streamed 24 kHz PCM audio by scheduling each chunk
 * back-to-back on a dedicated AudioContext. Supports flush() for barge-in:
 * when the user interrupts, the Live API sends an `interrupted` signal and we
 * must immediately drop any queued/playing audio.
 */
export class AudioStreamer {
  private context: AudioContext;
  private gain: GainNode;
  private analyser: AnalyserNode;
  private levelBuf: Uint8Array<ArrayBuffer>;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor() {
    this.context = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.gain = this.context.createGain();
    this.gain.connect(this.context.destination);
    // Tap the model's voice for a real-time level (drives the speaking indicator).
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.levelBuf = new Uint8Array(this.analyser.fftSize);
    this.gain.connect(this.analyser);
  }

  /** Current model-voice loudness, 0..1 (RMS of the time-domain waveform). */
  getLevel(): number {
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = (this.levelBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.levelBuf.length);
  }

  /** GainNode carrying the model's voice — tap this to mix into a recording. */
  get outputNode(): GainNode {
    return this.gain;
  }

  get audioContext(): AudioContext {
    return this.context;
  }

  async resume(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume();
  }

  /** Enqueue a base64 PCM chunk from the Live API for playback. */
  enqueue(base64Pcm: string): void {
    const float32 = int16PcmToFloat32(base64ToArrayBuffer(base64Pcm));
    if (float32.length === 0) return;

    const buffer = this.context.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    const now = this.context.currentTime;
    // If we've fallen behind (gap in stream), restart the schedule from now.
    const startAt = Math.max(now, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  /** Barge-in: stop everything currently queued/playing. */
  flush(): void {
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.nextStartTime = 0;
  }

  /** Resolve once all queued audio has finished playing (or after maxMs). */
  async waitForDrain(maxMs = 8000): Promise<void> {
    const deadline = performance.now() + maxMs;
    while (this.context.currentTime < this.nextStartTime && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async close(): Promise<void> {
    this.flush();
    if (this.context.state !== 'closed') await this.context.close();
  }
}
