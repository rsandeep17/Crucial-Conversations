export interface PricingTable {
  liveAudioInput: number;
  liveTextInput: number;
  liveAudioOutput: number;
  liveTextOutput: number;
  evalInput: number;
  evalOutput: number;
}

export interface Settings {
  apiKey: string;
  liveModel: string;
  evalModel: string;
  voice: string;
  pricing: PricingTable;
  /** Soft warning thresholds for the live session (no hard cutoff). */
  warnCostUsd: number;
  warnMinutes: number;
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
