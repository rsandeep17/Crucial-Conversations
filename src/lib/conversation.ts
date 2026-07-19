import { AudioRecorder } from './audio/AudioRecorder';
import { AudioStreamer } from './audio/AudioStreamer';
import { SessionRecorder } from './audio/SessionRecorder';
import { LiveSession } from './live';
import { LiveUsageTracker, type LiveUsage } from './cost';
import { buildSystemInstruction, type SessionConfig } from '../personas/personas';
import type { Turn } from './sessionStore';

export type ConversationStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export interface ConversationCallbacks {
  onStatus?: (status: ConversationStatus) => void;
  onTranscript?: (committed: Turn[], liveUser: string, livePersona: string) => void;
  onUsage?: (usage: LiveUsage) => void;
  onError?: (message: string) => void;
  /** The persona chose to wrap up the meeting; the screen should end gracefully. */
  onEndRequested?: () => void;
}

export interface ConversationResult {
  transcript: Turn[];
  usage: LiveUsage;
  durationSec: number;
  recording: Blob | null;
  /** The user's own speech as WAV, for the evaluator to assess delivery. */
  userAudio: Blob | null;
}

/**
 * Orchestrates a single practice conversation: mic capture, the Live API
 * session, model playback, mixed-audio recording, transcription buffering, and
 * usage tracking. The React screen just starts/stops it and renders callbacks.
 */
export class Conversation {
  private recorder: AudioRecorder | null = null;
  private streamer: AudioStreamer | null = null;
  private sessionRecorder: SessionRecorder | null = null;
  private session: LiveSession | null = null;
  private tracker = new LiveUsageTracker();

  private committed: Turn[] = [];
  private buffers = { user: '', persona: '' };
  private bufferStart = { user: 0, persona: 0 };
  private startMs = 0;

  constructor(
    private readonly config: SessionConfig,
    private readonly apiKey: string,
    private readonly liveModel: string,
    private readonly cb: ConversationCallbacks,
  ) {}

  async start(): Promise<void> {
    this.cb.onStatus?.('connecting');
    this.committed = [];
    this.buffers = { user: '', persona: '' };

    const streamer = new AudioStreamer();
    await streamer.resume();
    this.streamer = streamer;

    const session = new LiveSession({
      apiKey: this.apiKey,
      model: this.liveModel,
      voice: this.config.persona.voice,
      systemInstruction: buildSystemInstruction(this.config),
      callbacks: {
        onOpen: () => {
          this.startMs = performance.now();
          this.cb.onStatus?.('live');
        },
        onError: (m) => {
          this.cb.onError?.(m);
          this.cb.onStatus?.('error');
        },
        onClose: (reason) => {
          if (reason && reason !== 'closed') this.cb.onError?.(`Connection closed: ${reason}`);
        },
        onAudio: (b64) => this.streamer?.enqueue(b64),
        onInterrupted: () => this.streamer?.flush(),
        onEndRequested: () => this.cb.onEndRequested?.(),
        onUsage: (meta) => {
          this.tracker.update(meta);
          this.cb.onUsage?.(this.tracker.current);
        },
        onTranscript: (role, text, final) => {
          if (final) {
            this.commitBuffers();
          } else {
            if (!this.buffers[role]) this.bufferStart[role] = this.durationSec;
            this.buffers[role] += text;
            this.emitTranscript();
          }
        },
      },
    });
    this.session = session;
    await session.connect();

    const recorder = new AudioRecorder();
    await recorder.start((b64) => this.session?.sendAudio(b64));
    this.recorder = recorder;

    // Now that mic + playback contexts exist, mix them into one recording.
    if (recorder.micStream) {
      this.sessionRecorder = new SessionRecorder(
        streamer.audioContext,
        streamer.outputNode,
        recorder.micStream,
      );
      this.sessionRecorder.start();
    }
  }

  private commitBuffers(): void {
    const { user, persona } = this.buffers;
    const pending: Turn[] = [];
    if (user.trim()) pending.push({ role: 'user', text: user.trim(), ts: this.bufferStart.user });
    if (persona.trim()) pending.push({ role: 'persona', text: persona.trim(), ts: this.bufferStart.persona });
    // Keep chronological order within the turn.
    pending.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
    this.committed.push(...pending);
    this.buffers = { user: '', persona: '' };
    this.emitTranscript();
  }

  private emitTranscript(): void {
    this.cb.onTranscript?.([...this.committed], this.buffers.user, this.buffers.persona);
  }

  get durationSec(): number {
    return this.startMs ? (performance.now() - this.startMs) / 1000 : 0;
  }

  async stop(graceful = false): Promise<ConversationResult> {
    const durationSec = this.durationSec;
    // When the persona wraps up, let its closing remark finish playing (and be
    // recorded) before we tear everything down.
    if (graceful) await this.streamer?.waitForDrain();
    // Finalize the recording first, while the mic and playback are still live,
    // so the tail of the conversation is captured.
    const recording = (await this.sessionRecorder?.stop()) ?? null;
    const userAudio = this.recorder?.buildUserAudioWav() ?? null;
    await this.recorder?.stop();
    this.session?.close();
    this.commitBuffers();
    await this.streamer?.close();

    const result: ConversationResult = {
      transcript: [...this.committed],
      usage: this.tracker.current,
      durationSec,
      recording,
      userAudio,
    };

    this.recorder = null;
    this.streamer = null;
    this.sessionRecorder = null;
    this.session = null;
    this.cb.onStatus?.('ended');
    return result;
  }
}
