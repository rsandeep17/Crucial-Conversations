/**
 * Records the whole conversation — your mic plus the model's voice — into a
 * single mixed .webm file, entirely client-side (no API cost).
 *
 * Both sources are mixed inside the playback AudioContext: the model's output
 * GainNode is tapped, and the mic MediaStream is added as a second source.
 * They fan into one MediaStreamAudioDestinationNode, which MediaRecorder
 * captures as a single track. (24 kHz model buffers resample to the context
 * rate automatically, so mixing across the original rates is not a problem.)
 */
export class SessionRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mixDest: MediaStreamAudioDestinationNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  constructor(
    private readonly context: AudioContext,
    private readonly modelOutput: AudioNode,
    private readonly micStream: MediaStream,
  ) {}

  start(): void {
    this.mixDest = this.context.createMediaStreamDestination();
    this.modelOutput.connect(this.mixDest);
    this.micSource = this.context.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.mixDest);

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    this.recorder = new MediaRecorder(this.mixDest.stream, { mimeType });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(1000); // gather data every second
  }

  /** Stop recording and resolve with the finished audio blob. */
  async stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder) return null;

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType }));
      if (recorder.state !== 'inactive') recorder.stop();
      else resolve(new Blob(this.chunks, { type: recorder.mimeType }));
    });

    try {
      this.modelOutput.disconnect(this.mixDest!);
    } catch {
      // may already be disconnected
    }
    this.micSource?.disconnect();
    this.recorder = null;
    this.mixDest = null;
    this.micSource = null;
    return blob;
  }
}
