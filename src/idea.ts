import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataInfo, validateData } from './data.ts';
import { researchReportPath } from './research.ts';
import { dataDir, utcNow, type JsonObject, type JsonValue } from './storage.ts';

export type IdeaStatus = 'draft' | 'active' | 'archived';

export type QuantIdea = {
  id: string;
  title: string;
  status: IdeaStatus;
  symbols: string[];
  hypotheses: string[];
  created_at: string;
  updated_at: string;
};

export type IdeaReadiness = {
  symbol: string;
  market_data: 'ready' | 'missing';
  validation: 'pass' | 'issues' | 'missing';
  research: 'saved' | 'missing';
  next_commands: string[];
};

export type IdeaStatusReport = {
  ok: boolean;
  idea: QuantIdea;
  readiness: IdeaReadiness[];
  next_commands: string[];
};

function normalizeSymbol(symbol: string): string {
  const cleaned = symbol.trim().toUpperCase();
  if (!cleaned) throw new Error('symbol is required');
  return cleaned;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'idea';
}

export function ideasDir(base = 'data'): string {
  const dir = join(dataDir(base), 'ideas');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ideaPath(base: string, id: string): string {
  return join(ideasDir(base), `${id}.json`);
}

export function ideaId(title: string, now = utcNow()): string {
  const stamp = now.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(/Z$/, '').slice(0, 15);
  return `idea-${stamp}-${slugify(title)}`;
}

function uniqueIdeaId(base: string, title: string, now: string): string {
  const baseId = ideaId(title, now);
  let candidate = baseId;
  let suffix = 2;
  while (existsSync(ideaPath(base, candidate))) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function asIdea(value: unknown, path: string): QuantIdea {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid idea file: ${path}`);
  const record = value as JsonObject;
  return {
    id: String(record.id ?? ''),
    title: String(record.title ?? ''),
    status: (record.status === 'active' || record.status === 'archived' ? record.status : 'draft') as IdeaStatus,
    symbols: Array.isArray(record.symbols) ? [...new Set(record.symbols.map(String).map((item) => item.toUpperCase()).filter(Boolean))].sort() : [],
    hypotheses: Array.isArray(record.hypotheses) ? record.hypotheses.map(String).filter(Boolean) : [],
    created_at: String(record.created_at ?? ''),
    updated_at: String(record.updated_at ?? ''),
  };
}

function writeIdea(base: string, idea: QuantIdea): QuantIdea {
  writeFileSync(ideaPath(base, idea.id), `${JSON.stringify(idea, null, 2)}\n`, 'utf8');
  return idea;
}

function findIdeaPath(base: string, id: string): string {
  const direct = ideaPath(base, id);
  if (existsSync(direct)) return direct;
  const matches = readdirSync(ideasDir(base))
    .filter((file) => file.endsWith('.json') && file.slice(0, -5).startsWith(id))
    .sort();
  if (matches.length === 1) return join(ideasDir(base), matches[0]!);
  if (matches.length > 1) throw new Error(`ambiguous idea id: ${id}`);
  throw new Error(`idea not found: ${id}`);
}

export function createIdea(base: string, title: string, options: { now?: string } = {}): QuantIdea {
  const cleaned = title.trim();
  if (!cleaned) throw new Error('idea title is required');
  const now = options.now ?? utcNow();
  const idea: QuantIdea = {
    id: uniqueIdeaId(base, cleaned, now),
    title: cleaned,
    status: 'draft',
    symbols: [],
    hypotheses: [],
    created_at: now,
    updated_at: now,
  };
  return writeIdea(base, idea);
}

export function readIdea(base: string, id: string): QuantIdea {
  const path = findIdeaPath(base, id);
  return asIdea(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, path);
}

export function listIdeas(base = 'data'): QuantIdea[] {
  const dir = ideasDir(base);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const path = join(dir, file);
      return asIdea(JSON.parse(readFileSync(path, 'utf8')) as JsonValue, path);
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}

export function addIdeaSymbol(base: string, id: string, symbol: string): QuantIdea {
  const idea = readIdea(base, id);
  idea.symbols = [...new Set([...idea.symbols, normalizeSymbol(symbol)])].sort();
  idea.updated_at = utcNow();
  return writeIdea(base, idea);
}

export function addIdeaHypothesis(base: string, id: string, hypothesis: string): QuantIdea {
  const idea = readIdea(base, id);
  const cleaned = hypothesis.trim();
  if (!cleaned) throw new Error('hypothesis is required');
  idea.hypotheses = [...idea.hypotheses, cleaned];
  idea.updated_at = utcNow();
  return writeIdea(base, idea);
}

function symbolReadiness(base: string, symbol: string, title: string): IdeaReadiness {
  const info = dataInfo(base, symbol);
  const validation = info.ok ? validateData(base, symbol) : undefined;
  const researchSaved = existsSync(researchReportPath(symbol, base));
  const nextCommands: string[] = [];
  if (!info.ok) nextCommands.push(`data download ${symbol} --period 1y`);
  else {
    nextCommands.push(`data validate ${symbol}`);
    nextCommands.push(`stats ${symbol}`);
  }
  if (!researchSaved) nextCommands.push(`research ${symbol} --topic "${title}"`);
  return {
    symbol,
    market_data: info.ok ? 'ready' : 'missing',
    validation: info.ok ? (validation?.ok ? 'pass' : 'issues') : 'missing',
    research: researchSaved ? 'saved' : 'missing',
    next_commands: nextCommands,
  };
}

export function ideaStatus(base: string, id: string): IdeaStatusReport {
  const idea = readIdea(base, id);
  const readiness = idea.symbols.map((symbol) => symbolReadiness(base, symbol, idea.title));
  const nextCommands = idea.symbols.length
    ? readiness.flatMap((item) => item.next_commands)
    : [`idea add-symbol ${idea.id} AAPL`];
  return { ok: true, idea, readiness, next_commands: [...new Set(nextCommands)] };
}
