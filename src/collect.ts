import { appendJsonl, quoteHistoryPath, readJsonl, readWatchlist, redact, utcNow, type JsonObject, type JsonValue } from './storage.ts';
import { quote, type TossResult } from './toss.ts';

export type CollectionProvider = 'tossctl';
export type CollectionTarget = {
  ticker: string;
  history_path: string;
  existing_samples: number;
};
export type CollectionPlan = {
  ok: true;
  provider: CollectionProvider;
  read_only: true;
  data_dir: string;
  source: string;
  targets: CollectionTarget[];
  warnings: string[];
};
export type CollectionRecord = JsonObject & {
  ticker: string;
  fetched_at: string;
  provider: CollectionProvider;
  source: string;
  payload: JsonValue;
};
export type CollectionSuccess = {
  ok: true;
  ticker: string;
  provider: CollectionProvider;
  fetched_at: string;
  saved_to: string;
  samples: number;
};
export type CollectionFailure = {
  ok: false;
  ticker: string;
  provider: CollectionProvider;
  command: string[];
  error: string;
  returncode: number;
};
export type CollectionResult = CollectionSuccess | CollectionFailure;
export type QuoteFetcher = (ticker: string) => TossResult;

export function normalizeTickers(tickers: string[]): string[] {
  return [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))].sort();
}

export function collectionPlan(options: { dataDir?: string; tickers?: string[]; includeWatchlist?: boolean } = {}): CollectionPlan {
  const dataDir = options.dataDir ?? 'data';
  const explicit = normalizeTickers(options.tickers ?? []);
  const watchlist = options.includeWatchlist || explicit.length === 0 ? readWatchlist(dataDir) : [];
  const tickers = normalizeTickers([...explicit, ...watchlist]);
  return {
    ok: true,
    provider: 'tossctl',
    read_only: true,
    data_dir: dataDir,
    source: 'tossctl quote get',
    targets: tickers.map((ticker) => {
      const historyPath = quoteHistoryPath(ticker, dataDir);
      return { ticker, history_path: historyPath, existing_samples: readJsonl(historyPath).length };
    }),
    warnings: tickers.length ? [] : ['no tickers selected; pass a ticker or add symbols to the watchlist'],
  };
}

export function parseTossJsonOrRaw(result: TossResult): JsonValue {
  try {
    return JSON.parse(result.stdout) as JsonValue;
  } catch {
    return { raw: result.stdout, stderr: result.stderr, returncode: result.returncode };
  }
}

export function collectQuote(dataDir: string, ticker: string, fetchQuote: QuoteFetcher = quote): CollectionResult {
  const normalized = normalizeTickers([ticker])[0];
  if (!normalized) {
    return { ok: false, ticker: '', provider: 'tossctl', command: [], error: 'ticker is required', returncode: 2 };
  }
  const result = fetchQuote(normalized);
  if (!result.ok) {
    return {
      ok: false,
      ticker: normalized,
      provider: 'tossctl',
      command: result.command,
      error: result.stderr || result.stdout,
      returncode: result.returncode || 1,
    };
  }
  const path = quoteHistoryPath(normalized, dataDir);
  const record: CollectionRecord = {
    ticker: normalized,
    fetched_at: utcNow(),
    provider: 'tossctl',
    source: 'tossctl quote get',
    payload: redact(parseTossJsonOrRaw(result)) as JsonValue,
  };
  appendJsonl(path, record);
  return { ok: true, ticker: normalized, provider: 'tossctl', fetched_at: record.fetched_at, saved_to: path, samples: readJsonl(path).length };
}

export function runCollectionPlan(plan: CollectionPlan, fetchQuote: QuoteFetcher = quote): CollectionResult[] {
  return plan.targets.map((target) => collectQuote(plan.data_dir, target.ticker, fetchQuote));
}

export function collectionSummary(results: CollectionResult[]): { ok: boolean; collected: number; failed: number; results: CollectionResult[] } {
  const failed = results.filter((result) => !result.ok).length;
  return { ok: failed === 0, collected: results.length - failed, failed, results };
}
