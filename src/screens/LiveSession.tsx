import { useEffect, useRef, useState } from 'react';
import { Conversation, type ConversationResult, type ConversationStatus } from '../lib/conversation';
import { EMPTY_USAGE_DISPLAY, liveCost, formatUsd, formatDuration, type LiveUsage } from '../lib/cost';
import type { SessionConfig } from '../personas/personas';
import type { Settings } from '../lib/settings';
import type { Turn } from '../lib/sessionStore';

export function LiveSession({
  config,
  settings,
  onEnd,
}: {
  config: SessionConfig;
  settings: Settings;
  onEnd: (result: ConversationResult) => void;
}) {
  const [status, setStatus] = useState<ConversationStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<Turn[]>([]);
  const [live, setLive] = useState({ user: '', persona: '' });
  const [usage, setUsage] = useState<LiveUsage>(EMPTY_USAGE_DISPLAY);
  const [elapsed, setElapsed] = useState(0);

  const convRef = useRef<Conversation | null>(null);
  const endingRef = useRef(false);

  const finish = async (graceful: boolean) => {
    if (endingRef.current || !convRef.current) return;
    endingRef.current = true;
    const result = await convRef.current.stop(graceful);
    onEnd(result);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const conv = new Conversation(config, settings.apiKey, settings.liveModel, {
      onStatus: setStatus,
      onError: setError,
      onTranscript: (c, u, p) => {
        setCommitted(c);
        setLive({ user: u, persona: p });
      },
      onUsage: setUsage,
      onEndRequested: () => void finishRef.current(true),
    });
    convRef.current = conv;
    conv.start().catch((e) => {
      setError((e as Error).message);
      setStatus('error');
    });

    return () => {
      // Unmount safety: stop without surfacing a result.
      if (!endingRef.current) void conv.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== 'live') return;
    const id = setInterval(() => setElapsed(convRef.current?.durationSec ?? 0), 300);
    return () => clearInterval(id);
  }, [status]);

  const cost = liveCost(usage, settings.pricing);
  const elapsedMin = elapsed / 60;
  const overCost = settings.warnCostUsd > 0 && cost >= settings.warnCostUsd;
  const overTime = settings.warnMinutes > 0 && elapsedMin >= settings.warnMinutes;
  const over = overCost || overTime;

  return (
    <div className="screen">
      <div className="live-header">
        <div>
          <h2>{config.persona.name}</h2>
          <p className="muted">
            {config.persona.title} · {config.intensity}
          </p>
        </div>
        <div className="live-meters">
          <div className="meter">
            <span className="meter-label">Time</span>
            <span className={`meter-value ${overTime ? 'over' : ''}`}>{formatDuration(elapsed)}</span>
          </div>
          <div className="meter">
            <span className="meter-label">Est. cost</span>
            <span className={`meter-value ${overCost ? 'over' : ''}`}>{formatUsd(cost)}</span>
          </div>
          <span className={`status status-${status}`}>{status}</span>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {over && status === 'live' && (
        <div className="warn-banner">
          You're past your {overCost ? 'cost' : 'time'} target
          {overCost ? ` (${formatUsd(settings.warnCostUsd)})` : ` (${settings.warnMinutes} min)`}. Wrap up when
          it's natural — no rush, just a heads-up.
        </div>
      )}

      <div className="controls">
        <button className="btn danger" onClick={() => void finish(false)}>
          End conversation
        </button>
        {status === 'connecting' && <span className="muted">Connecting… allow microphone access.</span>}
      </div>

      <div className="transcript">
        {committed.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            <span className="who">{t.role === 'user' ? 'You' : config.persona.name}</span>
            <span className="what">{t.text}</span>
          </div>
        ))}
        {live.user && (
          <div className="bubble user pending">
            <span className="who">You</span>
            <span className="what">{live.user}</span>
          </div>
        )}
        {live.persona && (
          <div className="bubble persona pending">
            <span className="who">{config.persona.name}</span>
            <span className="what">{live.persona}</span>
          </div>
        )}
        {committed.length === 0 && !live.user && !live.persona && status === 'live' && (
          <p className="muted">{config.persona.name} will open the meeting. Respond when you're ready.</p>
        )}
      </div>
    </div>
  );
}
