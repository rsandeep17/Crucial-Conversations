import { useState } from 'react';
import { PERSONAS, type Intensity, type SessionConfig } from '../personas/personas';

const INTENSITIES: { value: Intensity; label: string; hint: string }[] = [
  { value: 'collegial', label: 'Collegial', hint: 'Patient, gives you room' },
  { value: 'challenging', label: 'Challenging', hint: 'A normal tough review' },
  { value: 'hostile', label: 'Hostile', hint: 'Impatient, interrupts, skeptical' },
];

export function Setup({
  onBack,
  onStart,
}: {
  onBack: () => void;
  onStart: (config: SessionConfig) => void;
}) {
  const [prd, setPrd] = useState('');
  const [personaId, setPersonaId] = useState(PERSONAS[0].id);
  const [intensity, setIntensity] = useState<Intensity>('challenging');
  const [scenarioNote, setScenarioNote] = useState('');

  const persona = PERSONAS.find((p) => p.id === personaId)!;
  const canStart = prd.trim().length > 40;

  return (
    <div className="screen">
      <button className="btn ghost back" onClick={onBack}>
        ← Categories
      </button>
      <h2>PRD Review — setup</h2>

      <label className="field">
        <span>Your PRD (paste text or Markdown)</span>
        <textarea
          className="prd-input"
          value={prd}
          onChange={(e) => setPrd(e.target.value)}
          placeholder="Paste the PRD you want to defend. The persona will ground its questions in this exact content."
          rows={12}
        />
        <small className="muted">{prd.trim().length} characters{!canStart && ' — paste a bit more to begin'}</small>
      </label>

      <div className="field">
        <span>Who's reviewing?</span>
        <div className="persona-grid">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              className={`persona-card ${p.id === personaId ? 'selected' : ''}`}
              onClick={() => setPersonaId(p.id)}
            >
              <span className="persona-name">{p.name}</span>
              <span className="persona-title">{p.title}</span>
              <span className="persona-blurb">{p.blurb}</span>
              <span className="persona-voice">Voice: {p.voice}</span>
            </button>
          ))}
        </div>
      </div>

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

      <label className="field">
        <span>Scenario framing (optional)</span>
        <input
          value={scenarioNote}
          onChange={(e) => setScenarioNote(e.target.value)}
          placeholder="e.g. Second review — the last one went badly and you're skeptical of me."
        />
      </label>

      <div className="notice">
        🎧 Use headphones so {persona.name} doesn't hear itself. The meeting begins as soon as you connect.
      </div>

      <div className="controls">
        <button
          className="btn primary"
          disabled={!canStart}
          onClick={() => onStart({ persona, intensity, prd, scenarioNote })}
        >
          Start conversation
        </button>
      </div>
    </div>
  );
}
