# CLAUDE.md — current state of this repo

> **What this file is:** the ground truth for what this project *is and does today* — how to run it, how it's built, and how a practice session actually works. Read this to get oriented fast.
>
> **What `plan.md` is:** the product vision, milestone roadmap, and future scope — where this is *going*. If something here contradicts `plan.md`, this file wins for "what exists now"; `plan.md` wins for "what's intended."
>
> Rule of thumb: a fact that the code makes true lives here; an aspiration lives in `plan.md`.

## What this is

A **local, single-user web app** for rehearsing hard product-management conversations by voice. You paste a PRD, pick an adversarial-but-realistic AI persona (e.g., a skeptical staff engineer), and hold a real-time spoken conversation powered by the Gemini Live API. When you end it, the session (transcript, audio recording, cost, duration) is saved locally. A written evaluation of your performance is planned but not yet built (see Status).

It is **not hosted and not a product** — it runs on the user's machine; the only network traffic that leaves the machine is direct calls to Google's Gemini API.

## How to run

1. Install [Node.js](https://nodejs.org/) LTS (only prerequisite).
2. Double-click **`start.bat`** (Windows). It installs dependencies on first run, starts the dev server, and opens `http://localhost:5173`.
3. In **Settings**, paste your Gemini API key (stored locally in `data/settings.json`, never committed).
4. Use **headphones** — otherwise the model hears its own voice through the speakers and interrupts itself.

Dev commands: `npm run dev` (serve), `npm run typecheck` (tsc, no emit), `npm run build`.

## Architecture

- **Front-end:** Vite 8 + React 19 + TypeScript. Entry `src/main.tsx` → `src/App.tsx` (a simple view-state router: home → setup → live → summary, plus settings).
- **Local file API:** there is **no separate backend**. `server/apiPlugin.ts` is a Vite plugin that adds `/api/*` routes to the dev server for reading/writing the `data/` folder. One process, one command.
- **Gemini access:** the browser talks **directly** to the Live API via the `@google/genai` SDK (`src/lib/live.ts`). No agent framework (ADK/Genkit) — those are server-hosted and would force a proxy, breaking the local-only design.

Key modules:

| Path | Responsibility |
|---|---|
| `src/lib/live.ts` | Live API session wrapper: connect, two-sided transcription, audio out, interruption + usage callbacks, session-resumption capture. |
| `src/lib/conversation.ts` | Orchestrates one session: mic capture, playback, recording, transcript buffering, usage tracking. The screens use this. |
| `src/lib/audio/AudioRecorder.ts` | Mic capture → 16 kHz PCM via an AudioWorklet (`public/worklets/pcm-recorder-processor.js`). |
| `src/lib/audio/AudioStreamer.ts` | Plays the model's 24 kHz PCM output; flushes on barge-in. |
| `src/lib/audio/SessionRecorder.ts` | Taps the mixed audio graph with an AudioWorklet → **seekable `.wav`** (client-side, no API cost). WAV, not MediaRecorder `.webm`, so the player can jump to any timestamp. |
| `src/lib/cost.ts` | Token→USD math + `LiveUsageTracker` (handles cumulative usage metadata). |
| `src/lib/sessionStore.ts` | Client for saving sessions to `/api/sessions`. |
| `src/personas/personas.ts` | The 5 personas + intensity modifiers + `buildSystemInstruction()`. |
| `src/screens/*` | Home, Setup, LiveSession, Summary, Settings. |

## How a practice session works (the important part)

1. **Setup:** you paste a PRD, choose a persona and an intensity (Collegial / Challenging / Hostile), and optionally add a scenario note.
2. **Prompt assembly:** `buildSystemInstruction()` builds ONE system-instruction string = framing + the persona's character text + the intensity modifier + behavior rules + your scenario note + your full PRD (verbatim). There is **no pre-generated question list** — the model improvises in character, grounded in the PRD that sits in its context.
3. **Who speaks first:** the **persona** opens the meeting (the behavior rules instruct it to greet and raise its first concern without waiting).
4. **Turn-taking:** automatic, via the Live API's server-side voice-activity detection. Stop talking → the persona responds. Talk over it → it stops (barge-in). No turn counter. **During the call there is NO live transcript** (it was distracting) — instead a Zoom-like stage shows two avatars (you + the persona) whose glow rings react to real mic/model audio levels. The full transcript appears only afterward on the summary.
5. **Ending:** two ways. (a) You click "End conversation" anytime. (b) The persona wraps up naturally: it's instructed to close once it has pressure-tested the key decisions, then it calls an `end_meeting` function tool; the app lets the closing line finish playing, then ends. A **soft guardrail** (Settings: warn-at-cost and warn-at-minutes) turns the live cost/time meters red and shows a nudge when exceeded — it never cuts you off.
6. **On end:** the session is saved to `data/sessions/<id>/`, then an **evaluation** runs automatically (`gemini-3.5-flash` over the transcript + PRD, and — unless disabled in Settings — the user's spoken audio as WAV, so delivery/tone is judged too): scores on 6 dimensions, plus what went well / what to improve where **each point is anchored to the actual exchange** (the persona's line, the user's verbatim words, and a timestamp), what to practice next, and follow-up challenges. The report renders on the summary screen and is saved as `evaluation.md` (scores + eval cost merged into `meta.json`). The summary shows **duration and total cost (voice + eval)**. Transcript turns carry timestamps.

## Data layout

```
data/
├── settings.json              # api key, model ids, voice, pricing table, warn thresholds
└── sessions/<id>/              # id = "YYYY-MM-DD HH-MM-SS" in IST (readable, 24h)
    ├── meta.json              # persona, intensity, prd, duration, usage, cost, scores
    ├── transcript.json        # [{ role: 'user'|'persona', text }]
    ├── evaluation.md          # rendered evaluation report
    └── recording.wav          # mixed conversation audio (seekable WAV)
```
`data/` is git-ignored (it contains your API key and recordings).

## Models & cost

- **Live voice:** `gemini-3.1-flash-live-preview` (native audio).
- **Evaluation:** `gemini-3.5-flash` (configurable in Settings), one `generateContent` call per session with a JSON-schema structured response.
- **Pricing table** (USD per 1M tokens, editable in Settings; defaults from ai.google.dev pricing, July 2026): live audio in $3 / out $12, text in $0.75 / out $4.50; eval in $1.50 / out $9.
- Cost shown in-app is an **estimate** derived from the Live API's `usageMetadata`. **Important billing mechanic:** the Live API re-bills the full cumulative context every turn (prior audio is kept as tokens), and each server message is a per-turn snapshot — so the app **sums every snapshot's per-modality tokens** (`LiveUsageTracker` in `src/lib/cost.ts`). Summing matches Cloud billing within ~a few percent; taking the max/last value undercounts by ~2-4x (that was a real early bug). Eval audio input is billed at the normal input rate (~$0.003/min). **Google Cloud billing is authoritative.**
- **Cost is displayed in ₹ (INR)** via a `usdToInr` rate in Settings (default 85). The summary's cost-breakdown accordion shows tokens **and** ₹ cost per line (voice audio in/out, voice text, eval in/out) plus a total.

## UI / theming

- **Light and dark themes**, driven by `<html data-theme>` set in `App.tsx` (persisted to `localStorage`, defaults to the OS `prefers-color-scheme`). A toggle sits in the top bar. All colors are semantic CSS variables defined for both themes in `src/styles.css` — never hardcode a hex in a component; add/extend a variable.
- While the evaluation runs, the summary shows an animated progress bar with rotating status messages.
- In the report, every feedback point's **timestamp is a button** that seeks the session recording and plays from that moment (a duration-fix nudge works around MediaRecorder `.webm` files not reporting duration). Transcript turn timestamps are clickable the same way.

## Status

- **M1 (voice loop) — DONE, user-verified.**
- **M2 (PRD Review session: setup, 5 personas, live session, recording, cost/duration, persistence) — DONE, build-verified; live-voice run pending user verification.**
- **M2+ (persona natural wrap-up via `end_meeting` tool; soft cost/time guardrail) — DONE, build-verified.**
- **M3 (auto evaluation report: scores, strengths/gaps with quotes, next steps; saved as `evaluation.md`) — DONE, build-verified; not yet run against a real live session.**
- M4 playbook, M5 history/trends, M6 resilience/polish — see `plan.md`.

## Known limitations (today)

- **Pricing table has no in-app editor yet.** Rates ship with correct defaults and are read from `data/settings.json`; to change them, hand-edit that file (or add a Settings UI). Warn thresholds (cost/minutes) ARE editable in Settings.
- **No reconnection yet.** The Live API caps audio sessions (~15 min) and will close the socket; resumption handles are captured but reconnection isn't implemented yet (M6). However, an unexpected close now **auto-finalizes** the session (saves + evaluates what we have, marked `endedBy: 'disconnect'`) rather than losing it. `StrictMode` is intentionally OFF (`main.tsx`) because its dev double-mount raced the async Live connect and left an orphaned, still-billing session — the root cause of a spurious "operation was aborted" banner + inflated cost.
- **Evaluation quality is unproven on real transcripts** — the prompt/rubric exists and is structured, but hasn't been run against an actual live session yet.
- **Auto-start on connect** relies on the browser carrying the Setup click through the screen transition; if the persona ever fails to start talking, an explicit "Begin" button is the fix.
- **Clickable-timestamp seeking** now uses a seekable WAV recording (was flaky on webm). Report/transcript timestamps seek the player and play from there. Alignment is approximate (recording starts a beat after the session clock).
- **PRD input is paste-only** (no PDF/docx upload yet).
- **No in-app pricing-table editor** — rates live in `data/settings.json` (defaults correct); the `usdToInr`, warn thresholds, and audio-eval toggle ARE editable in Settings.
