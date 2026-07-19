import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationResult } from '../lib/conversation';
import { liveCost, evalCost, formatInr, formatDuration, type EvalUsage } from '../lib/cost';
import { SCORE_DIMENSIONS, type EvalReport } from '../lib/eval';
import type { SessionConfig } from '../personas/personas';
import type { Settings } from '../lib/settings';

export interface EvalState {
  status: 'running' | 'done' | 'error';
  report?: EvalReport;
  usage?: EvalUsage;
  message?: string;
}

const EVAL_MESSAGES = [
  'Listening back to your delivery…',
  'Reading the transcript against your PRD…',
  'Scoring clarity, composure, and how you handled pushback…',
  'Finding the exact moments that mattered…',
  'Writing up what to practice next…',
];

/** Parse "m:ss" or "h:mm:ss" (or a plain number) into seconds. */
function parseTimestamp(ts?: string | number): number | null {
  if (ts == null) return null;
  if (typeof ts === 'number') return ts;
  const parts = ts.trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function Summary({
  result,
  config,
  settings,
  saveState,
  evalState,
  onDone,
  onPracticeAgain,
}: {
  result: ConversationResult;
  config: SessionConfig;
  settings: Settings;
  saveState: { status: 'saving' | 'saved' | 'error'; message?: string };
  evalState: EvalState;
  onDone: () => void;
  onPracticeAgain: () => void;
}) {
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  // MediaRecorder .webm blobs often report duration=Infinity, which blocks
  // seeking. Nudge the browser to compute the real duration once loaded.
  const fixDuration = () => {
    const a = audioRef.current;
    if (!a || (a.duration !== Infinity && !Number.isNaN(a.duration))) return;
    const onUpdate = () => {
      a.currentTime = 0;
      a.removeEventListener('timeupdate', onUpdate);
    };
    a.addEventListener('timeupdate', onUpdate);
    a.currentTime = 1e101; // forces the browser to scan to the end
  };

  const seekTo = (seconds: number | null) => {
    const a = audioRef.current;
    if (!a || seconds == null) return;
    a.currentTime = seconds;
    a.play().catch(() => {});
    a.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    if (!result.recording) return;
    const url = URL.createObjectURL(result.recording);
    setRecordingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result.recording]);

  // Rotate encouraging status messages while the evaluation runs.
  useEffect(() => {
    if (evalState.status !== 'running') return;
    const id = setInterval(() => setProgressMsg((i) => (i + 1) % EVAL_MESSAGES.length), 2600);
    return () => clearInterval(id);
  }, [evalState.status]);

  const liveCostVal = useMemo(() => liveCost(result.usage, settings.pricing), [result.usage, settings.pricing]);
  const evalCostVal = useMemo(
    () => (evalState.usage ? evalCost(evalState.usage, settings.pricing) : 0),
    [evalState.usage, settings.pricing],
  );
  const totalCost = liveCostVal + evalCostVal;
  const report = evalState.report;
  const rate = settings.usdToInr;
  const p = settings.pricing;
  const u = result.usage;

  // Per-line cost rows for the breakdown (USD, converted to ₹ on render).
  const costRows: { label: string; tokens: number; usd: number }[] = [
    { label: 'Voice · audio in', tokens: u.inputAudioTokens, usd: (u.inputAudioTokens * p.liveAudioInput) / 1e6 },
    { label: 'Voice · audio out', tokens: u.outputAudioTokens, usd: (u.outputAudioTokens * p.liveAudioOutput) / 1e6 },
    {
      label: 'Voice · text',
      tokens: u.inputTextTokens + u.outputTextTokens,
      usd: (u.inputTextTokens * p.liveTextInput + u.outputTextTokens * p.liveTextOutput) / 1e6,
    },
  ];
  if (evalState.usage) {
    costRows.push({ label: 'Eval · input', tokens: evalState.usage.inputTokens, usd: (evalState.usage.inputTokens * p.evalInput) / 1e6 });
    costRows.push({ label: 'Eval · output', tokens: evalState.usage.outputTokens, usd: (evalState.usage.outputTokens * p.evalOutput) / 1e6 });
  }

  return (
    <div className="screen">
      <h2>Session complete</h2>
      <p className="muted">
        {config.persona.name} · {config.persona.title} · {config.intensity}
      </p>
      {result.endedBy === 'persona' && (
        <p className="end-note">🧑‍⚖️ {config.persona.name} wrapped up the meeting when they felt they'd made their point.</p>
      )}
      {result.endedBy === 'disconnect' && (
        <p className="end-note warn">
          ⚠︎ The live connection dropped, so the session was saved up to that point. This can happen on a
          network blip or the Live API's session limit.
        </p>
      )}

      <div className="summary-tiles">
        <div className="tile">
          <span className="tile-label">Duration</span>
          <span className="tile-value">{formatDuration(result.durationSec)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Total cost</span>
          <span className="tile-value">{formatInr(totalCost, rate)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Voice / Eval</span>
          <span className="tile-value small">
            {formatInr(liveCostVal, rate)} / {formatInr(evalCostVal, rate)}
          </span>
        </div>
      </div>

      <div className="save-state">
        {saveState.status === 'saving' && <span className="muted">Saving session…</span>}
        {saveState.status === 'saved' && <span className="muted">✓ Saved locally with recording.</span>}
        {saveState.status === 'error' && <span className="error-inline">Save failed: {saveState.message}</span>}
      </div>

      {/* Evaluation */}
      <section className="eval">
        <h3>Evaluation</h3>
        {evalState.status === 'running' && (
          <div className="eval-progress">
            <div className="progress-track">
              <div className="progress-fill" />
            </div>
            <p className="progress-msg">{EVAL_MESSAGES[progressMsg]}</p>
          </div>
        )}
        {evalState.status === 'error' && (
          <div className="error-box">Evaluation failed: {evalState.message}</div>
        )}
        {report && (
          <>
            <p className="eval-summary">{report.summary}</p>

            <div className="scores">
              {SCORE_DIMENSIONS.map((d) => {
                const v = report.scores[d.key] ?? 0;
                return (
                  <div className="score-row" key={d.key} title={d.hint}>
                    <span className="score-label">{d.label}</span>
                    <span className="score-bar">
                      <span className="score-fill" style={{ width: `${(v / 5) * 100}%` }} />
                    </span>
                    <span className="score-num">{v}/5</span>
                  </div>
                );
              })}
            </div>

            <h4>What went well</h4>
            <ul className="eval-list">
              {report.wentWell.map((w, i) => (
                <li key={i}>
                  <div className="point-head">
                    {w.timestamp && (
                      <button
                        className="ts-chip"
                        onClick={() => seekTo(parseTimestamp(w.timestamp))}
                        title="Play the recording from here"
                      >
                        {w.timestamp}
                      </button>
                    )}
                    <span>
                      {w.pattern && <strong className="pattern">{w.pattern} — </strong>}
                      {w.point}
                    </span>
                  </div>
                  {(w.personaQuote || w.userQuote) && (
                    <div className="exchange">
                      {w.personaQuote && (
                        <div className="ex-line ex-persona">
                          <span className="ex-who">{config.persona.name}</span> "{w.personaQuote}"
                        </div>
                      )}
                      {w.userQuote && (
                        <div className="ex-line ex-user">
                          <span className="ex-who">You</span> "{w.userQuote}"
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <h4>What to improve</h4>
            <ul className="eval-list">
              {report.wentWrong.map((w, i) => (
                <li key={i}>
                  <div className="point-head">
                    {w.timestamp && (
                      <button
                        className="ts-chip"
                        onClick={() => seekTo(parseTimestamp(w.timestamp))}
                        title="Play the recording from here"
                      >
                        {w.timestamp}
                      </button>
                    )}
                    <span>
                      {w.pattern && <strong className="pattern">{w.pattern} — </strong>}
                      {w.point}
                    </span>
                  </div>
                  {(w.personaQuote || w.userQuote) && (
                    <div className="exchange">
                      {w.personaQuote && (
                        <div className="ex-line ex-persona">
                          <span className="ex-who">{config.persona.name}</span> "{w.personaQuote}"
                        </div>
                      )}
                      {w.userQuote && (
                        <div className="ex-line ex-user">
                          <span className="ex-who">You</span> "{w.userQuote}"
                        </div>
                      )}
                    </div>
                  )}
                  {w.better && <div className="better">Stronger: {w.better}</div>}
                </li>
              ))}
            </ul>

            <h4>Practice next</h4>
            <p>{report.practiceNext}</p>

            <h4>Follow-up challenges</h4>
            <ul className="eval-list">
              {report.followUps.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      {recordingUrl && (
        <div className="field">
          <span>Recording {report && '— click any timestamp above to jump here'}</span>
          <audio
            ref={audioRef}
            controls
            src={recordingUrl}
            className="audio-player"
            onLoadedMetadata={fixDuration}
          />
        </div>
      )}

      <details className="cost-breakdown">
        <summary>Cost breakdown (estimate)</summary>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Tokens</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {costRows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">{r.tokens.toLocaleString()}</td>
                <td className="num">{formatInr(r.usd, rate)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td className="num">{u.totalTokens.toLocaleString()}</td>
              <td className="num">{formatInr(totalCost, rate)}</td>
            </tr>
          </tbody>
        </table>
        <small className="muted">
          Estimate from usage metadata × your pricing table, converted at ₹{rate}/$. Cloud billing is
          authoritative.
        </small>
      </details>

      <details className="transcript-details">
        <summary>Full transcript ({result.transcript.length} turns)</summary>
        <div className="transcript">
          {result.transcript.map((t, i) => (
            <div key={i} className={`bubble ${t.role}`}>
              <span className="who">
                {t.role === 'user' ? 'You' : config.persona.name}
                {t.ts != null && (
                  <button className="bubble-ts" onClick={() => seekTo(t.ts ?? null)} title="Play from here">
                    {formatDuration(t.ts)}
                  </button>
                )}
              </span>
              <span className="what">{t.text}</span>
            </div>
          ))}
        </div>
      </details>

      <div className="controls">
        <button className="btn primary" onClick={onPracticeAgain}>
          Practice again
        </button>
        <button className="btn" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
