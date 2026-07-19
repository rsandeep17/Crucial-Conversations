import { useEffect, useRef, useState } from 'react';
import {
  Conversation,
  type ConversationResult,
  type ConversationStatus,
  type EndedBy,
} from '../lib/conversation';
import { EMPTY_USAGE_DISPLAY, liveCost, formatInr, formatDuration, type LiveUsage } from '../lib/cost';
import type { SessionConfig } from '../personas/personas';
import type { Settings } from '../lib/settings';

const SPEAKING_THRESHOLD = 0.045;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** One participant: avatar with a glow ring that reacts to their audio level. */
function Participant({
  label,
  sublabel,
  avatar,
  level,
  kind,
}: {
  label: string;
  sublabel?: string;
  avatar: string;
  level: number;
  kind: 'user' | 'persona';
}) {
  const speaking = level > SPEAKING_THRESHOLD;
  // Scale glow with level; clamp so it stays tasteful.
  const glow = Math.min(1, level * 6);
  const ringColor = kind === 'user' ? 'var(--who-user)' : 'var(--who-persona)';
  return (
    <div className={`participant ${speaking ? 'speaking' : ''}`}>
      <div
        className="avatar"
        style={{
          boxShadow: speaking
            ? `0 0 0 3px ${ringColor}, 0 0 ${18 + glow * 40}px ${glow * 10 + 4}px color-mix(in srgb, ${ringColor} 55%, transparent)`
            : `0 0 0 1px var(--border-strong)`,
          transform: `scale(${1 + glow * 0.06})`,
        }}
      >
        {avatar}
      </div>
      <div className="participant-name">{label}</div>
      {sublabel && <div className="participant-sub">{sublabel}</div>}
      <div className={`speaking-tag ${speaking ? 'on' : ''}`}>{speaking ? 'Speaking' : ' '}</div>
    </div>
  );
}

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
  const [usage, setUsage] = useState<LiveUsage>(EMPTY_USAGE_DISPLAY);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState({ user: 0, persona: 0 });

  const convRef = useRef<Conversation | null>(null);
  const endingRef = useRef(false);

  const finish = async (endedBy: EndedBy) => {
    if (endingRef.current || !convRef.current) return;
    endingRef.current = true;
    const result = await convRef.current.stop(endedBy);
    onEnd(result);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const conv = new Conversation(config, settings.apiKey, settings.liveModel, {
      onStatus: setStatus,
      onError: setError,
      onUsage: setUsage,
      onEndRequested: () => void finishRef.current('persona'),
      onDisconnected: () => void finishRef.current('disconnect'),
    });
    convRef.current = conv;
    conv.start().catch((e) => {
      setError((e as Error).message);
      setStatus('error');
    });

    return () => {
      if (!endingRef.current) void conv.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll timer + audio levels while live (fast enough for smooth glow).
  useEffect(() => {
    if (status !== 'live') return;
    const id = setInterval(() => {
      const c = convRef.current;
      if (!c) return;
      setElapsed(c.durationSec);
      setLevels({ user: c.micLevel, persona: c.personaLevel });
    }, 90);
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
            <span className={`meter-value ${overCost ? 'over' : ''}`}>{formatInr(cost, settings.usdToInr)}</span>
          </div>
          <span className={`status status-${status}`}>{status}</span>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {over && status === 'live' && (
        <div className="warn-banner">
          You're past your {overCost ? 'cost' : 'time'} target
          {overCost ? ` (${formatInr(settings.warnCostUsd, settings.usdToInr)})` : ` (${settings.warnMinutes} min)`}.
          Wrap up when it's natural — no rush, just a heads-up.
        </div>
      )}

      <div className="call-stage">
        <Participant
          label="You"
          avatar="🎙"
          level={levels.user}
          kind="user"
        />
        <Participant
          label={config.persona.name}
          sublabel={config.persona.title}
          avatar={initials(config.persona.name)}
          level={levels.persona}
          kind="persona"
        />
      </div>

      <p className="call-hint muted">
        {status === 'connecting'
          ? 'Connecting… allow microphone access.'
          : 'Just talk — no transcript here on purpose. You’ll see the full transcript and your evaluation right after you end.'}
      </p>

      <div className="controls call-controls">
        <button className="btn danger" onClick={() => void finish('user')}>
          End conversation
        </button>
      </div>
    </div>
  );
}
