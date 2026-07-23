# Hard Conversations Simulator — Master Plan

A local, personal-use web app for practicing hard, career-critical conversations — PRD walkthroughs under fire, telling engineers their idea is wrong, delivering bad news, scope-cut negotiations — using the Gemini Live API for real-time voice roleplay with adversarial-but-realistic personas, followed by a detailed written evaluation of how you did.

**Hypothesis being tested:** repeated, deliberate practice against realistic AI personas transfers to real meetings. Session history and per-skill score trends exist to measure exactly that.

---

## Guiding constraints

- **Fully local.** Nothing is hosted. A tiny server runs on your machine; the only traffic that leaves it is the direct browser → Google Gemini API calls. Not a product — a personal training tool.
- **Voice-first.** You speak, the persona speaks back in real time, with a live transcript alongside. Practicing verbal delivery — tone, pace, composure under interruption — is the point.
- **Honest evaluation.** A separate, stronger text model grades the transcript against a fixed rubric and *your own book notes* (e.g., *Never Split the Difference*), so feedback reflects the techniques you're actually trying to internalize.
- **Cost transparency.** Native-audio realtime is pricier than text models and sessions run for many minutes. Cost is visible live during the call, summarized after every session, and tracked cumulatively.
- **Everything saved locally, everything deletable.** Every session persists its transcript, evaluation report, full audio recording, and cost — as plain files you can inspect, back up, export, or delete.

## v1 scope (confirmed decisions)

| Decision | Choice |
|---|---|
| Interaction | Voice-first (mic in, persona voice out, live transcript) |
| First category | **PRD Review** — engineers/architects/senior leaders reacting to your PRD |
| Personas per session | One (multi-persona panel = future) |
| PRD input | Paste text / Markdown (PDF & .docx upload = future) |
| Evaluation | Separate analysis call to a Pro-tier text model with a fixed rubric |
| Book notes | Persistent "My Playbook" library, toggled per session, checked in evaluation |
| Recording | Full session audio (your mic + persona voice) saved per session |
| Persistence | All sessions saved locally as files; progress view in-app; Google Sheets export = future |
| Hosting | None — local server started by double-clicking `start.bat` |

## Technical foundation (verified July 2026)

- **Live voice model:** `gemini-3.1-flash-live-preview` (native audio; the current recommended Live model). 131k-token input context — persona prompt + a full pasted PRD fit comfortably in the system instruction.
- **Evaluation model:** `gemini-3.5-flash` (GA, 1M-token input) — a Flash-tier model is sufficient for a rubric-anchored critique. The eval model ID is **configurable in settings**, so `gemini-3.1-pro-preview` can be selected as a fallback if a report ever reads shallow. (Note: there is no `gemini-3.1-flash` text model — `gemini-3.1-flash-live-preview` is the voice model; `gemini-3.1-flash-lite` is too weak for critique.)
- **Browser connection:** official `@google/genai` JS SDK, `ai.live.connect(...)` over WebSocket directly from the browser. Direct API key use is acceptable for a personal local app (Google's own `live-api-web-console` starter does the same); the key is stored locally and never committed. **No agent framework** (ADK, Genkit, Agent Builder) — all are server-hosted and built for multi-agent orchestration we don't need; each would force a server proxy that breaks the "browser talks directly to Gemini" principle.
- **Audio pipeline:** mic captured via an AudioWorklet as 16-bit PCM @ 16 kHz; model output is PCM @ 24 kHz through a separate playback AudioContext. `getUserMedia` with `echoCancellation: true`, plus a headphones reminder in the UI, prevents the model from hearing itself.
- **Transcripts built in:** enabling `inputAudioTranscription` / `outputAudioTranscription` in the connect config makes both sides of the conversation arrive as text — no separate speech-to-text step.
- **Long sessions:** audio sessions cap at ~15 min and the WebSocket at ~10 min, but `contextWindowCompression` (sliding window) + `sessionResumption` handles + reacting to the server's `GoAway` message make 10–30 minute practice sessions seamless.
- **Barge-in:** server-side VAD interrupts the persona when you speak; on the `interrupted` signal the local playback queue is flushed. Interruptions — a core part of hard conversations — are realistic in both directions.
- **Persona voice + character:** per-session `systemInstruction` + 30 prebuilt voices (`speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`) — each persona gets a distinct voice.
- **Usage/cost data:** Live API messages include `usageMetadata` with per-modality token counts (audio-in, text-in, audio-out); the evaluation call returns its own. The app multiplies these by an **editable pricing table in settings** (preview pricing changes; exact rates filled in from the official pricing page during implementation).
- **Session recording:** mic source and the model's playback node are mixed into a Web Audio `MediaStreamDestination` and captured with `MediaRecorder` → one `.webm` (Opus) file per session. Pure client-side, zero API cost.
- **Reference implementation** for audio patterns: `google-gemini/live-api-web-console` (GitHub).

## Architecture

```
HardConversations/
├── plan.md                  ← this document
├── start.bat                ← double-click: installs deps if needed, starts server, opens browser
├── server.js                ← single-file Node/Express server
├── package.json
├── data/                    ← all persistence, plain human-readable files
│   ├── settings.json        ← API key, model choices, voice defaults, pricing table
│   ├── playbook/            ← one .md file per notes source ("never-split-the-difference.md", …)
│   └── sessions/            ← one folder per session: transcript.json, evaluation.md,
│                              recording.webm, meta.json (persona, scores, tokens, cost)
└── app/                     ← front-end (Vite + React)
    └── src/
        ├── lib/audio/       ← AudioWorklet mic capture, 24 kHz playback queue w/ flush, recorder
        ├── lib/live.ts      ← Live API session wrapper (connect, resumption, GoAway, transcripts)
        ├── lib/eval.ts      ← evaluation call with rubric prompt
        ├── personas/        ← persona definitions (data, not code — easy to add more)
        ├── scenarios/       ← category/scenario definitions (v1: PRD Review; others stubbed)
        └── screens/         ← Home, Setup, Live Session, Report, Playbook, History, Settings
```

**Why a small Node server instead of browser-only storage:** sessions and playbook notes persist as real files on disk — readable, backupable, and trivially exportable to CSV/Google Sheets later (an explicitly anticipated need). The server only serves the front-end and exposes tiny `/api/settings`, `/api/playbook`, `/api/sessions` read/write endpoints to `data/`. All Gemini traffic goes browser → Google directly. Prerequisite: Node.js installed (`start.bat` checks and explains if missing).

## Product design

### Home — categories
Card grid of conversation categories. v1: **PRD Review** is live; Bad News Delivery, Scope Cut Negotiation, Cross-functional Alignment, Sales Enablement, Big Client Demo, and Kill-a-Feature Meeting render as "coming soon" cards so the frame for the larger vision exists from day one.

### Session setup (PRD Review)
1. **Context:** paste your PRD (text/Markdown) into a large editor; saved with the session record.
2. **Persona picker** — v1 ships with five, each a data file (system-instruction template + voice + temperament):
   - *The Skeptical Staff Engineer* — pokes holes in feasibility and edge cases; "have you thought about…"
   - *The Cost-Conscious Architect* — challenges infra choices, scale assumptions, build-vs-buy.
   - *The Blunt Engineering Manager* — questions priorities, team impact, timeline realism; interrupts.
   - *The Quiet-then-Devastating Principal* — long silences, then one question that unravels the doc.
   - *The Supportive-but-Rigorous Tech Lead* — a realistic ally; the non-adversarial baseline.
3. **Intensity dial:** Collegial / Challenging / Hostile — injected into the persona prompt.
4. **Scenario framing** (optional free text): e.g., "second review; the last meeting went badly."
5. **Playbook toggles:** choose which notes files apply to this session's evaluation.
6. Headphones reminder + mic check, then Start.

### Live session
- Timer, persona name/avatar, live two-sided transcript.
- **Live cost ticker** — running token counts × pricing table, visible during the call so you can decide when to wrap up.
- Mute / push-to-talk option (manual VAD) for noisy environments.
- The persona asks questions grounded in the *actual pasted PRD*, pushes back, and interrupts.
- "End conversation" → optionally let the persona close naturally ("any final concerns?") first.
- Under the hood: session resumption on `GoAway`, context compression, playback flush on interruption, continuous recording.

### Evaluation report (after every session)
One call to the evaluation model with the full transcript, the PRD, the persona/scenario definition, your selected playbook notes, and a fixed rubric. Rendered in-app and saved as `evaluation.md` + structured scores in `meta.json`:

- **What went well** — with quoted transcript moments.
- **What went wrong / missed opportunities** — quoted, each with what a stronger response would have been.
- **Scores (1–5) on six stable dimensions** (trendable across sessions): clarity & structure, handling objections, composure/defensiveness, listening & acknowledging, conciseness, driving to commitment.
- **Playbook adherence** — per selected notes file: where techniques (mirroring, labeling, calibrated questions, …) were used, missed, or misused.
- **What to practice next** + **2–3 follow-up challenges** (harder persona, same PRD at hostile intensity, a targeted weakness drill) — each a one-click "start this session" button.
- **Cost summary** — token breakdown and dollar cost for the live call and the evaluation call, plus duration.
- **Recording player** — replay the session audio inline; delete the recording (or the whole session) from disk.

### My Playbook
Add/edit markdown notes per book or source in-app (stored in `data/playbook/`); toggle which apply per session. The evaluation prompt receives your raw notes verbatim, so feedback reflects *your* framing of the techniques, not the model's generic knowledge of the book.

### History & progress
All past sessions (date, category, persona, intensity, scores, duration, cost) with per-dimension trend sparklines, recurring "practice next" themes, and **cumulative spend** (monthly and all-time). Each row links to its recording and report, with delete controls. CSV export (for Google Sheets tracking) is a natural early add since everything is already structured JSON on disk.

## Milestones & status

> Legend: ✅ done · 🟡 in progress / partially done · ⬜ not started. "build-verified" = compiles and runs; "user-verified" = confirmed working in a real live session.

1. ✅ **M1 — Skeleton & voice proof:** scaffold, `start.bat`, server, settings screen (API key), and a bare live-voice loop — talk to the model, hear it back, see the transcript. **DONE, user-verified.**
2. ✅ **M2 — PRD Review session:** setup screen, persona definitions, system-instruction assembly, live session screen with timer/end flow, audio recording + usage/cost capture, session saved to `data/sessions/`. **DONE, build-verified; live-voice run pending user verification.**
   - ✅ **M2+ — extras:** persona natural wrap-up via `end_meeting` tool; soft cost/time guardrail (warn thresholds, never cuts off). **DONE, build-verified.**
   - *Note:* the live screen intentionally shows **no live transcript** (found distracting) — a Zoom-like two-avatar stage with audio-reactive glow rings replaced it. Full transcript appears afterward on the summary. This diverges from the original "live transcript alongside" design above.
3. ✅ **M3 — Evaluation:** rubric prompt, eval call (scores on 6 dimensions + quoted, timestamp-anchored strengths/gaps + practice-next + follow-up challenges), report screen with cost summary + seekable recording player, persistence as `evaluation.md`. **DONE, build-verified; evaluation quality unproven on a real transcript.**
4. 🟡 **M4 — Playbook + more scenario types:** **partial.**
   - ✅ **Custom Scenario mode — DONE, build-verified.** A second, always-available card on Home: describe *any* conversation (not just PM work) in a free-text box; the Live model reads the situation, invents the fitting counterpart, and opens the conversation in character. The only other control is intensity (no persona picker — the AI imagines the other party). The counterpart uses the default voice from Settings; the AI can wrap up naturally via `end_meeting`. After the session, a **generic communication evaluation** runs (same 6 trendable dimensions, situation-aware prompt) instead of the PRD rubric. Live-voice run pending user verification.
   - ⬜ **Playbook** — notes library CRUD, per-session toggles, playbook-adherence section in the eval. **NOT STARTED.**
5. ⬜ **M5 — History & next challenges:** history screen, score trends, one-click follow-up challenges. **NOT STARTED** (follow-up challenges are generated by the eval but not yet wired to launch a session).
6. 🟡 **M6 — Polish & resilience:** **partial.** ✅ auto-finalize on unexpected disconnect; ✅ readable IST session folders; ✅ light/dark themes; ✅ ₹/INR cost display; ✅ seekable WAV recording. ⬜ still pending: reconnection/resumption on `GoAway` (handles are captured but reconnect isn't built), push-to-talk, in-app pricing-table editor, CSV export, coming-soon cards, PDF/.docx PRD upload.

Each milestone ends usable — after M2 the tool is already worth practicing with, even before evaluations exist.

### What works today (summary)

Two ways in from Home: **PRD Review** (paste a PRD → pick one of 5 personas + intensity) or **Custom Scenario** (describe any conversation + intensity; the AI invents the counterpart). Either way → hold a real-time spoken conversation (AI opens, barge-in works, soft cost/time nudge) → end manually or let the AI wrap up → session saved locally (transcript, seekable WAV, cost in ₹, duration) → automatic written evaluation renders on the summary (PRD rubric or generic-comms rubric per mode). See `CLAUDE.md` for the authoritative "what exists now" detail.

### Known gaps / pending

- No reconnection yet (Live socket caps ~10–15 min; unexpected close auto-finalizes rather than resuming).
- Evaluation quality not yet validated against a real live transcript.
- No Playbook (M4), no History/trends screen (M5).
- No in-app pricing-table editor (rates hand-edited in `data/settings.json`); no PDF/.docx PRD upload (paste-only).

## Cost optimization backlog

Native-audio realtime is the dominant cost, and the Live API **re-bills the full cumulative context every turn with prior turns retained as audio** — so cost grows superlinearly with conversation length. Ideas to bring this down:

0. **✅ Eval model & thinking level (DONE — see [`docs/eval-cost-decision.md`](docs/eval-cost-decision.md)).** Swapped eval to `gemini-3.5-flash-lite` at `thinkingLevel: LOW` (was `gemini-3.5-flash` at default MEDIUM) — ~6× cheaper per eval, ~₹2.95 → ~₹0.49. The decision doc records the token/thinking-cost analysis so it doesn't need re-deriving. Both model and thinking level are Settings-configurable.
1. **🔬 Text-history reconnect (POC planned — see [`docs/poc-text-history-reconnect.md`](docs/poc-text-history-reconnect.md)).** At each turn boundary, reconnect a fresh Live session seeding prior turns as **text** (from the free two-sided transcripts) so only the *current* turn is billed as audio. Research verdict: sound and implementable via `sendClientContent({ turns, turnComplete: false })`; history component ~25–30x cheaper, realistic total session savings ~2–5x (output audio is unaffected). To be built behind a default-OFF settings toggle on branch `poc/text-history-reconnect`, A/B-measured, merged only if cost drops ≥3x with acceptable latency/quality. **Status: PLANNED, not started.**
2. **⬜ Already in place (safety net, not a saver):** `contextWindowCompression` sliding-window caps runaway context but *discards* old turns (persona forgets) — kept enabled but it's a cap, not an optimization.
3. **⬜ Future ideas:** shorter default personas/PRD framing to shrink the per-turn system-instruction cost; a cheaper voice model if/when Google ships one; per-turn token budget that suggests wrapping up.

## Verification per milestone

- **M1:** run `start.bat`, grant mic, hold a 2-minute conversation; audio both ways, transcript renders both sides, no self-interruption (echo cancellation on, and with headphones).
- **M2:** paste a real PRD, run a session with the Skeptical Staff Engineer; questions must reference actual PRD content (not generic), interruptions work, the session folder contains a playable `recording.webm` with both voices, and reported token counts/cost roughly match the Google AI Studio usage dashboard.
- **M3–M4:** the report quotes real transcript moments and correctly cites techniques from your pasted *Never Split the Difference* notes.
- **M5:** after 3+ sessions, trends render and a follow-up challenge launches pre-configured.
- **Long-session test:** run past 10 minutes; GoAway/resumption must keep the conversation seamless.

## Future scope (explicitly not v1)

PDF/.docx upload (pdf.js / mammoth.js), the remaining conversation categories, multi-persona panel mode, Google Sheets export/sync, ephemeral-token auth if ever exposed beyond localhost, optional webcam capture for delivery/body-language review, monthly budget alerts on cumulative spend.
