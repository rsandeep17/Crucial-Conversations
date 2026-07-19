import { concatInt16, int16ToWavBlob } from './pcm';

/**
 * Records the whole conversation — your mic plus the model's voice — into a
 * single mixed WAV, entirely client-side (no API cost).
 *
 * We tap the mixed audio graph with an AudioWorklet and accumulate raw PCM,
 * then write a WAV on stop. WAV (unlike MediaRecorder's .webm) is linear PCM,
 * so the player can seek to any timestamp reliably — which powers the
 * click-a-timestamp-to-jump feature. MediaRecorder .webm files from the
 * browser usually lack seeking cues and report an unknown duration.
 *
 * The model's 24 kHz output and the mic (resampled by the context) are summed
 * into a gain node, tapped by the worklet, and routed on to a muted node so
 * the graph stays "live" and the worklet keeps processing.
 */
export class SessionRecorder {
  private mixGain: GainNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private silentSink: GainNode | null = null;
  private pcmChunks: Int16Array[] = [];

  constructor(
    private readonly context: AudioContext,
    private readonly modelOutput: AudioNode,
    private readonly micStream: MediaStream,
  ) {}

  async start(): Promise<void> {
    try {
      await this.context.audioWorklet.addModule('/worklets/pcm-recorder-processor.js');
    } catch {
      // Module may already be registered on this context; that's fine.
    }

    this.mixGain = this.context.createGain();
    this.modelOutput.connect(this.mixGain);
    this.micSource = this.context.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.mixGain);

    this.worklet = new AudioWorkletNode(this.context, 'pcm-recorder-processor');
    this.worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      this.pcmChunks.push(new Int16Array(e.data.slice(0)));
    };
    this.mixGain.connect(this.worklet);

    // Keep the worklet in the active render graph without adding audible output.
    this.silentSink = this.context.createGain();
    this.silentSink.gain.value = 0;
    this.worklet.connect(this.silentSink);
    this.silentSink.connect(this.context.destination);
  }

  /** Stop recording and return the mixed conversation as a seekable WAV. */
  stop(): Blob | null {
    try {
      this.modelOutput.disconnect(this.mixGain!);
    } catch {
      // already disconnected
    }
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.micSource?.disconnect();
    this.mixGain?.disconnect();
    this.silentSink?.disconnect();

    const blob = this.pcmChunks.length
      ? int16ToWavBlob(concatInt16(this.pcmChunks), this.context.sampleRate)
      : null;

    this.worklet = null;
    this.micSource = null;
    this.mixGain = null;
    this.silentSink = null;
    return blob;
  }
}
