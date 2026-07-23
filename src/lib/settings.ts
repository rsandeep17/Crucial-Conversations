export interface PricingTable {
  liveAudioInput: number;
  liveTextInput: number;
  liveAudioOutput: number;
  liveTextOutput: number;
  evalInput: number;
  evalOutput: number;
}

/**
 * Reasoning effort for the evaluation model (Gemini 3 family). Lower = cheaper
 * and faster (fewer billed thinking tokens); higher = deeper analysis. Gemini 3
 * models cannot fully disable thinking — MINIMAL is the floor.
 */
export type EvalThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

export const EVAL_THINKING_LEVELS: EvalThinkingLevel[] = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];

/**
 * Selectable evaluation models. Both are Gemini 3 family, so they share the
 * same thinking levels. Each carries its own token pricing (USD per 1M) so the
 * cost estimate stays correct when the model is switched from Settings — no
 * hand-editing of the pricing table needed.
 */
export interface EvalModelOption {
  id: string;
  label: string;
  evalInput: number;
  evalOutput: number;
}

export const EVAL_MODELS: EvalModelOption[] = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite — cheapest', evalInput: 0.3, evalOutput: 2.5 },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash — deeper, pricier', evalInput: 1.5, evalOutput: 7.5 },
];

export interface Settings {
  apiKey: string;
  liveModel: string;
  evalModel: string;
  voice: string;
  pricing: PricingTable;
  /** Soft warning thresholds for the live session (no hard cutoff). */
  warnCostUsd: number;
  warnMinutes: number;
  /** Reasoning effort for the evaluation model. */
  evalThinkingLevel: EvalThinkingLevel;
  /** Send the user's spoken audio to the evaluator (assesses delivery/tone). */
  evalUseAudio: boolean;
  /** USD→INR conversion rate for displaying cost in rupees. */
  usdToInr: number;
}

export async function loadSettings(): Promise<Settings> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
  return res.json();
}

export async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  if (!res.ok) throw new Error(`Failed to save settings (${res.status})`);
  return res.json();
}
