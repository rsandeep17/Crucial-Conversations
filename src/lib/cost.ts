import type { UsageMetadata } from '@google/genai';
import type { PricingTable } from './settings';

export interface LiveUsage {
  inputAudioTokens: number;
  inputTextTokens: number;
  outputAudioTokens: number;
  outputTextTokens: number;
  totalTokens: number;
}

export interface EvalUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const EMPTY_USAGE_DISPLAY: LiveUsage = {
  inputAudioTokens: 0,
  inputTextTokens: 0,
  outputAudioTokens: 0,
  outputTextTokens: 0,
  totalTokens: 0,
};

const EMPTY_LIVE: LiveUsage = EMPTY_USAGE_DISPLAY;

function modalityTotal(
  details: { modality?: string; tokenCount?: number }[] | undefined,
  modality: 'AUDIO' | 'TEXT',
): number {
  if (!details) return 0;
  return details
    .filter((d) => d.modality === modality)
    .reduce((sum, d) => sum + (d.tokenCount ?? 0), 0);
}

/**
 * Tracks Live API usage across a session by SUMMING every per-turn
 * usageMetadata snapshot. The Live API re-bills the full cumulative context on
 * each turn (prior audio is retained as tokens to preserve tone), and each
 * server message carries that turn's charge. Summing every message's
 * per-modality tokens reproduces the Cloud bill to within a few percent;
 * taking the max/last value drastically undercounts (this was the original
 * ~3.5x-too-low bug). The result is still an estimate — Cloud billing is
 * authoritative. Assumes one usageMetadata message per turn (the SDK norm), so
 * a plain sum does not double-count.
 */
export class LiveUsageTracker {
  private usage: LiveUsage = { ...EMPTY_LIVE };

  update(meta: UsageMetadata): void {
    this.usage.inputAudioTokens += modalityTotal(meta.promptTokensDetails, 'AUDIO');
    this.usage.inputTextTokens += modalityTotal(meta.promptTokensDetails, 'TEXT');
    this.usage.outputAudioTokens += modalityTotal(meta.responseTokensDetails, 'AUDIO');
    this.usage.outputTextTokens += modalityTotal(meta.responseTokensDetails, 'TEXT');
    this.usage.totalTokens += meta.totalTokenCount ?? 0;
  }

  get current(): LiveUsage {
    return { ...this.usage };
  }
}

/** USD cost of the live voice portion, from per-modality token counts. */
export function liveCost(usage: LiveUsage, pricing: PricingTable): number {
  return (
    (usage.inputAudioTokens * pricing.liveAudioInput +
      usage.inputTextTokens * pricing.liveTextInput +
      usage.outputAudioTokens * pricing.liveAudioOutput +
      usage.outputTextTokens * pricing.liveTextOutput) /
    1_000_000
  );
}

/** USD cost of the post-session evaluation call. */
export function evalCost(usage: EvalUsage, pricing: PricingTable): number {
  return (usage.inputTokens * pricing.evalInput + usage.outputTokens * pricing.evalOutput) / 1_000_000;
}

export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
