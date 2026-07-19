import { useEffect, useMemo, useState } from 'react';
import type { ConversationResult } from '../lib/conversation';
import { liveCost, evalCost, formatUsd, formatDuration, type EvalUsage } from '../lib/cost';
import { SCORE_DIMENSIONS, type EvalReport } from '../lib/eval';
import type { SessionConfig } from '../personas/personas';
import type { Settings } from '../lib/settings';

export interface EvalState {
  status: 'running' | 'done' | 'error';
  report?: EvalReport;
  usage?: EvalUsage;
  message?: string;
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

  useEffect(() => {
    if (!result.recording) return;
    const url = URL.createObjectURL(result.recording);
    setRecordingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result.recording]);

  const liveCostVal = useMemo(() => liveCost(result.usage, settings.pricing), [result.usage, settings.pricing]);
  const evalCostVal = useMemo(
    () => (evalState.usage ? evalCost(evalState.usage, settings.pricing) : 0),
    [evalState.usage, settings.pricing],
  );
  const totalCost = liveCostVal + evalCostVal;
  const report = evalState.report;

  return (
    <div className="screen">
      <h2>Session complete</h2>
      <p className="muted">
        {config.persona.name} · {config.persona.title} · {config.intensity}
      </p>

      <div className="summary-tiles">
        <div className="tile">
          <span className="tile-label">Duration</span>
          <span className="tile-value">{formatDuration(result.durationSec)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Total cost</span>
          <span className="tile-value">{formatUsd(totalCost)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Voice / Eval</span>
          <span className="tile-value small">
            {formatUsd(liveCostVal)} / {formatUsd(evalCostVal)}
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
          <p className="muted">Analyzing your performance with {settings.evalModel}…</p>
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
                    {w.timestamp && <span className="ts-chip">{w.timestamp}</span>}
                    {w.point}
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
                    {w.timestamp && <span className="ts-chip">{w.timestamp}</span>}
                    {w.point}
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
          <span>Recording</span>
          <audio controls src={recordingUrl} className="audio-player" />
        </div>
      )}

      <details className="cost-breakdown">
        <summary>Cost breakdown (estimate)</summary>
        <table className="mini-table">
          <tbody>
            <tr><td>Voice — audio in</td><td>{result.usage.inputAudioTokens.toLocaleString()} tok</td></tr>
            <tr><td>Voice — audio out</td><td>{result.usage.outputAudioTokens.toLocaleString()} tok</td></tr>
            <tr><td>Voice — text in/out</td><td>{(result.usage.inputTextTokens + result.usage.outputTextTokens).toLocaleString()} tok</td></tr>
            {evalState.usage && (
              <tr><td>Eval — in/out</td><td>{(evalState.usage.inputTokens + evalState.usage.outputTokens).toLocaleString()} tok</td></tr>
            )}
          </tbody>
        </table>
        <small className="muted">Estimate from usage metadata × your pricing table. Cloud billing is authoritative.</small>
      </details>

      <details className="transcript-details">
        <summary>Full transcript ({result.transcript.length} turns)</summary>
        <div className="transcript">
          {result.transcript.map((t, i) => (
            <div key={i} className={`bubble ${t.role}`}>
              <span className="who">
                {t.role === 'user' ? 'You' : config.persona.name}
                {t.ts != null && <span className="bubble-ts">{formatDuration(t.ts)}</span>}
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
