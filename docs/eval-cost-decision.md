# Decision: evaluation model & thinking level (eval cost)

> **Status: DECIDED & implemented (2026-07-23).** Eval runs on `gemini-3.5-flash-lite` at thinking level `LOW`. This doc records *why*, so the choice doesn't need re-analysis. Both are changeable from Settings (model + thinking-level dropdown) with no code.

## The trigger

A session's cost breakdown showed **Eval · output = 3,197 tokens (₹2.76)** — suspiciously high, since the visible report is short. That looked like more text than the report could possibly contain.

## What was actually happening

**Tokens ≠ characters.** 3,197 tokens ≈ ~12,000 characters / ~2,000 words. But the saved `evaluation.md` for that session was only **3,669 characters** (~900–1,400 tokens of visible content). The gap is the key insight:

> The eval model (`gemini-3.5-flash`, a Gemini 3 *thinking* model) reasons internally before writing the JSON. Google returns those as `thoughtsTokenCount` and **bills them at the output rate**. Our code folds them into `outputTokens` (`src/lib/eval.ts`, `outputTokens = candidatesTokenCount + thoughtsTokenCount`).

So the 3,197 output tokens were roughly:

| Part | ~Tokens | Visible? |
|---|---|---|
| Structured JSON report (summary, 6 scores, feedback points w/ quotes + rewrites, practice-next, follow-ups) | ~1,300–1,500 | ✅ yes |
| **Model "thinking" tokens** (default MEDIUM level for 3.5-flash) | ~1,700–1,900 | ❌ no |

**Not a bug.** The cost math was internally consistent: eval input 1,309 + output 3,197 = 4,506 total; 3,197 × $9/1M × ₹96 ≈ ₹2.76 (matched the meter). The number was "high" *because* it includes hidden reasoning, which confirmed — rather than contradicted — the thinking-token explanation.

## The realization

This eval task is **read a transcript → produce a structured critique**. It is not multi-step agentic reasoning, so it doesn't need MEDIUM-level thinking or a full Flash model. Two independent cost levers exist, and they **stack**:

1. **Thinking level** — Gemini 3 models use `thinkingConfig.thinkingLevel` (`MINIMAL | LOW | MEDIUM | HIGH`), *not* the older `thinkingBudget`. Default for 3.5-flash is MEDIUM. **Thinking cannot be fully disabled** on Gemini 3 Flash/Flash-Lite — MINIMAL is the floor and doesn't guarantee zero.
2. **Model tier** — a lighter model has much cheaper per-token rates.

## Options considered (verified July 2026, USD per 1M tokens)

| Model | Input | Output | Notes |
|---|---|---|---|
| `gemini-3.5-flash` (was) | $1.50 | $9.00 | default MEDIUM thinking — what we started on |
| `gemini-3.6-flash` | $1.50 | $7.50 | newer, ~equal/better quality; ~17% cheaper output only |
| **`gemini-3.5-flash-lite` (chosen)** | **$0.30** | **$2.50** | built for high-volume simple tasks; keeps structured JSON + audio input |
| `gemini-3.1-flash-lite` | $0.25 | $1.50 | cheapest, oldest — highest quality risk |

### Cost projections for a typical eval (input ~1,300 tok; @ ₹96/$)

| Setup | ~Output tok | Est. eval cost | vs. original |
|---|---|---|---|
| 3.5-flash, MEDIUM (original) | 3,197 | ₹2.95 | — |
| 3.5-flash, LOW | ~2,100 | ₹2.0 | ~1.5× cheaper |
| 3.5-flash, MINIMAL | ~1,700 | ₹1.65 | ~1.8× |
| **flash-lite, LOW (chosen default)** | ~2,000 | **₹0.49** | **~6× cheaper** |
| flash-lite, MINIMAL | ~1,700 | ₹0.44 | ~6.7× |
| 3.1-flash-lite, MINIMAL | ~1,700 | ₹0.30 | ~10× |

The **model swap dominates** the saving (~6×); the thinking level is a smaller multiplier on top. Output-token counts above are estimates — the visible report (~1,400 tok) is roughly fixed; thinking scales with the level.

## Decision

**`gemini-3.5-flash-lite` + `thinkingLevel: LOW`.** ~6× cheaper than the original setup while keeping structured JSON output and audio-input support. LOW (not MINIMAL) is the default to keep a quality cushion; drop to MINIMAL if reports still read well.

Also updated the pricing table defaults (eval in $0.30 / out $2.50) so the in-app cost estimate stays accurate.

## Caveats / when to revisit

- **Quality is unproven at this tier.** Lite models can give shallower feedback and — importantly — weaker **tone/delivery** judgment when audio-eval is on. If a report reads shallow: bump the thinking level to MEDIUM, or switch the model to `gemini-3.6-flash` (both are Settings-only changes).
- **If you change the eval model, update the pricing table too** (`evalInput`/`evalOutput` in Settings / `data/settings.json`), or the cost display will be wrong.
- **Flash-lite audio-input token rate** wasn't pinned to an exact number in the sources; if you enable audio-eval, confirm it against Google's live pricing page (audio input dominates input cost when enabled).

## How to change it later

- **Model:** Settings → "Evaluation model" field (or `evalModel` in `data/settings.json`).
- **Thinking level:** Settings → "Evaluation thinking level" dropdown (`evalThinkingLevel` in `data/settings.json`). One of MINIMAL / LOW / MEDIUM / HIGH.

## Sources

- [Gemini thinking docs](https://ai.google.dev/gemini-api/docs/generate-content/thinking) — thinkingLevel vs thinkingBudget, no full-off on Gemini 3.
- [BenchLM July 2026 pricing](https://benchlm.ai/google/api-pricing) — 3.5-flash $1.5/$9, 3.6-flash $1.5/$7.5, 3.1-flash-lite $0.25/$1.5.
- [Flash-Lite review](https://www.buildfastwithai.com/blogs/gemini-3-5-flash-lite-review-price-benchmarks) & [eesel breakdown](https://www.eesel.ai/blog/gemini-3-5-flash-lite) — flash-lite $0.30/$2.50, supports structured output + audio input.
- SDK typings `node_modules/@google/genai/dist/genai.d.ts` — `ThinkingLevel` enum (MINIMAL/LOW/MEDIUM/HIGH), `ThinkingConfig`.
