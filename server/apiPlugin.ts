import type { Plugin, Connect } from 'vite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * A tiny file-IO API served *inside* the Vite dev server, so the whole app runs
 * from a single `npm run dev` process. It only reads/writes plain files under
 * `data/` on the local machine. No model calls pass through here — the browser
 * talks to Gemini directly.
 */

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

// Defaults are written on first read so the settings file always exists on disk.
const DEFAULT_SETTINGS = {
  apiKey: '',
  liveModel: 'gemini-3.1-flash-live-preview',
  evalModel: 'gemini-3.5-flash-lite',
  voice: 'Charon',
  // Editable pricing table (USD per 1M tokens). Defaults are the paid-tier
  // rates from ai.google.dev/gemini-api/docs/pricing as of July 2026 for
  // gemini-3.1-flash-live-preview (live) and gemini-3.5-flash-lite (eval). These
  // are preview-model prices and can change — edit in Settings if they drift.
  // Cost shown in-app is an estimate; Cloud Console billing is authoritative.
  pricing: {
    liveAudioInput: 3.0,
    liveTextInput: 0.75,
    liveAudioOutput: 12.0,
    liveTextOutput: 4.5,
    evalInput: 0.3,
    evalOutput: 2.5,
  },
  // Soft warning thresholds for the live session — the UI nudges, never cuts off.
  warnCostUsd: 0.5,
  warnMinutes: 10,
  // Reasoning effort for the evaluation model (Gemini 3 family). LOW keeps eval
  // cheap; MINIMAL is the floor (Gemini 3 can't fully disable thinking).
  evalThinkingLevel: 'LOW',
  // Send the user's spoken audio to the evaluator so delivery/tone is judged.
  evalUseAudio: true,
  // USD→INR rate for showing cost in rupees (editable in Settings).
  usdToInr: 85,
};

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return (await readRawBody(req)).toString('utf8');
}

/**
 * Readable, sortable timestamp: "YYYY-MM-DD HH-MM-SS" in Indian Standard Time.
 * 24-hour clock; dashes in the time because ':' is illegal in Windows folder
 * names. Space-separated so the folder reads naturally.
 */
function nowIstStamp(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  // en-GB can emit "24" for midnight hour; normalize to "00".
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}-${p.minute}-${p.second}`;
}

// Human labels for the session-mode categories, used to prefix the folder name.
const CATEGORY_LABELS: Record<string, string> = {
  'prd-review': 'PRD Review',
  custom: 'Custom Scenario',
};

/** Strip characters illegal in Windows folder names, collapse whitespace. */
function safeFolderPart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Session id / folder name: "<Category> YYYY-MM-DD HH-MM-SS", e.g.
 * "PRD Review 2026-07-23 22-12-07". The category prefix makes the sessions
 * folder scannable at a glance; the IST timestamp keeps them sortable and unique.
 */
function newSessionId(category: unknown): string {
  const key = typeof category === 'string' ? category : '';
  const label = CATEGORY_LABELS[key] ?? (key ? safeFolderPart(key) : 'Session');
  return `${label} ${nowIstStamp()}`;
}

async function createSession(body: string): Promise<{ id: string }> {
  const { meta, transcript } = JSON.parse(body);
  const id = newSessionId(meta?.category);
  const dir = path.join(SESSIONS_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ id, ...meta }, null, 2), 'utf8');
  await fs.writeFile(
    path.join(dir, 'transcript.json'),
    JSON.stringify(transcript ?? [], null, 2),
    'utf8',
  );
  return { id };
}

async function saveRecording(id: string, data: Buffer, contentType: string): Promise<void> {
  const dir = path.join(SESSIONS_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const ext = contentType.includes('wav') ? 'wav' : contentType.includes('webm') ? 'webm' : 'audio';
  await fs.writeFile(path.join(dir, `recording.${ext}`), data);
}

async function updateSession(id: string, body: string): Promise<unknown> {
  const { metaPatch, evaluationMarkdown } = JSON.parse(body);
  const dir = path.join(SESSIONS_DIR, id);
  const metaPath = path.join(dir, 'meta.json');
  const current = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  const merged = { ...current, ...(metaPatch ?? {}) };
  await fs.writeFile(metaPath, JSON.stringify(merged, null, 2), 'utf8');
  if (typeof evaluationMarkdown === 'string') {
    await fs.writeFile(path.join(dir, 'evaluation.md'), evaluationMarkdown, 'utf8');
  }
  return merged;
}

async function listSessions(): Promise<unknown[]> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
  const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
  const metas: unknown[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = await fs.readFile(path.join(SESSIONS_DIR, entry.name, 'meta.json'), 'utf8');
      metas.push(JSON.parse(raw));
    } catch {
      // skip incomplete session folders
    }
  }
  return metas;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(body);
}

async function readSettings(): Promise<unknown> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    // Merge onto defaults so newly-added fields appear for old files.
    const parsed = JSON.parse(raw);
    // Migrate legacy files written before real pricing existed: if every rate
    // the user actually saved is zero/absent, use the current defaults so cost
    // isn't shown as $0. Otherwise merge their values over the defaults.
    const savedPricing = parsed.pricing ?? {};
    const legacyAllZero = ['liveAudioInput', 'liveTextInput', 'liveAudioOutput', 'evalInput', 'evalOutput'].every(
      (k) => !savedPricing[k],
    );
    const pricing = legacyAllZero
      ? { ...DEFAULT_SETTINGS.pricing }
      : { ...DEFAULT_SETTINGS.pricing, ...savedPricing };
    return { ...DEFAULT_SETTINGS, ...parsed, pricing };
  } catch {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf8');
    return DEFAULT_SETTINGS;
  }
}

async function writeSettings(body: string): Promise<unknown> {
  await ensureDataDir();
  const incoming = JSON.parse(body);
  const current = (await readSettings()) as Record<string, unknown>;
  const merged = { ...current, ...incoming, pricing: { ...(current.pricing as object), ...(incoming.pricing ?? {}) } };
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

const handler: Connect.NextHandleFunction = (req, res, next) => {
  const url = req.url ?? '';
  if (!url.startsWith('/api/')) return next();

  (async () => {
    try {
      if (url === '/api/settings' && req.method === 'GET') {
        return sendJson(res, 200, await readSettings());
      }
      if (url === '/api/settings' && req.method === 'PUT') {
        const body = await readBody(req);
        return sendJson(res, 200, await writeSettings(body));
      }
      if (url === '/api/sessions' && req.method === 'GET') {
        return sendJson(res, 200, await listSessions());
      }
      if (url === '/api/sessions' && req.method === 'POST') {
        const body = await readBody(req);
        return sendJson(res, 201, await createSession(body));
      }
      const recMatch = url.match(/^\/api\/sessions\/([^/]+)\/recording$/);
      if (recMatch && req.method === 'PUT') {
        const data = await readRawBody(req);
        await saveRecording(decodeURIComponent(recMatch[1]), data, req.headers['content-type'] ?? '');
        return sendJson(res, 200, { ok: true });
      }
      const updMatch = url.match(/^\/api\/sessions\/([^/]+)$/);
      if (updMatch && req.method === 'PUT') {
        const body = await readBody(req);
        return sendJson(res, 200, await updateSession(decodeURIComponent(updMatch[1]), body));
      }
      return sendJson(res, 404, { error: `No API route for ${req.method} ${url}` });
    } catch (err) {
      return sendJson(res, 500, { error: (err as Error).message });
    }
  })();
};

export function localApiPlugin(): Plugin {
  return {
    name: 'hard-conversations-local-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
