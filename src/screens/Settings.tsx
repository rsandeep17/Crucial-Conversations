import { useState } from 'react';
import { saveSettings, type Settings } from '../lib/settings';

// A subset of the 30 prebuilt Live voices, enough to give personas distinct voices.
const VOICES = ['Charon', 'Puck', 'Kore', 'Fenrir', 'Aoede', 'Orus', 'Leda', 'Zephyr'];

export function SettingsScreen({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (s: Settings) => void;
}) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [liveModel, setLiveModel] = useState(settings.liveModel);
  const [evalModel, setEvalModel] = useState(settings.evalModel);
  const [voice, setVoice] = useState(settings.voice);
  const [warnCostUsd, setWarnCostUsd] = useState(settings.warnCostUsd);
  const [warnMinutes, setWarnMinutes] = useState(settings.warnMinutes);
  const [evalUseAudio, setEvalUseAudio] = useState(settings.evalUseAudio);
  const [usdToInr, setUsdToInr] = useState(settings.usdToInr);
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setSavedMsg(null);
    try {
      const updated = await saveSettings({ apiKey, liveModel, evalModel, voice, warnCostUsd, warnMinutes, evalUseAudio, usdToInr });
      onSaved(updated);
      setSavedMsg('Saved.');
    } catch (err) {
      setSavedMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <h2>Settings</h2>
      <p className="muted">
        Stored locally in <code>data/settings.json</code>. Your API key never leaves this machine
        except in direct calls to Google.
      </p>

      <label className="field">
        <span>Gemini API key</span>
        <div className="row">
          <input
            type={reveal ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIza…"
            autoComplete="off"
          />
          <button className="btn ghost" onClick={() => setReveal((r) => !r)}>
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>

      <label className="field">
        <span>Live (voice) model</span>
        <input value={liveModel} onChange={(e) => setLiveModel(e.target.value)} />
      </label>

      <label className="field">
        <span>Evaluation model</span>
        <input value={evalModel} onChange={(e) => setEvalModel(e.target.value)} />
        <small className="muted">
          Default is a Flash-tier model; switch to a Pro model here if a report ever reads shallow.
        </small>
      </label>

      <label className="field">
        <span>Default persona voice</span>
        <select value={voice} onChange={(e) => setVoice(e.target.value)}>
          {VOICES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <div className="two-col">
        <label className="field">
          <span>Warn at cost (USD)</span>
          <input
            type="number"
            step="0.05"
            min="0"
            value={warnCostUsd}
            onChange={(e) => setWarnCostUsd(Number(e.target.value))}
          />
          <small className="muted">Live ticker turns red past this. No cutoff.</small>
        </label>
        <label className="field">
          <span>Warn at duration (min)</span>
          <input
            type="number"
            step="1"
            min="0"
            value={warnMinutes}
            onChange={(e) => setWarnMinutes(Number(e.target.value))}
          />
          <small className="muted">A nudge appears past this. No cutoff.</small>
        </label>
      </div>

      <label className="field">
        <span>USD → INR rate</span>
        <input
          type="number"
          step="0.5"
          min="1"
          value={usdToInr}
          onChange={(e) => setUsdToInr(Number(e.target.value))}
        />
        <small className="muted">Costs are shown in rupees using this rate.</small>
      </label>

      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={evalUseAudio}
          onChange={(e) => setEvalUseAudio(e.target.checked)}
        />
        <span>
          Send my spoken audio to the evaluator
          <small className="muted"> — assesses delivery, pace, and tone, not just words. Adds ~$0.003/min.</small>
        </span>
      </label>

      <div className="controls">
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {savedMsg && <span className="muted">{savedMsg}</span>}
      </div>
    </div>
  );
}
