import { GoogleGenAI } from '@google/genai';
import type { Intensity } from '../personas/personas';
import type { Turn } from './sessionStore';
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
    summary: { type: 'string', description: 'One or two sentence overall verdict on the PM.' },
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
          personaQuote: { type: 'string', description: "The persona's line the PM was responding to (verbatim, short)." },
          userQuote: { type: 'string', description: "The PM's own words being praised (verbatim, short)." },
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
          point: { type: 'string' },
          personaQuote: { type: 'string', description: "The persona's line the PM was responding to (verbatim, short)." },
          userQuote: { type: 'string', description: "The PM's actual words at the weak moment (verbatim, short)." },
          timestamp: { type: 'string', description: 'Approx [mm:ss] timestamp from the transcript.' },
          better: { type: 'string', description: 'What a stronger response would have sounded like.' },
        },
        required: ['point'],
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

function formatTranscript(transcript: Turn[], personaName: string, personaTitle: string): string {
  if (transcript.length === 0) return '(No conversation was recorded.)';
  return transcript
    .map((t) => {
      const time = t.ts != null ? `[${formatDuration(t.ts)}] ` : '';
      const who = t.role === 'user' ? 'PM' : `${personaName} (${personaTitle})`;
      return `${time}${who}: ${t.text}`;
    })
    .join('\n');
}

export async function evaluateSession(params: {
  apiKey: string;
  model: string;
  prd: string;
  personaName: string;
  personaTitle: string;
  intensity: Intensity;
  scenarioNote?: string;
  transcript: Turn[];
  /** Optional: the user's spoken audio, so delivery/tone is assessed too. */
  audio?: { data: string; mimeType: string };
}): Promise<EvalResult> {
  const { apiKey, model, prd, personaName, personaTitle, intensity, scenarioNote, transcript, audio } = params;
  const ai = new GoogleGenAI({ apiKey });

  const dimensionText = SCORE_DIMENSIONS.map((d) => `- ${d.label} (${d.key}): ${d.hint}`).join('\n');

  const prompt = [
    'You are an expert communication coach for product managers. You are reviewing a transcript of a ' +
      'SIMULATED practice conversation in which the PM walked a reviewer persona through their PRD and had ' +
      'to defend their decisions. Your job is to give the PM honest, specific, actionable feedback.',
    `THE REVIEWER PERSONA: ${personaName}, a ${personaTitle}. Intensity: ${intensity}.`,
    scenarioNote ? `SCENARIO CONTEXT: ${scenarioNote}` : '',
    `THE PRD UNDER REVIEW:\n"""\n${prd.trim()}\n"""`,
    `THE TRANSCRIPT (evaluate only the PM's performance, not the persona):\n"""\n${formatTranscript(
      transcript,
      personaName,
      personaTitle,
    )}\n"""`,
    'SCORING: rate the PM 1-5 (1 = poor, 5 = excellent) on each dimension:\n' + dimensionText,
    'GUIDELINES:\n' +
      '- CRITICAL: every wentWell / wentWrong point must be anchored to the actual moment so the PM can ' +
      'recall it. For each point, fill in: personaQuote (the reviewer line the PM was responding to), ' +
      'userQuote (the PM\'s own verbatim words), and timestamp (the [mm:ss] from the transcript). Quote ' +
      'verbatim — never invent words that were not said.\n' +
      '- For each weakness (wentWrong), also fill in `better`: a concrete, specific example of what a ' +
      'stronger response in that exact moment would have sounded like.\n' +
      '- Be honest. If the conversation was short or weak, say so and score accordingly.\n' +
      '- practiceNext should name the single highest-leverage improvement.\n' +
      '- followUps should be 2-3 specific next challenges (e.g., "Re-run with the Hostile intensity and ' +
      'focus on staying non-defensive").',
  ]
    .filter(Boolean)
    .join('\n\n');

  const parts: object[] = [{ text: prompt }];
  if (audio) {
    parts.push({ text: "The PM's spoken audio for this session follows. Judge their delivery — pace, filler words, confidence, tone under pressure — in addition to content." });
    parts.push({ inlineData: { mimeType: audio.mimeType, data: audio.data } });
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_SCHEMA,
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
    const bits: string[] = [`- ${w.timestamp ? `[${w.timestamp}] ` : ''}${w.point}`];
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
