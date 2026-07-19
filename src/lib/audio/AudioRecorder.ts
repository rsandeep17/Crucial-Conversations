import { arrayBufferToBase64, concatInt16, int16ToWavBlob } from './pcm';

const CAPTURE_SAMPLE_RATE = 16000;

/**
 * Captures the microphone as 16 kHz mono 16-bit PCM and emits base64 chunks
 * ready for the Gemini Live API. Uses an AudioWorklet (the main-thread
 * ScriptProcessorNode is deprecated).
 *
 * The capture AudioContext is created at 16 kHz so the browser resamples the
 * mic for us. echoCancellation/noiseSuppression are requested so the model
 * doesn't hear its own voice through the speakers.
 */
export class AudioRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Uint8Array<ArrayBuffer> | null = null;
  private onChunk: ((base64Pcm: string) => void) | null = null;
  // Retain the raw mic PCM so we can hand the user's own audio to the evaluator.
  private pcmChunks: Int16Array[] = [];

  /** The raw mic stream, exposed so a recorder can mix it into the session audio. */
  get micStream(): MediaStream | null {
    return this.stream;
  }

  /** The capture AudioContext, shared so playback mixing can reuse it if desired. */
  get audioContext(): AudioContext | null {
    return this.context;
  }

  async start(onChunk: (base64Pcm: string) => void): Promise<void> {
    if (this.context) return; // already running
    this.onChunk = onChunk;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    this.context = new AudioContext({ sampleRate: 16000 });
    await this.context.audioWorklet.addModule('/worklets/pcm-recorder-processor.js');

    this.source = this.context.createMediaStreamSource(this.stream);

    // Tap the mic for a real-time level (drives the speaking indicator).
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 256;
    this.levelBuf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.source.connect(this.analyser);

    this.worklet = new AudioWorkletNode(this.context, 'pcm-recorder-processor');
    this.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      this.pcmChunks.push(new Int16Array(event.data.slice(0)));
      this.onChunk?.(arrayBufferToBase64(event.data));
    };

    this.source.connect(this.worklet);
    // Do NOT connect the worklet to destination — we don't want to hear our own mic.
  }

  /** Current mic loudness, 0..1 (RMS of the time-domain waveform). */
  getLevel(): number {
    if (!this.analyser || !this.levelBuf) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = (this.levelBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.levelBuf.length);
  }

  /** Build a WAV blob of everything the user said this session (mic only). */
  buildUserAudioWav(): Blob | null {
    if (this.pcmChunks.length === 0) return null;
    return int16ToWavBlob(concatInt16(this.pcmChunks), CAPTURE_SAMPLE_RATE);
  }

  async stop(): Promise<void> {
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.worklet = null;
    this.source = null;
    this.analyser = null;
    this.levelBuf = null;
    this.stream = null;
    this.context = null;
    this.onChunk = null;
  }
}
