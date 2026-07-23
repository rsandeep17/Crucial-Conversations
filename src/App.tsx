import { useEffect, useState } from 'react';
import { loadSettings, type Settings } from './lib/settings';
import { liveCost, evalCost } from './lib/cost';
import { createSession, uploadRecording, updateSession, type SessionMeta } from './lib/sessionStore';
import { evaluateSession, reportToMarkdown } from './lib/eval';
import { arrayBufferToBase64 } from './lib/audio/pcm';

// Gemini's inline cap (~20 MB) applies to the base64-encoded request, which is
// ~1.33x the raw bytes — so keep the raw WAV under ~14 MB (~7 min of speech).
// Longer sessions fall back to a transcript-only evaluation.
const MAX_INLINE_AUDIO_BYTES = 14 * 1024 * 1024;
import type { SessionConfig, SessionMode } from './personas/personas';
import type { ConversationResult } from './lib/conversation';
import { Home } from './screens/Home';
import { Setup } from './screens/Setup';
import { CustomSetup } from './screens/CustomSetup';
import { LiveSession } from './screens/LiveSession';
import { Summary, type EvalState } from './screens/Summary';
import { SettingsScreen } from './screens/Settings';

type View = 'home' | 'setup' | 'live' | 'summary' | 'settings';
type SaveState = { status: 'saving' | 'saved' | 'error'; message?: string };

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>('home');
  const [mode, setMode] = useState<SessionMode>('prd-review');
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [result, setResult] = useState<ConversationResult | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'saving' });
  const [evalState, setEvalState] = useState<EvalState>({ status: 'running' });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    loadSettings()
      .then((s) => {
        setSettings(s);
        if (!s.apiKey) setView('settings');
      })
      .catch((e) => setLoadError((e as Error).message));
  }, []);

  const persistAndEvaluate = async (r: ConversationResult, c: SessionConfig, s: Settings) => {
    setSaveState({ status: 'saving' });
    setEvalState({ status: 'running' });

    const liveCostVal = liveCost(r.usage, s.pricing);
    const meta: SessionMeta = {
      createdAt: new Date().toISOString(),
      category: c.mode,
      personaId: c.persona.id,
      personaName: c.persona.name,
      personaTitle: c.persona.title,
      intensity: c.intensity,
      scenarioNote: c.scenarioNote,
      prd: c.prd,
      situation: c.situation,
      durationSec: r.durationSec,
      endedBy: r.endedBy,
      usage: { live: r.usage },
      cost: { live: liveCostVal, total: liveCostVal },
    };

    let id: string | null = null;
    try {
      id = await createSession(meta, r.transcript);
      if (r.recording) await uploadRecording(id, r.recording);
      setSaveState({ status: 'saved' });
    } catch (err) {
      setSaveState({ status: 'error', message: (err as Error).message });
    }

    // Evaluation runs even if the recording upload hiccuped, as long as we have an id.
    try {
      let audio: { data: string; mimeType: string } | undefined;
      if (s.evalUseAudio && r.userAudio && r.userAudio.size <= MAX_INLINE_AUDIO_BYTES) {
        audio = { data: arrayBufferToBase64(await r.userAudio.arrayBuffer()), mimeType: 'audio/wav' };
      }
      const { report, usage } = await evaluateSession({
        apiKey: s.apiKey,
        model: s.evalModel,
        mode: c.mode,
        prd: c.prd,
        situation: c.situation,
        personaName: c.persona.name,
        personaTitle: c.persona.title,
        intensity: c.intensity,
        scenarioNote: c.scenarioNote,
        transcript: r.transcript,
        audio,
      });
      setEvalState({ status: 'done', report, usage });

      if (id) {
        const evalCostVal = evalCost(usage, s.pricing);
        await updateSession(
          id,
          {
            usage: { live: r.usage, eval: usage },
            cost: { live: liveCostVal, eval: evalCostVal, total: liveCostVal + evalCostVal },
            scores: report.scores,
          },
          reportToMarkdown(report),
        );
      }
    } catch (err) {
      setEvalState({ status: 'error', message: (err as Error).message });
    }
  };

  const handleEnd = (r: ConversationResult) => {
    setResult(r);
    setView('summary');
    if (config && settings) void persistAndEvaluate(r, config, settings);
  };

  const navHome = () => {
    setView('home');
    setConfig(null);
    setResult(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={navHome}>
          Hard Conversations
        </button>
        <nav>
          <button className={view === 'home' ? 'nav active' : 'nav'} onClick={navHome}>
            Home
          </button>
          <button
            className={view === 'settings' ? 'nav active' : 'nav'}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀︎' : '☾'}
          </button>
        </nav>
      </header>

      <main>
        {loadError && <div className="error-box">Could not load settings: {loadError}</div>}
        {!settings && !loadError && <p className="muted screen">Loading…</p>}

        {settings && view === 'home' && (
          <Home
            onPick={(id) => {
              setMode(id === 'custom' ? 'custom' : 'prd-review');
              setView('setup');
            }}
          />
        )}

        {settings && view === 'setup' && mode === 'custom' && (
          <CustomSetup
            onBack={navHome}
            voice={settings.voice}
            onStart={(c) => {
              setConfig(c);
              setView('live');
            }}
          />
        )}

        {settings && view === 'setup' && mode !== 'custom' && (
          <Setup
            onBack={navHome}
            onStart={(c) => {
              setConfig(c);
              setView('live');
            }}
          />
        )}

        {settings && view === 'live' && config && (
          <LiveSession config={config} settings={settings} onEnd={handleEnd} />
        )}

        {settings && view === 'summary' && result && config && (
          <Summary
            result={result}
            config={config}
            settings={settings}
            saveState={saveState}
            evalState={evalState}
            onDone={navHome}
            onPracticeAgain={() => setView('setup')}
          />
        )}

        {settings && view === 'settings' && (
          <SettingsScreen settings={settings} onSaved={setSettings} />
        )}
      </main>
    </div>
  );
}
