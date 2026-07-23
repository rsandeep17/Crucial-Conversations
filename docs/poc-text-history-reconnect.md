# POC: Text-history reconnect to cut Live API cost

> **Status: PLANNED — not yet implemented.** This is a proposed cost optimization to be built on branch `poc/text-history-reconnect`, kept behind a settings toggle (default OFF), and merged only if the A/B measurement clears the bar in "Verification & merge criteria" below. See `plan.md` → Cost optimization backlog for where this sits in the roadmap.

## Context

The Live API re-bills the **full cumulative session context on every turn**, and prior turns are retained as **audio tokens** (~25 tok/s at $3/M input). So an N-turn conversation pays for turn 1's audio ~N times — cost grows superlinearly with turns. The hypothesis: at each turn boundary, keep only the *current* turn as audio and convert all *prior* turns to **text** (we already get free two-sided transcripts), cutting the history component dramatically.

### Research verdict: hypothesis is sound and implementable — with one twist

- **You cannot swap modality inside a live session.** The server holds the context; there's no API to replace audio history with text mid-session. The implementable form is: **tear down + reconnect a fresh session at the turn boundary, seeding prior turns as text history.**
- **Official mechanism exists.** `session.sendClientContent({ turns, turnComplete: false })` — the SDK docs (v2.12.0, installed) explicitly list "Prefilling a conversation context" as a use-case; `turnComplete: false` accumulates history without triggering generation (must be passed explicitly — SDK defaults it to `true`). Note: the wire-level `historyConfig.initialHistoryInClientContent` flag is NOT plumbed through `LiveConnectConfig` in the SDK — it would be silently dropped; do not use it.
- **Cost math:** audio history ≈ 25 tok/s @ $3/M vs text history ≈ 3–4 tok/s @ $0.75/M → the *history* component gets ~25–30x cheaper per conversation-second, and it stops being re-billed as audio every turn. Caveat: **output audio ($12/M) is unaffected** — it's per-turn fresh speech — so total savings will be lower than 25x; realistic expectation is 2–5x on total session cost, growing with session length.
- **Alternatives rejected:** session resumption restores the full *audio* context (no savings); tighter `contextWindowCompression` sliding-window *discards* history (persona forgets earlier discussion) rather than converting it.
- **Main risks:** reconnect latency (~0.5–2 s dead air, mostly masked by user thinking time), persona re-greeting after reseed (mitigated via prompt addendum), loss of paralinguistic memory (persona can no longer "remember" the user's *tone* from prior turns — inherent, acceptable for a practice app).

Sources: [Live API WebSocket reference](https://ai.google.dev/api/live), [session management](https://ai.google.dev/gemini-api/docs/live-session), [capabilities guide](https://ai.google.dev/gemini-api/docs/live-api/capabilities), [billing forum thread](https://discuss.ai.google.dev/t/how-does-gemini-realtime-api-handle-billing-for-audio-input-reused-in-conversation-history-and-how-do-cached-tokens-work-in-this-context/106976), SDK typings `node_modules/@google/genai/dist/genai.d.ts:12075-12115`.

## Approach

Branch: **`poc/text-history-reconnect`** off `main`. Everything behind a settings toggle, **default OFF**, so main behavior is unchanged and A/B needs no branch switching.

**Reconnect cadence:** every persona `turnComplete` (N=1, tunable via setting) — maximum-signal test of the hypothesis; the swap overlaps the user's thinking time. **Skip** the reconnect if that turn ended via barge-in (user is actively speaking).

**Swap sequence (break-before-make)** at an eligible persona turn boundary:
1. Commit transcript buffers (existing path); set `swapping = true`; route mic chunks to a `pendingChunks` buffer (cap ~200 chunks).
2. Close old session after ~300 ms grace (lets trailing `usageMetadata` land; `LiveUsageTracker` keeps summing across sessions — never reset mid-conversation).
3. Open new `LiveSession`: same config, system instruction rebuilt from `this.config` **plus reconnect addendum** ("The meeting is already in progress — the conversation so far is provided. Continue naturally; do not greet again or restart.").
4. After `connect()` resolves (SDK awaits setupComplete internally): `sendClientContent(committedTurns → {role:'user'|'model', parts:[{text}]}, turnComplete: false)`, then swap `this.session`, flush `pendingChunks` in order, record reconnect latency.
5. `AudioRecorder` / `AudioStreamer` / `SessionRecorder` stay alive throughout — recording is continuous (SessionRecorder taps the audio graph, not the session).

## File changes

1. **`src/lib/settings.ts` + `server/apiPlugin.ts`** — add `textHistoryReconnect: boolean` (default `false`) and `reconnectEveryNTurns: number` (default `1`) to `Settings`/`DEFAULT_SETTINGS` (existing merge-onto-defaults picks them up).
2. **`src/screens/Settings.tsx`** — checkbox + number input, following existing field patterns.
3. **`src/lib/live.ts`** — add `sendClientContent(turns, turnComplete = false)` delegating to the SDK session. No setup-config changes (keep `contextWindowCompression` as safety net).
4. **`src/lib/conversation.ts`** — the bulk:
   - Constructor takes the two new options; extract session construction from `start()` (line ~69) into `openSession(seedHistory: boolean)` reusing one callbacks object; `buildSystemInstruction(this.config)` re-called on reconnect (+ addendum).
   - Mic router: `swapping ? pendingChunks.push(b64) : session.sendAudio(b64)` (replaces line 121 lambda).
   - `maybeReconnect()` from the `onTranscript(final)` handler when the **persona** buffer was non-empty at `turnComplete` (check before `commitBuffers()` clears it). Guards: mode on, not `stopped`, not `swapping`, turn-counter % N === 0, not interrupted, `committed.length > 0`.
   - `onOpen` guard: only first open sets `startMs`/emits `'live'` (no status flicker → no `LiveSession.tsx` change). `onClose` guard: `expectedClose` flag during swap so it doesn't fire `onDisconnected`.
   - Reconnect failure: 2 retries (500 ms/1500 ms backoff; full history is in `this.committed`), then fall back to existing disconnect auto-finalize path.
   - `stop()` racing a swap: re-check `stopped` after `connect()` resolves and close the fresh session (mirror of existing lines 115-118).
5. **`src/lib/cost.ts`** — `LiveUsageTracker` gains an append-only per-snapshot `turnLog` (timestamp + per-modality tokens); summing behavior unchanged.
6. **`src/lib/sessionStore.ts` + `src/App.tsx` + `src/screens/LiveSession.tsx`** — thread new options into `new Conversation(...)`; `ConversationResult`/`SessionMeta` gain optional `historyMode`, `turnUsageLog`, `reconnects: [{atTurn, ms}]`; `console.table` of the per-turn log on stop.

## Chronological walkthroughs (dummy conversation)

Cast: **You** (Sandeep) and **Priya** (skeptical staff engineer persona). PRD already pasted. Toggle ON, N=1. "Session" = one WebSocket connection to the Live API; the mic, speaker, and the WAV recorder live *outside* sessions and never restart.

### Scenario A — normal turn boundary (the common case)

| Clock | What happens | What you experience |
|---|---|---|
| 0:00 | **Session 1** connects. Context = system prompt (persona + PRD). | Brief connect, same as today. |
| 0:02 | Priya (audio): *"Hi Sandeep. I read the PRD — let's start with the migration plan, it worries me."* Transcript accumulates as she speaks. | Priya talking, normal. |
| 0:10 | Server sends `turnComplete` (Priya finished **generating**; her last words may still be draining from the speaker buffer). Her turn is committed to the transcript. **Swap begins:** mic chunks now go to an in-memory buffer instead of the socket. | You're still hearing the tail of her sentence / starting to think. |
| 0:10.3 | After a 300 ms grace (to catch the final usage/billing message), Session 1 is closed. | Nothing. |
| 0:11.5 | **Session 2** connects. It is seeded with: system prompt + addendum ("meeting already in progress, don't greet again") + the transcript so far **as text** (`user`/`model` turns, no generation triggered). Mic buffer (probably empty — you weren't talking) is flushed. Swap done, latency logged (~1.2 s). | Still nothing — this happened inside your thinking pause. |
| 0:14 | You: *"Fair — the migration is phased, let me walk you through it."* Your audio streams to Session 2. **Its context: text history + your current audio only.** Priya's turn-1 audio is no longer being re-billed. | Priya responds normally, remembers everything she and you said. |

### Scenario B — you start speaking DURING the swap

| Clock | What happens | What you experience |
|---|---|---|
| 3:20 | Priya finishes turn 4 → `turnComplete` → swap begins, mic routed to buffer. | — |
| 3:20.4 | You jump in early: *"Actually wait, one thing—"*. There is **no live socket right now**, so your audio chunks pile up in the buffer, in order. Nothing is discarded (buffer caps at ~25 s, far beyond any swap). | You just talk. Nothing looks different. |
| 3:21.6 | Session 5 opens, text history seeded **first**, then the ~1.2 s of buffered speech is flushed in order, then your live mic continues seamlessly. The server's VAD sees one continuous utterance. | — |
| 3:23 | You stop talking → VAD end-of-speech → Priya responds. | Her reply arrives at most ~1 s later than it would have — usually unnoticeable, since she only ever replies after you stop anyway. **No words are lost.** |
| — | *Failure branch:* if the connect fails, it retries twice (0.5 s / 1.5 s backoff — the full text history is in memory, so retry is always possible). If all retries fail, the session auto-finalizes exactly like today's disconnect path: saved + evaluated, marked `disconnect`. | Worst case: the meeting ends early but nothing is lost. |

### Scenario C — barge-in (you interrupt Priya mid-sentence)

| Clock | What happens | What you experience |
|---|---|---|
| 5:02 | Priya, mid-turn: *"…and the timeline is unrealistic because your team has never—"* | — |
| 5:04 | You talk over her: *"Hold on, that's not accurate."* Server detects your voice → sends `interrupted` → playback flushes instantly (existing behavior, unchanged). Her **partial** transcript ("…unrealistic because your team has never") is committed as-is — that *is* what was said. | She stops mid-word, exactly like today. |
| 5:04 | **Swap is deliberately SKIPPED at this boundary** — you are actively speaking; tearing down the socket now would mean buffering the middle of your rebuttal for no reason. Session stays up; this exchange stays as audio for now. | Argument continues with zero added latency — barge-ins feel identical to today. |
| 5:30 | Next *clean* Priya `turnComplete` (no interruption) → swap happens there. The seeded text history includes her partial line and your rebuttal. | Nothing. |
| — | Cost impact: one extra turn's audio rides along until the next clean boundary — a minor, bounded overhead. | — |

### Scenario D — ending during a swap (races)

- **Priya ends the meeting** (`end_meeting` tool): can only arrive on a live session, so it never fires mid-swap. Normal path unchanged.
- **You click "End conversation" while a swap is in flight:** `stop()` sets the stopped flag; when the in-flight connect resolves, it sees the flag and immediately closes the fresh session. Everything already captured (transcript, recording, usage) saves normally. The recording is continuous regardless — the WAV recorder taps the audio graph, not the socket.

### What Priya "remembers" after each swap

Everything **said** (the words of every prior turn, verbatim from transcription) — but not how it was said: tone, hesitation, sarcasm from *earlier* turns is gone, because that lived in the audio tokens we stopped paying for. Your **current** turn is still heard live as audio, so she reacts to your delivery in the moment. This is the one real trade-off of the whole approach, and a thing to judge in the A/B.

## Edge cases

| Case | Handling |
|---|---|
| Barge-in mid-persona turn | Skip reconnect that boundary; commit partial persona transcript as-is |
| User speaks during swap | Chunks buffered, flushed after history seed (order: history → audio) |
| Reconnect fails | 2 retries → existing disconnect auto-finalize |
| Seeding triggers unwanted generation | Docs say it won't (`turnComplete:false`); if observed, drop trailing `model` turn from seed |
| Trailing usageMetadata | 300 ms grace before close |
| `end_meeting` / `stop()` during swap | `stopped` re-check post-connect; closed session can't emit tool calls |

## Verification & merge criteria

1. `npm run typecheck` + `npm run build` clean; toggle OFF → behavior identical to main.
2. **A/B with headphones:** baseline session (toggle off) vs POC session (toggle on), same persona/intensity/PRD, ~8–10 turns each.
3. Compare `meta.json` per-turn logs. Expected signature: baseline `inputAudio` grows superlinearly; POC `inputAudio` flat per turn, `inputText` growing linearly.
4. **Merge if:** total live cost down ≥ 3x on comparable sessions; median reconnect ≤ 2 s with no lost speech; persona retains memory of earlier turns and never re-greets; both end paths + evaluation + recording playback work in both modes.
5. **No-merge if:** quality regression, systematic lost speech, or savings < ~2x (output tokens dominating → complexity not paid for).
