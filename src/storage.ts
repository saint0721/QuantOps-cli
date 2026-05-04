import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const SENSITIVE_KEYS = new Set([
  'token', 'access_token', 'refresh_token', 'session', 'session_id', 'cookie', 'cookies',
  'authorization', 'account_number', 'account_no', 'accountnumber', 'accountno', 'accountid',
  'account_id', 'acctno', 'acct_no', 'secret', 'password',
]);

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function dataDir(base = 'data'): string {
  mkdirSync(base, { recursive: true });
  return base;
}

export function quoteHistoryPath(ticker: string, base = 'data'): string {
  return join(dataDir(base), 'quotes', `${ticker.toUpperCase()}.jsonl`);
}

export function snapshotPath(name: string, base = 'data'): string {
  return join(dataDir(base), 'snapshots', `${name}.jsonl`);
}

export function watchlistPath(base = 'data'): string {
  return join(dataDir(base), 'watchlist.json');
}

export function redact<T extends JsonValue>(value: T): T | JsonValue {
  if (Array.isArray(value)) return value.map((item) => redact(item)) as JsonValue;
  if (value && typeof value === 'object') {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      const norm = key.toLowerCase().replaceAll('-', '_');
      out[key] = SENSITIVE_KEYS.has(norm) ? '<redacted>' : redact(item as JsonValue);
    }
    return out;
  }
  return value;
}

export function appendJsonl(path: string, record: JsonObject): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}

export function readJsonl(path: string): JsonObject[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JsonObject);
}

export function readWatchlist(base = 'data'): string[] {
  const path = watchlistPath(base);
  if (!existsSync(path)) return [];
  const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(payload)) return [];
  return [...new Set(payload.map(String).map((item) => item.toUpperCase()).filter(Boolean))].sort();
}

export function writeWatchlist(tickers: string[], base = 'data'): string {
  const path = watchlistPath(base);
  mkdirSync(dirname(path), { recursive: true });
  const cleaned = [...new Set(tickers.map((item) => item.toUpperCase()).filter(Boolean))].sort();
  writeFileSync(path, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8');
  return path;
}
