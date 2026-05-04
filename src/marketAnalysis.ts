import { marketDatasetPath, normalizeStooqSymbol } from './data.ts';
import { readJsonl, type JsonObject } from './storage.ts';

const TRADING_DAYS = 252;

function numberOrNull(value: unknown): number | null {
  const parsed = Number(String(value ?? '').replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export type MarketRow = {
  date: string;
  ticker: string;
  provider_symbol: string;
  source: string;
  interval: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

export function marketRows(
  symbol: string,
  options: { base?: string; source?: string; interval?: string; providerSymbol?: string } = {},
): MarketRow[] {
  const source = options.source || 'stooq';
  const interval = options.interval || 'd';
  const resolvedSymbol = source === 'stooq' ? normalizeStooqSymbol(symbol, options.providerSymbol) : (options.providerSymbol || symbol).toLowerCase();
  const records = readJsonl(marketDatasetPath(options.base || 'data', source, resolvedSymbol, interval));
  return records.flatMap((record) => {
    const payload = typeof record.payload === 'object' && record.payload && !Array.isArray(record.payload) ? record.payload as JsonObject : {};
    const close = numberOrNull(payload.close);
    if (close === null) return [];
    return [{
      date: String(record.date ?? ''),
      ticker: String(record.ticker ?? symbol.toUpperCase()).toUpperCase(),
      provider_symbol: String(record.provider_symbol ?? resolvedSymbol),
      source: String(record.source ?? source),
      interval: String(record.interval ?? interval),
      open: numberOrNull(payload.open),
      high: numberOrNull(payload.high),
      low: numberOrNull(payload.low),
      close,
      volume: numberOrNull(payload.volume),
    }];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function returns(closes: number[]): number[] {
  const values: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const previous = closes[i - 1]!;
    const current = closes[i]!;
    if (previous !== 0) values.push(current / previous - 1);
  }
  return values;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function maxDrawdown(closes: number[]): number | null {
  if (!closes.length) return null;
  let peak = closes[0]!;
  let worst = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    if (peak !== 0) worst = Math.min(worst, close / peak - 1);
  }
  return worst;
}

function movingAverage(values: number[], window: number): number | null {
  if (values.length < window) return null;
  return mean(values.slice(-window));
}

function volumeRatio(rows: MarketRow[], window = 20): number | null {
  const volumes = rows.map((row) => row.volume).filter((value): value is number => value !== null);
  if (volumes.length < window || !volumes.at(-1)) return null;
  const average = mean(volumes.slice(-window));
  return average === null || average === 0 ? null : volumes.at(-1)! / average;
}

function regime(totalReturn: number | null, latestClose: number | null, ma20: number | null, ma50: number | null, volatility: number | null): string {
  if (latestClose === null) return 'no-price-data';
  if (ma20 !== null && ma50 !== null && latestClose > ma20 && ma20 > ma50) return 'trend-up';
  if (ma20 !== null && ma50 !== null && latestClose < ma20 && ma20 < ma50) return 'trend-down';
  if (volatility !== null && volatility > 0.04) return 'high-volatility';
  if (totalReturn !== null && Math.abs(totalReturn) < 0.02) return 'range-bound';
  return 'watch';
}

export function marketStats(
  symbol: string,
  options: { base?: string; source?: string; interval?: string; providerSymbol?: string } = {},
): JsonObject {
  const source = options.source || 'stooq';
  const interval = options.interval || 'd';
  const rows = marketRows(symbol, { ...options, source, interval });
  if (!rows.length) {
    return {
      ok: false,
      ticker: symbol.toUpperCase(),
      source,
      interval,
      rows: 0,
      error: 'no market dataset found; run data download first',
      next_command: `data download ${symbol.toUpperCase()}`,
    };
  }
  const closes = rows.map((row) => row.close);
  const rowReturns = returns(closes);
  const latestClose = closes.at(-1)!;
  const firstClose = closes[0]!;
  const totalReturn = firstClose === 0 ? null : latestClose / firstClose - 1;
  const volatility = stddev(rowReturns);
  const ma20 = movingAverage(closes, 20);
  const ma50 = movingAverage(closes, 50);
  return {
    ok: true,
    ticker: rows.at(-1)!.ticker,
    provider_symbol: rows.at(-1)!.provider_symbol,
    source,
    interval,
    rows: rows.length,
    start_date: rows[0]!.date,
    end_date: rows.at(-1)!.date,
    latest_close: latestClose,
    total_return: totalReturn,
    average_return: mean(rowReturns),
    volatility,
    annualized_volatility: volatility === null ? null : volatility * Math.sqrt(TRADING_DAYS),
    max_drawdown: maxDrawdown(closes),
    best_return: rowReturns.length ? Math.max(...rowReturns) : null,
    worst_return: rowReturns.length ? Math.min(...rowReturns) : null,
    moving_average_20: ma20,
    moving_average_50: ma50,
    latest_volume: rows.at(-1)!.volume,
    volume_ratio_20: volumeRatio(rows, 20),
    regime: regime(totalReturn, latestClose, ma20, ma50, volatility),
    readiness: {
      basic_stats: rows.length >= 2,
      moving_average_20: rows.length >= 20,
      moving_average_50: rows.length >= 50,
      backtest_ready: rows.length >= 60,
    },
  };
}
