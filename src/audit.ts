import { existsSync, readFileSync } from 'node:fs';
import { extractPrice, historyRows } from './analysis.ts';
import { quoteHistoryPath, readWatchlist, SENSITIVE_KEYS, type JsonObject, type JsonValue } from './storage.ts';

export type AuditFinding = {
  severity: 'warn' | 'error';
  code: string;
  message: string;
  ticker?: string;
  next_command?: string;
};

export function finding(
  severity: AuditFinding['severity'],
  code: string,
  message: string,
  options: { ticker?: string; nextCommand?: string } = {},
): AuditFinding {
  return {
    severity,
    code,
    message,
    ...(options.ticker ? { ticker: options.ticker.toUpperCase() } : {}),
    ...(options.nextCommand ? { next_command: options.nextCommand } : {}),
  };
}

function containsSensitiveKey(value: JsonValue | undefined): boolean {
  if (Array.isArray(value)) return value.some((item) => containsSensitiveKey(item));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => {
      const normalized = key.toLowerCase().replaceAll('-', '_');
      return SENSITIVE_KEYS.has(normalized) || containsSensitiveKey(item);
    });
  }
  return false;
}

function readJsonlForAudit(path: string, ticker: string): { records: JsonObject[]; findings: AuditFinding[] } {
  if (!existsSync(path)) return { records: [], findings: [] };
  const records: JsonObject[] = [];
  const findings: AuditFinding[] = [];
  for (const [index, line] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const payload = JSON.parse(line) as unknown;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) records.push(payload as JsonObject);
      else findings.push(finding('error', 'malformed_record', `${path} line ${index + 1} is not an object`, { ticker, nextCommand: `history ${ticker}` }));
    } catch (error) {
      const message = error instanceof SyntaxError ? error.message : String(error);
      findings.push(finding('error', 'malformed_record', `${path} line ${index + 1} is not valid JSON: ${message}`, { ticker, nextCommand: `history ${ticker}` }));
    }
  }
  return { records, findings };
}

function validTimestamp(value: JsonValue | undefined): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  return !Number.isNaN(Date.parse(value.replace(/Z$/, '+00:00')));
}

export function auditWatchlist(base = 'data'): AuditFinding[] {
  return readWatchlist(base).length ? [] : [
    finding('warn', 'empty_watchlist', 'watchlist is empty; add at least one ticker before running quote/history workflows', { nextCommand: '/watchlist add AAPL' }),
  ];
}

export function auditQuotes(base = 'data', ticker?: string): AuditFinding[] {
  const tickers = ticker ? [ticker.toUpperCase()] : readWatchlist(base);
  const findings: AuditFinding[] = [];
  for (const symbol of tickers) {
    const { records, findings: readFindings } = readJsonlForAudit(quoteHistoryPath(symbol, base), symbol);
    findings.push(...readFindings);
    if (!records.length) {
      if (!readFindings.length) findings.push(finding('warn', 'missing_quote_history', `no quote history found for ${symbol}`, { ticker: symbol, nextCommand: `quote ${symbol}` }));
      continue;
    }
    const seen = new Set<string>();
    records.forEach((record, index) => {
      const fetchedAt = record.fetched_at;
      if (!fetchedAt) findings.push(finding('error', 'missing_fetched_at', `record ${index} has no fetched_at timestamp`, { ticker: symbol, nextCommand: `history ${symbol}` }));
      else if (!validTimestamp(fetchedAt)) findings.push(finding('error', 'invalid_timestamp', `record ${index} has invalid fetched_at timestamp: ${String(fetchedAt)}`, { ticker: symbol, nextCommand: `history ${symbol}` }));
      else if (seen.has(String(fetchedAt))) findings.push(finding('warn', 'duplicate_timestamp', `duplicate fetched_at timestamp: ${String(fetchedAt)}`, { ticker: symbol, nextCommand: `history ${symbol}` }));
      else seen.add(String(fetchedAt));
      if (extractPrice(record) === null) findings.push(finding('error', 'missing_price', `record ${index} has no extractable price`, { ticker: symbol, nextCommand: `quote ${symbol}` }));
      if (containsSensitiveKey(record)) findings.push(finding('error', 'sensitive_key', `record ${index} contains a sensitive-looking key`, { ticker: symbol }));
    });
    const rows = historyRows(records).filter((row) => row.price !== null);
    for (let i = 1; i < rows.length; i += 1) {
      const previous = rows[i - 1]!.price!;
      const current = rows[i]!.price!;
      if (previous === 0) continue;
      const change = current / previous - 1;
      if (Math.abs(change) > 0.30) findings.push(finding('warn', 'large_price_jump', `adjacent quote price changed by ${(change * 100).toFixed(1)}%; verify source payload`, { ticker: symbol, nextCommand: `history ${symbol}` }));
    }
  }
  return findings;
}

export function auditAll(base = 'data', ticker?: string): AuditFinding[] {
  return [...(ticker ? [] : auditWatchlist(base)), ...auditQuotes(base, ticker)];
}
