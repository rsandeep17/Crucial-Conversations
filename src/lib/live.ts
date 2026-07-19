import { GoogleGenAI, Modality, Type } from '@google/genai';
import type { LiveServerMessage, Session, UsageMetadata } from '@google/genai';

const END_MEETING_TOOL = {
  functionDeclarations: [
    {
      name: 'end_meeting',
      description:
        'Call this to end the review meeting AFTER you have spoken your brief closing remark. ' +
        'Only call it once you have genuinely pressure-tested the key decisions in the PRD.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
  ],
};

export interface LiveSessionCallbacks {
  onOpen?: () => void;
  onClose?: (reason: string) => void;
  onError?: (message: string) => void;
  /** A chunk of the model's speech (base64 24 kHz PCM) to play. */
  onAudio?: (base64Pcm: string) => void;
  /** Barge-in: the model was interrupted; flush playback immediately. */
  onInterrupted?: () => void;
  /** Streamed transcription for either side. `final` marks a completed turn. */
  onTranscript?: (role: 'user' | 'persona', text: string, final: boolean) => void;
  /** Per-message token usage, for the live cost ticker. */
  onUsage?: (usage: UsageMetadata) => void;
  /** Server will disconnect soon (used later for seamless resumption). */
  onGoAway?: (timeLeft: string | undefined) => void;
  /** The persona called end_meeting after its closing remark. */
  onEndRequested?: () => void;
}

export interface LiveSessionOptions {
  apiKey: string;
  model: string;
  voice: string;
  systemInstruction: string;
  callbacks: LiveSessionCallbacks;
}

/**
 * Thin wrapper around @google/genai's Live API session for a single voice
 * conversation. Enables two-sided transcription (so we get a transcript for
 * free) and context-window compression (so long sessions don't hit the raw
 * window limit). Session resumption handles are captured for later use.
 */
export class LiveSession {
  private session: Session | null = null;
  private resumptionHandle: string | null = null;

  constructor(private readonly options: LiveSessionOptions) {}

  async connect(): Promise<void> {
    const { apiKey, model, voice, systemInstruction, callbacks } = this.options;
    const ai = new GoogleGenAI({ apiKey });

    this.session = await ai.live.connect({
      model,
      callbacks: {
        onopen: () => callbacks.onOpen?.(),
        onmessage: (msg: LiveServerMessage) => this.handleMessage(msg, callbacks),
        onerror: (e: ErrorEvent) => callbacks.onError?.(e.message || 'Live API error'),
        onclose: (e: CloseEvent) => callbacks.onClose?.(e.reason || 'closed'),
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: {},
        tools: [END_MEETING_TOOL],
      },
    });
  }

  private handleMessage(msg: LiveServerMessage, cb: LiveSessionCallbacks): void {
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.resumptionHandle = msg.sessionResumptionUpdate.newHandle;
    }
    if (msg.goAway) cb.onGoAway?.(msg.goAway.timeLeft);
    if (msg.usageMetadata) cb.onUsage?.(msg.usageMetadata);

    if (msg.toolCall?.functionCalls?.some((fc) => fc.name === 'end_meeting')) {
      cb.onEndRequested?.();
    }

    const content = msg.serverContent;
    if (!content) return;

    if (content.interrupted) cb.onInterrupted?.();

    if (content.inputTranscription?.text) {
      cb.onTranscript?.('user', content.inputTranscription.text, false);
    }
    if (content.outputTranscription?.text) {
      cb.onTranscript?.('persona', content.outputTranscription.text, false);
    }

    // Audio comes back as inline PCM data parts on the model turn.
    for (const part of content.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data;
      if (data && part.inlineData?.mimeType?.startsWith('audio/pcm')) {
        cb.onAudio?.(data);
      }
    }

    if (content.turnComplete) {
      // Signal both sides that the current streamed turn is finalized.
      cb.onTranscript?.('user', '', true);
      cb.onTranscript?.('persona', '', true);
    }
  }

  /** Send a base64-encoded 16 kHz PCM chunk from the mic. */
  sendAudio(base64Pcm: string): void {
    this.session?.sendRealtimeInput({
      audio: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' },
    });
  }

  get lastResumptionHandle(): string | null {
    return this.resumptionHandle;
  }

  close(): void {
    try {
      this.session?.close();
    } catch {
      // ignore
    }
    this.session = null;
  }
}
