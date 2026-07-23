import { useState } from 'react';
import { customPersona, type Intensity, type SessionConfig } from '../personas/personas';

const INTENSITIES: { value: Intensity; label: string; hint: string }[] = [
  { value: 'collegial', label: 'Collegial', hint: 'Warm, patient, cooperative' },
  { value: 'challenging', label: 'Challenging', hint: 'Pushes back, follows up' },
  { value: 'hostile', label: 'Hostile', hint: 'Impatient, interrupts, heated' },
];

export function CustomSetup({
  onBack,
  onStart,
  voice,
}: {
  onBack: () => void;
  onStart: (config: SessionConfig) => void;
  /** Default Live voice for the invented counterpart (from Settings). */
  voice: string;
}) {
  const [situation, setSituation] = useState('');
  const [intensity, setIntensity] = useState<Intensity>('challenging');

  const canStart = situation.trim().length > 20;

  return (
    <div className="screen">
      <button className="btn ghost back" onClick={onBack}>
        ← Categories
      </button>
      <h2>Custom scenario — setup</h2>
      <p className="muted">
        Describe the conversation you want to rehearse — who you're talking to, what's at stake, and how they
        feel. The AI reads this, becomes that person, and opens the conversation.
      </p>

      <label className="field">
        <span>The situation</span>
        <textarea
          className="prd-input"
          value={situation}
          onChange={(e) => setSituation(e.target.value)}
          placeholder={
            'e.g. I need to tell my manager I\'m turning down the promotion they fought for, because I want to ' +
            'stay hands-on. They championed me to their boss and will feel let down. I want to be firm but not burn the relationship.'
          }
          rows={12}
        />
        <small className="muted">
          {situation.trim().length} characters{!canStart && ' — add a bit more so the AI has something to work with'}
        </small>
      </label>

      <div className="field">
        <span>Intensity</span>
        <div className="intensity-row">
          {INTENSITIES.map((i) => (
            <button
              key={i.value}
              className={`chip ${i.value === intensity ? 'selected' : ''}`}
              onClick={() => setIntensity(i.value)}
            >
              <strong>{i.label}</strong>
              <small>{i.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="notice">
        🎧 Use headphones so the AI doesn't hear itself. The conversation begins as soon as you connect.
      </div>

      <div className="controls">
        <button
          className="btn primary"
          disabled={!canStart}
          onClick={() =>
            onStart({ mode: 'custom', persona: customPersona(voice), intensity, prd: '', situation })
          }
        >
          Start conversation
        </button>
      </div>
    </div>
  );
}
