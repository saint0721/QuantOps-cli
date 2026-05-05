import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { appendJsonl, readJsonl, redact, utcNow, type JsonObject, type JsonValue } from './storage.ts';

export type QuantSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  path: string;
  events_path: string;
};

export type QuantSessionEvent = {
  at: string;
  type: string;
  summary?: string;
  payload?: JsonObject;
};

function defaultSessionRoot(): string {
  return process.env.TOSSQUANT_SESSION_DIR || '.quant';
}

export function redactSessionText(value: string): string {
  return value
    .replace(/(access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|session[_-]?id|session|token|secret|password|authorization|cookie)=([^\s&]+)/gi, '$1=<redacted>')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1<redacted>')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-<redacted>');
}

function redactSessionValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSessionText(value);
  if (Array.isArray(value)) return value.map(redactSessionValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSessionValue(item)]));
  return value;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'session';
}

export function defaultSessionId(now = utcNow()): string {
  const envId = process.env.TOSSQUANT_SESSION || process.env.CODEX_SESSION_ID || process.env.OMX_SESSION_ID || process.env.OMX_SESSION;
  if (envId) return slugify(envId);
  return `session-${now.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(/Z$/, '').slice(0, 15)}`;
}

export function quantSessionDir(root = defaultSessionRoot()): string {
  const dir = join(root, 'sessions');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function quantSessionPath(id: string, root = defaultSessionRoot()): string {
  return join(quantSessionDir(root), `${slugify(id)}.json`);
}

export function quantSessionEventsPath(id: string, root = defaultSessionRoot()): string {
  return join(quantSessionDir(root), `${slugify(id)}.events.jsonl`);
}

export function ensureQuantSession(options: { id?: string; title?: string; root?: string; now?: string } = {}): QuantSession {
  const now = options.now ?? utcNow();
  const id = slugify(options.id || defaultSessionId(now));
  const path = quantSessionPath(id, options.root);
  const eventsPath = quantSessionEventsPath(id, options.root);
  if (existsSync(path)) {
    const current = JSON.parse(readFileSync(path, 'utf8')) as QuantSession;
    const updated = { ...current, updated_at: now, title: redactSessionText(options.title || current.title || id), path, events_path: eventsPath };
    writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    return updated;
  }
  const session: QuantSession = {
    id,
    title: redactSessionText(options.title || id),
    created_at: now,
    updated_at: now,
    path,
    events_path: eventsPath,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  return session;
}

export function recordSessionEvent(session: QuantSession, event: Omit<QuantSessionEvent, 'at'> & { at?: string }): void {
  const at = event.at ?? utcNow();
  appendJsonl(session.events_path, redact(redactSessionValue({ at, type: event.type, summary: event.summary, payload: event.payload ?? {} }) as JsonValue) as JsonObject);
  writeFileSync(session.path, `${JSON.stringify({ ...session, updated_at: at }, null, 2)}\n`, 'utf8');
}

export function listQuantSessions(root = defaultSessionRoot()): QuantSession[] {
  const dir = quantSessionDir(root);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json') && !file.endsWith('.events.json'))
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as QuantSession)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
}

export function sessionEvents(sessionOrId: QuantSession | string, root = defaultSessionRoot()): JsonObject[] {
  const path = typeof sessionOrId === 'string' ? quantSessionEventsPath(sessionOrId, root) : sessionOrId.events_path;
  return readJsonl(path);
}

export function sessionHandoff(sessionOrId: QuantSession | string, root = defaultSessionRoot()): string {
  const session = typeof sessionOrId === 'string'
    ? JSON.parse(readFileSync(quantSessionPath(sessionOrId, root), 'utf8')) as QuantSession
    : sessionOrId;
  const events = sessionEvents(session, root).slice(-20);
  return [
    `TossQuant session handoff: ${session.title}`,
    `id: ${session.id}`,
    `updated_at: ${session.updated_at}`,
    '',
    'Recent meaningful events:',
    ...(events.length ? events.map((event) => `- ${String(event.at)} ${String(event.type)}: ${String(event.summary ?? '')}`.trimEnd()) : ['- none yet']),
    '',
    'Use this handoff to continue the quant research conversation without raw credentials or trading mutations.',
  ].join('\n');
}
