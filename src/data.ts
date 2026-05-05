import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { appendJsonl, dataDir, readJsonl, readWatchlist, utcNow, type JsonObject } from './storage.ts';

export const STOOQ_BASE_URL = 'https://stooq.com/q/d/l/';
export const YAHOO_CHART_BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
export const STOOQ_INTERVALS = new Set(['d', 'w', 'm']);
export const YAHOO_INTERVALS: Record<string, string> = { d: '1d', w: '1wk', m: '1mo' };
export const OHLCV_FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const;

export type DownloadRequest = {
  symbol: string;
  source?: 'stooq' | 'yahoo' | string;
  interval?: string;
  start?: string;
  end?: string;
  providerSymbol?: string;
};

export type DownloadFetcher = (url: string) => Promise<string> | string;

export type DataIssue = {
  severity: 'error' | 'warn';
  code: string;
  message: string;
  dataset?: string;
  date?: string;
};

export function normalizeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().replaceAll('-', '');
  if (!/^\d{8}$/.test(cleaned)) throw new Error(`date must be YYYY-MM-DD or YYYYMMDD: ${value}`);
  const year = Number(cleaned.slice(0, 4));
  const month = Number(cleaned.slice(4, 6));
  const day = Number(cleaned.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`invalid calendar date: ${value}`);
  }
  return cleaned;
}

export function normalizeStooqSymbol(symbol: string, providerSymbol?: string): string {
  const raw = (providerSymbol || symbol).trim();
  if (!raw) throw new Error('symbol is required');
  if (raw.startsWith('^') || raw.includes('.')) return raw.toLowerCase();
  return `${raw}.US`.toLowerCase();
}

export function stooqUrl(request: DownloadRequest): string {
  const interval = (request.interval || 'd').toLowerCase();
  if (!STOOQ_INTERVALS.has(interval)) throw new Error(`unsupported stooq interval: ${request.interval}`);
  const params = new URLSearchParams({
    s: normalizeStooqSymbol(request.symbol, request.providerSymbol),
    i: interval,
  });
  const start = normalizeDate(request.start);
  const end = normalizeDate(request.end);
  if (start) params.set('d1', start);
  if (end) params.set('d2', end);
  const apiKey = process.env.STOOQ_API_KEY;
  if (apiKey) params.set('apikey', apiKey);
  return `${STOOQ_BASE_URL}?${params.toString()}`;
}

function dateSeconds(value: string, addDays = 0): number {
  const normalized = normalizeDate(value)!;
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6)) - 1;
  const day = Number(normalized.slice(6, 8)) + addDays;
  return Math.floor(Date.UTC(year, month, day) / 1000);
}

export function yahooUrl(request: DownloadRequest): string {
  const interval = (request.interval || 'd').toLowerCase();
  const yahooInterval = YAHOO_INTERVALS[interval];
  if (!yahooInterval) throw new Error(`unsupported yahoo interval: ${request.interval}`);
  const symbol = encodeURIComponent((request.providerSymbol || request.symbol).trim().toUpperCase());
  const params = new URLSearchParams({
    interval: yahooInterval,
    events: 'history',
    includeAdjustedClose: 'true',
  });
  if (request.start || request.end) {
    const end = request.end || new Date().toISOString().slice(0, 10);
    const start = request.start || '1970-01-01';
    params.set('period1', String(dateSeconds(start)));
    params.set('period2', String(dateSeconds(end, 1)));
  } else {
    params.set('range', '1y');
  }
  return `${YAHOO_CHART_BASE_URL}${symbol}?${params.toString()}`;
}

export async function downloadText(url: string, timeoutMs = 20_000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'QuantOps-cli/0.1' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function numberOrNull(value: string | undefined): number | null {
  const text = (value || '').trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return Number.isInteger(parsed) ? Math.trunc(parsed) : parsed;
}

export function parseStooqCsv(text: string): JsonObject[] {
  const stripped = text.trim();
  if (!stripped) return [];
  const lower = stripped.toLowerCase();
  if (lower.startsWith('no data') || lower.includes('exceeded the daily hits limit')) throw new Error(stripped);
  if (lower.includes('get your apikey') || lower.includes('<apikey>')) throw new Error('stooq requires an API key for CSV downloads; set STOOQ_API_KEY or use --source yahoo');
  const [headerLine, ...lines] = stripped.split(/\r?\n/);
  const headers = (headerLine || '').split(',').map((item) => item.trim().toLowerCase());
  return lines.flatMap((line) => {
    const values = line.split(',');
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    const date = String(row.date || '').trim();
    if (!date) return [];
    return [{
      date,
      open: numberOrNull(row.open),
      high: numberOrNull(row.high),
      low: numberOrNull(row.low),
      close: numberOrNull(row.close),
      volume: numberOrNull(row.volume),
    }];
  });
}

export function parseYahooChart(text: string): JsonObject[] {
  const payload = JSON.parse(text) as any;
  const result = payload?.chart?.result?.[0];
  const error = payload?.chart?.error;
  if (error) throw new Error(error.description || error.code || 'yahoo chart error');
  if (!result) return [];
  const timestamps: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose || [];
  return timestamps.flatMap((timestamp, index) => {
    const close = quote.close?.[index];
    if (close === null || close === undefined) return [];
    return [{
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      open: quote.open?.[index] ?? null,
      high: quote.high?.[index] ?? null,
      low: quote.low?.[index] ?? null,
      close,
      volume: quote.volume?.[index] ?? null,
      adj_close: adjclose[index] ?? null,
    }];
  });
}

export function safeDatasetName(symbol: string, interval: string): string {
  const safeSymbol = symbol.toLowerCase()
    .replaceAll('^', 'idx_')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'symbol';
  const safeInterval = interval.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'd';
  return `${safeSymbol}_${safeInterval}`;
}

export function rawDownloadPath(base: string, source: string, symbol: string, interval: string): string {
  const extension = source === 'yahoo' ? 'json' : 'csv';
  return join(dataDir(base), 'downloads', source, `${safeDatasetName(symbol, interval)}.${extension}`);
}

export function marketDatasetPath(base: string, source: string, symbol: string, interval: string): string {
  return join(dataDir(base), 'market', source, `${safeDatasetName(symbol, interval)}.jsonl`);
}

export function manifestPath(base: string): string {
  return join(dataDir(base), 'downloads', 'manifest.jsonl');
}

function isoDate(value = new Date()): string {
  return value.toISOString().slice(0, 10);
}

function parseIsoDay(value: unknown): number | null {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
}

function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms)) return date;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

function datasetMatchesSymbol(dataset: JsonObject, symbol?: string): boolean {
  if (!symbol) return true;
  const ticker = symbol.toUpperCase();
  const tickerPath = ticker.replace('.', '_');
  const provider = String(dataset.provider_symbol ?? '').toUpperCase();
  const name = String(dataset.name ?? '').toUpperCase();
  return provider === ticker ||
    provider.startsWith(`${ticker}.`) ||
    name === tickerPath ||
    name.startsWith(`${tickerPath}_`);
}

function enrichDataset(dataset: JsonObject, now = isoDate()): JsonObject {
  const latestDay = parseIsoDay(dataset.latest_date);
  const nowDay = parseIsoDay(now);
  const latestAgeDays = latestDay !== null && nowDay !== null ? Math.max(0, nowDay - latestDay) : null;
  return {
    ...dataset,
    latest_age_days: latestAgeDays,
    next_command: `data refresh ${String(dataset.provider_symbol ?? dataset.name ?? '').toUpperCase()} --source ${String(dataset.source ?? 'yahoo')}`,
  };
}

function mergeByKey(path: string, rows: JsonObject[], keyFields: string[]): number {
  const existing = existsSync(path) ? readJsonl(path) : [];
  const merged = new Map<string, JsonObject>();
  for (const row of existing) merged.set(keyFields.map((field) => String(row[field] ?? '')).join('\0'), row);
  const before = merged.size;
  for (const row of rows) merged.set(keyFields.map((field) => String(row[field] ?? '')).join('\0'), row);
  mkdirSync(dirname(path), { recursive: true });
  const ordered = [...merged.values()].sort((a, b) => keyFields.map((field) => String(a[field] ?? '').localeCompare(String(b[field] ?? ''))).find(Boolean) ?? 0);
  writeFileSync(path, ordered.map((row) => JSON.stringify(row)).join('\n') + (ordered.length ? '\n' : ''), 'utf8');
  return merged.size - before;
}

export async function downloadHistory(request: DownloadRequest, options: { base?: string; fetcher?: DownloadFetcher } = {}): Promise<JsonObject> {
  const source = request.source || 'stooq';
  if (source !== 'stooq' && source !== 'yahoo') throw new Error(`unsupported source: ${source}`);
  const interval = (request.interval || 'd').toLowerCase();
  const providerSymbol = source === 'stooq' ? normalizeStooqSymbol(request.symbol, request.providerSymbol) : (request.providerSymbol || request.symbol).trim().toUpperCase();
  const normalized = { ...request, source, interval, providerSymbol, symbol: request.symbol.toUpperCase() };
  const url = source === 'stooq' ? stooqUrl(normalized) : yahooUrl(normalized);
  const fetchedAt = utcNow();
  const rawText = await (options.fetcher || downloadText)(url);
  const parsedRows = source === 'stooq' ? parseStooqCsv(rawText) : parseYahooChart(rawText);
  const base = options.base || 'data';
  const rawPath = rawDownloadPath(base, source, providerSymbol, interval);
  mkdirSync(dirname(rawPath), { recursive: true });
  writeFileSync(rawPath, rawText.endsWith('\n') ? rawText : `${rawText}\n`, 'utf8');
  const records: JsonObject[] = parsedRows.map((row) => ({
    ticker: normalized.symbol,
    provider_symbol: providerSymbol,
    source,
    interval,
    date: row.date,
    fetched_at: fetchedAt,
    payload: {
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      ...(row.adj_close === undefined ? {} : { adj_close: row.adj_close }),
    },
  }));
  const datasetPath = marketDatasetPath(base, source, providerSymbol, interval);
  const newRows = mergeByKey(datasetPath, records, ['source', 'provider_symbol', 'interval', 'date']);
  const start = normalizeDate(normalized.start);
  const end = normalizeDate(normalized.end);
  const manifest: JsonObject = {
    fetched_at: fetchedAt,
    source,
    ticker: normalized.symbol,
    provider_symbol: providerSymbol,
    interval,
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
    url,
    raw_path: rawPath,
    dataset_path: datasetPath,
    rows: records.length,
    new_rows: newRows,
  };
  appendJsonl(manifestPath(base), manifest);
  return { ok: true, ...manifest };
}

export async function downloadWatchlist(options: {
  base?: string;
  source?: string;
  interval?: string;
  start?: string;
  end?: string;
  fetcher?: DownloadFetcher;
} = {}): Promise<JsonObject> {
  const base = options.base || 'data';
  const results: JsonObject[] = [];
  for (const ticker of readWatchlist(base)) {
    try {
      results.push(await downloadHistory({
        symbol: ticker,
        source: options.source || 'stooq',
        interval: options.interval || 'd',
        start: options.start,
        end: options.end,
      }, { base, fetcher: options.fetcher }));
    } catch (error) {
      results.push({ ok: false, ticker, source: options.source || 'stooq', error: error instanceof Error ? error.message : String(error) });
    }
  }
  const failed = results.filter((item) => item.ok === false).length;
  return { ok: failed === 0, downloaded: results.length - failed, failed, results };
}

export function listDatasets(base = 'data'): JsonObject[] {
  const root = join(dataDir(base), 'market');
  if (!existsSync(root)) return [];
  const datasets: JsonObject[] = [];
  for (const source of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const dir = join(root, source);
    for (const file of readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl')).map((entry) => entry.name).sort()) {
      const path = join(dir, file);
      const rows = readJsonl(path);
      const first = rows[0] || {};
      const latest = rows.at(-1) || {};
      datasets.push({
        source,
        name: file.replace(/\.jsonl$/, ''),
        path,
        rows: rows.length,
        first_date: first.date,
        latest_date: latest.date,
        provider_symbol: latest.provider_symbol,
        interval: latest.interval,
      });
    }
  }
  return datasets;
}

export function dataInfo(base = 'data', symbol?: string, options: { now?: string; source?: string; interval?: string } = {}): JsonObject {
  const datasets = listDatasets(base)
    .filter((dataset) => datasetMatchesSymbol(dataset, symbol))
    .filter((dataset) => !options.source || String(dataset.source ?? '') === options.source)
    .filter((dataset) => !options.interval || String(dataset.interval ?? '') === options.interval)
    .map((dataset) => enrichDataset(dataset, options.now));
  return {
    ok: datasets.length > 0,
    symbol: symbol?.toUpperCase(),
    count: datasets.length,
    datasets,
    next_command: datasets.length ? undefined : `data download ${symbol?.toUpperCase() || 'AAPL'} --period 1y`,
  };
}

function validateDataset(dataset: JsonObject, options: { now?: string; maxStaleDays?: number } = {}): DataIssue[] {
  const issues: DataIssue[] = [];
  const path = String(dataset.path ?? '');
  const name = String(dataset.name ?? path);
  const rows = path ? readJsonl(path) : [];
  if (!rows.length) {
    issues.push({ severity: 'error', code: 'empty_dataset', message: 'dataset has no rows', dataset: name });
    return issues;
  }
  const seen = new Set<string>();
  let previous = '';
  for (const row of rows) {
    const date = String(row.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) issues.push({ severity: 'error', code: 'invalid_date', message: 'row date must be YYYY-MM-DD', dataset: name, date });
    if (seen.has(date)) issues.push({ severity: 'error', code: 'duplicate_date', message: 'dataset contains duplicate date rows', dataset: name, date });
    seen.add(date);
    if (previous && date < previous) issues.push({ severity: 'warn', code: 'unsorted_rows', message: 'dataset rows are not sorted by date', dataset: name, date });
    previous = date;
    const payload = typeof row.payload === 'object' && row.payload && !Array.isArray(row.payload) ? row.payload as JsonObject : {};
    const close = Number(payload.close);
    if (!Number.isFinite(close)) issues.push({ severity: 'error', code: 'invalid_close', message: 'row close must be numeric', dataset: name, date });
    const volume = payload.volume;
    if (volume !== null && volume !== undefined && !Number.isFinite(Number(volume))) issues.push({ severity: 'warn', code: 'invalid_volume', message: 'row volume should be numeric or null', dataset: name, date });
  }
  if (rows.length < 20) issues.push({ severity: 'warn', code: 'short_history', message: 'dataset has fewer than 20 rows; indicators will be limited', dataset: name });
  const latestDay = parseIsoDay(dataset.latest_date);
  const nowDay = parseIsoDay(options.now ?? isoDate());
  const maxStaleDays = options.maxStaleDays ?? 7;
  if (latestDay !== null && nowDay !== null && nowDay - latestDay > maxStaleDays) {
    issues.push({ severity: 'warn', code: 'stale_dataset', message: `latest row is ${nowDay - latestDay} days old`, dataset: name, date: String(dataset.latest_date ?? '') });
  }
  return issues;
}

export function validateData(base = 'data', symbol?: string, options: { now?: string; maxStaleDays?: number } = {}): JsonObject {
  const datasets = listDatasets(base).filter((dataset) => datasetMatchesSymbol(dataset, symbol));
  const issues = datasets.flatMap((dataset) => validateDataset(dataset, options));
  if (!datasets.length) issues.push({ severity: 'error', code: 'missing_dataset', message: `no market dataset found for ${symbol?.toUpperCase() || 'any symbol'}` });
  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    symbol: symbol?.toUpperCase(),
    datasets: datasets.map((dataset) => enrichDataset(dataset, options.now)),
    issues,
    next_command: datasets.length ? undefined : `data download ${symbol?.toUpperCase() || 'AAPL'} --period 1y`,
  };
}

function chooseRefreshDataset(base: string, request: DownloadRequest): JsonObject | undefined {
  const source = request.source || 'yahoo';
  const interval = (request.interval || 'd').toLowerCase();
  const provider = request.providerSymbol?.toUpperCase();
  return listDatasets(base)
    .filter((dataset) => datasetMatchesSymbol(dataset, request.symbol))
    .filter((dataset) => String(dataset.source ?? '') === source)
    .filter((dataset) => String(dataset.interval ?? '') === interval)
    .filter((dataset) => !provider || String(dataset.provider_symbol ?? '').toUpperCase() === provider)
    .sort((a, b) => String(b.latest_date ?? '').localeCompare(String(a.latest_date ?? '')) || Number(b.rows ?? 0) - Number(a.rows ?? 0))[0];
}

export async function refreshHistory(request: DownloadRequest, options: { base?: string; fetcher?: DownloadFetcher; today?: string } = {}): Promise<JsonObject> {
  const base = options.base || 'data';
  const dataset = chooseRefreshDataset(base, request);
  const today = options.today || isoDate();
  const start = request.start || (dataset?.latest_date ? addDays(String(dataset.latest_date), 1) : undefined);
  const end = request.end || today;
  if (start && end && start > end) {
    return {
      ok: true,
      refreshed: false,
      skipped: true,
      reason: 'dataset already current for requested range',
      ticker: request.symbol.toUpperCase(),
      source: request.source || 'yahoo',
      interval: request.interval || 'd',
      latest_date: dataset?.latest_date,
      next_command: `stats ${request.symbol.toUpperCase()}`,
    };
  }
  const result = await downloadHistory({
    ...request,
    source: request.source || 'yahoo',
    interval: request.interval || 'd',
    start,
    end,
  }, { base, fetcher: options.fetcher });
  return {
    ...result,
    refreshed: true,
    previous_latest_date: dataset?.latest_date,
    refresh_start: start,
    refresh_end: end,
  };
}

export async function refreshWatchlist(options: {
  base?: string;
  source?: string;
  interval?: string;
  start?: string;
  end?: string;
  fetcher?: DownloadFetcher;
  today?: string;
} = {}): Promise<JsonObject> {
  const base = options.base || 'data';
  const results: JsonObject[] = [];
  for (const ticker of readWatchlist(base)) {
    try {
      results.push(await refreshHistory({
        symbol: ticker,
        source: options.source || 'yahoo',
        interval: options.interval || 'd',
        start: options.start,
        end: options.end,
      }, { base, fetcher: options.fetcher, today: options.today }));
    } catch (error) {
      results.push({ ok: false, ticker, source: options.source || 'yahoo', error: error instanceof Error ? error.message : String(error) });
    }
  }
  const failed = results.filter((item) => item.ok === false).length;
  return { ok: failed === 0, refreshed: results.length - failed, failed, results };
}
