import type { Intensity } from '../personas/personas';
import type { LiveUsage, EvalUsage } from './cost';
import type { ScoreKey } from './eval';

export interface Turn {
  role: 'user' | 'persona';
  text: string;
  /** Seconds from session start when this turn began (for timestamps). */
  ts?: number;
}

export interface SessionMeta {
  id?: string;
  createdAt: string;
  category: string;
  personaId: string;
  personaName: string;
  personaTitle: string;
  intensity: Intensity;
  scenarioNote?: string;
  prd: string;
  /** The freeform situation text for custom-mode sessions. */
  situation?: string;
  durationSec: number;
  endedBy?: 'user' | 'persona' | 'disconnect';
  usage: { live: LiveUsage; eval?: EvalUsage };
  cost: { live: number; eval?: number; total: number };
  scores?: Record<ScoreKey, number>;
}

/** Create a session folder with meta + transcript; returns its id. */
export async function createSession(meta: SessionMeta, transcript: Turn[]): Promise<string> {
  const res = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meta, transcript }),
  });
  if (!res.ok) throw new Error(`Failed to save session (${res.status})`);
  const { id } = await res.json();
  return id;
}

/** Merge fields into a session's meta.json and optionally write evaluation.md. */
export async function updateSession(
  id: string,
  metaPatch: Partial<SessionMeta>,
  evaluationMarkdown?: string,
): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metaPatch, evaluationMarkdown }),
  });
  if (!res.ok) throw new Error(`Failed to update session (${res.status})`);
}

/** Upload the mixed conversation audio for a session. */
export async function uploadRecording(id: string, blob: Blob): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/recording`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  });
  if (!res.ok) throw new Error(`Failed to save recording (${res.status})`);
}
