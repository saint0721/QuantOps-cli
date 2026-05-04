import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { historyRows } from './analysis.ts';
import { dataDir, quoteHistoryPath, readJsonl, readWatchlist, utcNow } from './storage.ts';
import { tossctlPath } from './toss.ts';

export type RuntimeSnapshot = {
  app: 'TossQuant'; version: string; branch: string; pid: number; tmux: boolean; mode: string; last_action: string;
  watchlist_count: number; watchlist: string[]; quote_files: number; quote_samples: number; quote_counts: Record<string, number>;
  latest_quotes: Record<string, string | null>; classify_ready: string[]; needs_more: string[]; codex: 'ready' | 'missing'; tossctl: string; updated_at: string;
};

export const VERSION = '0.1.0';

export function runtimeDir(base = 'data'): string {
  const path = join(dataDir(base), 'runtime');
  mkdirSync(path, { recursive: true });
  return path;
}

export function runtimeStatePath(base = 'data'): string {
  return join(runtimeDir(base), 'state.json');
}

export function gitBranch(cwd = process.cwd()): string {
  const result = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : 'unknown';
}

export function commandExists(name: string): boolean {
  const result = spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0;
}

export function quoteSampleCounts(base = 'data'): Record<string, number> {
  const quoteDir = join(dataDir(base), 'quotes');
  if (!existsSync(quoteDir)) return {};
  const counts: Record<string, number> = {};
  for (const file of readdirSync(quoteDir).filter((item) => item.endsWith('.jsonl')).sort()) {
    const ticker = file.replace(/\.jsonl$/, '').toUpperCase();
    try { counts[ticker] = readJsonl(join(quoteDir, file)).length; } catch { counts[ticker] = 0; }
  }
  return counts;
}

export function statusSummary(base = 'data') {
  const counts = quoteSampleCounts(base);
  const watchlist = readWatchlist(base);
  const ready = Object.entries(counts).filter(([, count]) => count >= 3).map(([ticker]) => ticker).sort();
  const needs_more = [...new Set([...watchlist, ...Object.keys(counts)])].filter((ticker) => (counts[ticker] ?? 0) < 3).sort();
  return { watchlist, counts, ready, needs_more };
}

export function latestQuoteTimestamp(ticker: string, base = 'data'): string | null {
  try {
    const rows = historyRows(readJsonl(quoteHistoryPath(ticker, base)));
    return rows.at(-1)?.fetched_at || null;
  } catch { return null; }
}

export function buildRuntimeSnapshot({ mode = 'quant', lastAction = 'ready', base = 'data', cwd = process.cwd() } = {}): RuntimeSnapshot {
  const summary = statusSummary(base);
  const latest: Record<string, string | null> = {};
  for (const ticker of Object.keys(summary.counts)) latest[ticker] = latestQuoteTimestamp(ticker, base);
  return {
    app: 'TossQuant', version: VERSION, branch: gitBranch(cwd), pid: process.pid, tmux: Boolean(process.env.TMUX),
    mode, last_action: lastAction, watchlist_count: summary.watchlist.length, watchlist: summary.watchlist,
    quote_files: Object.keys(summary.counts).length, quote_samples: Object.values(summary.counts).reduce((a, b) => a + b, 0),
    quote_counts: summary.counts, latest_quotes: latest, classify_ready: summary.ready, needs_more: summary.needs_more,
    codex: commandExists('codex') ? 'ready' : 'missing', tossctl: tossctlPath(), updated_at: utcNow(),
  };
}

export function writeRuntimeSnapshot(snapshot: RuntimeSnapshot, base = 'data'): string {
  const path = runtimeStatePath(base);
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return path;
}

export function readRuntimeSnapshot(base = 'data'): RuntimeSnapshot | null {
  const path = runtimeStatePath(base);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as RuntimeSnapshot; } catch { return null; }
}

export function recordRuntime(opts: { mode?: string; lastAction?: string; base?: string; cwd?: string } = {}): RuntimeSnapshot {
  const snapshot = buildRuntimeSnapshot(opts);
  writeRuntimeSnapshot(snapshot, opts.base ?? 'data');
  return snapshot;
}

export function renderRuntimeLine(snapshot: RuntimeSnapshot): string {
  return `[TossQuant ${snapshot.version}] ${snapshot.branch} | mode:${snapshot.mode} | watchlist:${snapshot.watchlist_count} | quotes:${snapshot.quote_files}/${snapshot.quote_samples} samples | classify-ready:${snapshot.classify_ready.length} | codex:${snapshot.codex}`;
}
