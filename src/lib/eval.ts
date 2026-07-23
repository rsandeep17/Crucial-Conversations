import { GoogleGenAI, type ThinkingLevel } from '@google/genai';
import type { Intensity, SessionMode } from '../personas/personas';
import type { Turn } from './sessionStore';
import type { EvalThinkingLevel } from './settings';
import { formatDuration, type EvalUsage } from './cost';

export const SCORE_DIMENSIONS = [
  { key: 'clarity', label: 'Clarity & structure', hint: 'Was the explanation organized and easy to follow?' },
  { key: 'handlingObjections', label: 'Handling objections', hint: 'Did they address pushback head-on with substance?' },
  { key: 'composure', label: 'Composure', hint: 'Did they stay calm and non-defensive under pressure?' },
  { key: 'listening', label: 'Listening & acknowledging', hint: 'Did they hear the concern before responding?' },
  { key: 'conciseness', label: 'Conciseness', hint: 'Did they get to the point without rambling?' },
  { key: 'drivingToCommitment', label: 'Driving to commitment', hint: 'Did they move toward a clear next step or decision?' },
] as const;

export type ScoreKey = (typeof SCORE_DIMENSIONS)[number]['key'];

/** One feedback point, anchored to the actual exchange so it's recallable. */
export interface FeedbackPoint {
  /** A short, memorable name for the pattern, e.g. "Hand-waving complexity". */
  pattern?: string;
  /** A detailed explanation: what you did, why it landed badly, what the tell was. */
  point: string;
  /** The persona's line the PM was responding to (verbatim, short). */
  personaQuote?: string;
  /** The PM's own words (verbatim, short). */
  userQuote?: string;
  /** Approx timestamp in the conversation, e.g. "2:14". */
  timestamp?: string;
  /** For improvements: what a stronger response would have sounded like. */
  better?: string;
}

export interface EvalReport {
  summary: string;
  scores: Record<ScoreKey, number>;
  wentWell: FeedbackPoint[];
  wentWrong: FeedbackPoint[];
  practiceNext: string;
  followUps: string[];
}

export interface EvalResult {
  report: EvalReport;
  usage: EvalUsage;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One or two sentence overall verdict on how the user handled the conversation.' },
    scores: {
      type: 'object',
      properties: Object.fromEntries(
        SCORE_DIMENSIONS.map((d) => [d.key, { type: 'integer', minimum: 1, maximum: 5 }]),
      ),
      required: SCORE_DIMENSIONS.map((d) => d.key),
    },
    wentWell: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string' },
          personaQuote: { type: 'string', description: "The other person's line the user was responding to (verbatim, short)." },
          userQuote: { type: 'string', description: "The user's own words being praised (verbatim, short)." },
          timestamp: { type: 'string', description: 'Approx [mm:ss] timestamp from the transcript.' },
        },
        required: ['point'],
      },
    },
    wentWrong: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description:
              'A short, memorable NAME for this mistake pattern (3-6 words) the user can recognize next ' +
              'time, e.g. "Hand-waving complexity", "Conceding too fast", "Answering a different question".',
          },
          point: {
            type: 'string',
            description:
              'A detailed explanation (3-5 sentences): what the user actually did, WHY it damaged their ' +
              'position or credibility, and what the tell/trigger was so they can catch it happening again.',
          },
          personaQuote: { type: 'string', description: "The other person's line the user was responding to (verbatim, short)." },
          userQuote: { type: 'string', description: "The user's actual words at the weak moment (verbatim, short)." },
          timestamp: { type: 'string', description: 'Approx [mm:ss] timestamp from the transcript.' },
          better: { type: 'string', description: 'A concrete stronger response for that exact moment (a sentence or two the user could have said).' },
        },
        required: ['pattern', 'point'],
      },
    },
    practiceNext: { type: 'string', description: 'The single most valuable thing to work on next.' },
    followUps: {
      type: 'array',
      items: { type: 'string' },
      description: '2-3 concrete follow-up practice challenges.',
    },
  },
  required: ['summary', 'scores', 'wentWell', 'wentWrong', 'practiceNext', 'followUps'],
};

function formatTranscript(transcript: Turn[], userLabel: string, personaLabel: string): string {
  if (transcript.length === 0) return '(No conversation was recorded.)';
  return transcript
    .map((t) => {
      const time = t.ts != null ? `[${formatDuration(t.ts)}] ` : '';
      const who = t.role === 'user' ? userLabel : personaLabel;
      return `${time}${who}: ${t.text}`;
    })
    .join('\n');
}

export async function evaluateSession(params: {
  apiKey: string;
  model: string;
  mode: SessionMode;
  prd: string;
  /** The freeform situation text (custom mode). */
  situation?: string;
  personaName: string;
  personaTitle: string;
  intensity: Intensity;
  scenarioNote?: string;
  transcript: Turn[];
  /** Reasoning effort for the eval model (Gemini 3 family). Defaults to LOW. */
  thinkingLevel?: EvalThinkingLevel;
  /** Optional: the user's spoken audio, so delivery/tone is assessed too. */
  audio?: { data: string; mimeType: string };
}): Promise<EvalResult> {
  const { apiKey, model, mode, prd, situation, personaName, personaTitle, intensity, scenarioNote, transcript, thinkingLevel, audio } =
    params;
  const ai = new GoogleGenAI({ apiKey });

  const dimensionText = SCORE_DIMENSIONS.map((d) => `- ${d.label} (${d.key}): ${d.hint}`).join('\n');

  const sharedGuidelines =
    'GUIDELINES:\n' +
    '- CRITICAL: every wentWell / wentWrong point must be anchored to the actual moment so you can ' +
    'recall it. For each point, fill in: personaQuote (the OTHER person\'s line you were responding to), ' +
    "userQuote (your own verbatim words), and timestamp (the [mm:ss] from the transcript). Quote " +
    'verbatim — never invent words that were not said.\n' +
    '- For each weakness (wentWrong): give it a short memorable `pattern` NAME you can recognize ' +
    'again (e.g. "Hand-waving complexity", "Conceding too fast"), then a DETAILED `point` (3-5 sentences) ' +
    'explaining exactly what you did, WHY it hurt your position or credibility, and the tell/trigger to ' +
    'watch for next time. Then `better`: a concrete stronger response for that exact moment. Depth here ' +
    'matters more than brevity.\n' +
    '- Be honest. If the conversation was short or weak, say so and score accordingly.\n' +
    '- practiceNext should name the single highest-leverage improvement.\n' +
    '- followUps should be 2-3 specific next challenges.';

  const prompt =
    mode === 'custom'
      ? [
          'You are an expert communication coach. You are reviewing a transcript of a SIMULATED practice ' +
            'conversation in which a person rehearsed a difficult real-life conversation against an AI that ' +
            'played the other party (labelled "Your counterpart" in the transcript). Your job is to give the ' +
            'PERSON honest, specific, actionable feedback on how they handled it. Address the feedback to them ' +
            'directly ("you").',
          `THE SITUATION THEY WERE REHEARSING:\n"""\n${(situation ?? '').trim()}\n"""`,
          `The other party was played at intensity: ${intensity}.`,
          scenarioNote ? `EXTRA CONTEXT: ${scenarioNote}` : '',
          `THE TRANSCRIPT (evaluate only the person's performance, labelled "You", not the counterpart):\n` +
            `"""\n${formatTranscript(transcript, 'You', 'Your counterpart')}\n"""`,
          'SCORING: rate them 1-5 (1 = poor, 5 = excellent) on each dimension, interpreting each in the ' +
            'context of THIS conversation (e.g. "handling objections" = handling the other person\'s ' +
            'pushback; "driving to commitment" = moving toward a clear resolution or next step):\n' + dimensionText,
          sharedGuidelines,
        ]
      : [
          'You are an expert communication coach for product managers. You are reviewing a transcript of a ' +
            'SIMULATED practice conversation in which the PM walked a reviewer persona through their PRD and had ' +
            'to defend their decisions. Your job is to give the PM honest, specific, actionable feedback.',
          `THE REVIEWER PERSONA: ${personaName}, a ${personaTitle}. Intensity: ${intensity}.`,
          scenarioNote ? `SCENARIO CONTEXT: ${scenarioNote}` : '',
          `THE PRD UNDER REVIEW:\n"""\n${prd.trim()}\n"""`,
          `THE TRANSCRIPT (evaluate only the PM's performance, not the persona):\n"""\n${formatTranscript(
            transcript,
            'PM',
            `${personaName} (${personaTitle})`,
          )}\n"""`,
          'SCORING: rate the PM 1-5 (1 = poor, 5 = excellent) on each dimension:\n' + dimensionText,
          sharedGuidelines,
        ];

  const finalPrompt = prompt.filter(Boolean).join('\n\n');

  const parts: object[] = [{ text: finalPrompt }];
  if (audio) {
    parts.push({ text: "The user's spoken audio for this session follows. Judge their delivery — pace, filler words, confidence, tone under pressure — in addition to content." });
    parts.push({ inlineData: { mimeType: audio.mimeType, data: audio.data } });
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_SCHEMA,
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel: thinkingLevel as ThinkingLevel } } : {}),
    },
  });

  const text = response.text ?? '{}';
  const report = JSON.parse(text) as EvalReport;

  const meta = response.usageMetadata;
  const usage: EvalUsage = {
    inputTokens: meta?.promptTokenCount ?? 0,
    // Thinking tokens are billed as output tokens (no separate SKU).
    outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
    totalTokens: meta?.totalTokenCount ?? 0,
  };

  return { report, usage };
}

/** Render an EvalReport to Markdown for saving as evaluation.md. */
export function reportToMarkdown(report: EvalReport): string {
  const lines: string[] = [];
  lines.push('# Session Evaluation', '', report.summary, '');
  lines.push('## Scores');
  for (const d of SCORE_DIMENSIONS) {
    lines.push(`- **${d.label}:** ${report.scores[d.key]}/5`);
  }
  const renderPoint = (w: FeedbackPoint): string => {
    const head = `- ${w.timestamp ? `[${w.timestamp}] ` : ''}${w.pattern ? `**${w.pattern}** — ` : ''}${w.point}`;
    const bits: string[] = [head];
    if (w.personaQuote) bits.push(`  - Persona: "${w.personaQuote}"`);
    if (w.userQuote) bits.push(`  - You: "${w.userQuote}"`);
    if (w.better) bits.push(`  - Stronger: ${w.better}`);
    return bits.join('\n');
  };
  lines.push('', '## What went well');
  for (const w of report.wentWell) lines.push(renderPoint(w));
  lines.push('', '## What to improve');
  for (const w of report.wentWrong) lines.push(renderPoint(w));
  lines.push('', '## Practice next', report.practiceNext);
  lines.push('', '## Follow-up challenges');
  for (const f of report.followUps) lines.push(`- ${f}`);
  return lines.join('\n');
}
