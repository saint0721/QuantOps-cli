import { join } from 'node:path';
import { marketRows, type MarketRow } from './marketAnalysis.ts';
import { appendJsonl, redact, utcNow, type JsonObject, type JsonValue } from './storage.ts';

export type BacktestStrategyName = 'buy-hold' | 'ma-cross' | 'momentum' | 'mean-reversion';

export type BacktestOptions = {
  base?: string;
  source?: string;
  interval?: string;
  providerSymbol?: string;
  strategy?: string;
  fast?: number;
  slow?: number;
  lookback?: number;
  threshold?: number;
  save?: boolean;
  now?: string;
};

export type BacktestResult = {
  ok: boolean;
  created_at: string;
  symbol: string;
  provider_symbol?: string;
  source: string;
  interval: string;
  strategy: BacktestStrategyName;
  parameters: JsonObject;
  rows: number;
  start_date?: string;
  end_date?: string;
  total_return?: number | null;
  benchmark_return?: number | null;
  annualized_return?: number | null;
  annualized_volatility?: number | null;
  max_drawdown?: number | null;
  exposure?: number | null;
  trades?: number;
  win_rate?: number | null;
  error?: string;
  next_command?: string;
  saved_to?: string;
};

const TRADING_DAYS = 252;

export const BACKTEST_STRATEGIES: Array<{ name: BacktestStrategyName; description: string; defaults: JsonObject }> = [
  { name: 'buy-hold', description: 'Benchmark: stay invested for the full saved OHLCV window.', defaults: {} },
  { name: 'ma-cross', description: 'Long when the fast moving average is above the slow moving average.', defaults: { fast: 20, slow: 50 } },
  { name: 'momentum', description: 'Long when trailing return over lookback is above threshold.', defaults: { lookback: 20, threshold: 0 } },
  { name: 'mean-reversion', description: 'Long when price is below moving average by threshold.', defaults: { lookback: 20, threshold: 0.03 } },
];

export function backtestReportPath(symbol: string, base = 'data'): string {
  return join(base, 'backtests', `${symbol.toUpperCase()}.jsonl`);
}

export function listBacktestStrategies(): typeof BACKTEST_STRATEGIES {
  return [...BACKTEST_STRATEGIES];
}

function strategyName(value: string | undefined): BacktestStrategyName {
  const name = String(value || 'ma-cross').trim().toLowerCase();
  if (name === 'buy-and-hold' || name === 'buyhold') return 'buy-hold';
  if (name === 'ma' || name === 'moving-average' || name === 'ma_cross') return 'ma-cross';
  if (name === 'buy-hold' || name === 'ma-cross' || name === 'momentum' || name === 'mean-reversion') return name;
  throw new Error(`unknown backtest strategy: ${value}`);
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function thresholdOrDefault(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function movingAverage(values: number[], endExclusive: number, window: number): number | null {
  if (endExclusive < window) return null;
  return mean(values.slice(endExclusive - window, endExclusive));
}

function maxDrawdown(equity: number[]): number | null {
  if (!equity.length) return null;
  let peak = equity[0]!;
  let worst = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    if (peak !== 0) worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

function strategyParameters(strategy: BacktestStrategyName, options: BacktestOptions): JsonObject {
  if (strategy === 'ma-cross') {
    const fast = finiteOrDefault(options.fast, 20);
    const slow = finiteOrDefault(options.slow, 50);
    return { fast: Math.min(fast, slow - 1), slow };
  }
  if (strategy === 'momentum') return { lookback: finiteOrDefault(options.lookback, 20), threshold: thresholdOrDefault(options.threshold, 0) };
  if (strategy === 'mean-reversion') return { lookback: finiteOrDefault(options.lookback, 20), threshold: thresholdOrDefault(options.threshold, 0.03) };
  return {};
}

function positionForDay(strategy: BacktestStrategyName, rows: MarketRow[], day: number, params: JsonObject): number {
  if (strategy === 'buy-hold') return 1;
  const closes = rows.map((row) => row.close);
  const prior = day - 1;
  if (prior <= 0) return 0;
  if (strategy === 'ma-cross') {
    const fast = Number(params.fast);
    const slow = Number(params.slow);
    const fastMa = movingAverage(closes, prior + 1, fast);
    const slowMa = movingAverage(closes, prior + 1, slow);
    return fastMa !== null && slowMa !== null && fastMa > slowMa ? 1 : 0;
  }
  const lookback = Number(params.lookback);
  const threshold = Number(params.threshold);
  if (prior < lookback) return 0;
  const base = closes[prior - lookback]!;
  const latest = closes[prior]!;
  if (base === 0) return 0;
  if (strategy === 'momentum') return latest / base - 1 > threshold ? 1 : 0;
  const avg = movingAverage(closes, prior + 1, lookback);
  return avg !== null && latest < avg * (1 - threshold) ? 1 : 0;
}

export function runBacktest(symbol: string, options: BacktestOptions = {}): BacktestResult {
  const source = options.source || 'yahoo';
  const interval = options.interval || 'd';
  const createdAt = options.now ?? utcNow();
  const ticker = symbol.toUpperCase();
  const strategy = strategyName(options.strategy);
  const rows = marketRows(ticker, { base: options.base, source, interval, providerSymbol: options.providerSymbol });
  if (rows.length < 2) {
    return {
      ok: false,
      created_at: createdAt,
      symbol: ticker,
      source,
      interval,
      strategy,
      parameters: strategyParameters(strategy, options),
      rows: rows.length,
      error: 'not enough market data for backtest; run data download first',
      next_command: `data download ${ticker} --period 1y`,
    };
  }
  const params = strategyParameters(strategy, options);
  const equity = [1];
  const dailyStrategyReturns: number[] = [];
  const positions: number[] = [];
  let trades = 0;
  let previousPosition = 0;
  for (let day = 1; day < rows.length; day += 1) {
    const position = positionForDay(strategy, rows, day, params);
    if (position !== previousPosition) trades += 1;
    previousPosition = position;
    positions.push(position);
    const previousClose = rows[day - 1]!.close;
    const currentClose = rows[day]!.close;
    const marketReturn = previousClose === 0 ? 0 : currentClose / previousClose - 1;
    const strategyReturn = position * marketReturn;
    dailyStrategyReturns.push(strategyReturn);
    equity.push(equity.at(-1)! * (1 + strategyReturn));
  }
  const firstClose = rows[0]!.close;
  const latestClose = rows.at(-1)!.close;
  const totalReturn = equity.at(-1)! - 1;
  const benchmarkReturn = firstClose === 0 ? null : latestClose / firstClose - 1;
  const years = dailyStrategyReturns.length / TRADING_DAYS;
  const volatility = stddev(dailyStrategyReturns);
  const result: BacktestResult = {
    ok: true,
    created_at: createdAt,
    symbol: rows.at(-1)!.ticker,
    provider_symbol: rows.at(-1)!.provider_symbol,
    source,
    interval,
    strategy,
    parameters: params,
    rows: rows.length,
    start_date: rows[0]!.date,
    end_date: rows.at(-1)!.date,
    total_return: totalReturn,
    benchmark_return: benchmarkReturn,
    annualized_return: years > 0 ? (equity.at(-1)! ** (1 / years)) - 1 : null,
    annualized_volatility: volatility === null ? null : volatility * Math.sqrt(TRADING_DAYS),
    max_drawdown: maxDrawdown(equity),
    exposure: positions.length ? positions.reduce((sum, value) => sum + value, 0) / positions.length : null,
    trades,
    win_rate: dailyStrategyReturns.length ? dailyStrategyReturns.filter((value) => value > 0).length / dailyStrategyReturns.length : null,
  };
  if (options.save !== false) {
    const path = backtestReportPath(ticker, options.base ?? 'data');
    appendJsonl(path, redact(result as unknown as JsonValue) as JsonObject);
    result.saved_to = path;
  }
  return result;
}

function percent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';
}

export function formatStrategyList(): string {
  return [
    'Backtest strategies',
    ...BACKTEST_STRATEGIES.map((strategy) => `- ${strategy.name}: ${strategy.description} defaults=${JSON.stringify(strategy.defaults)}`),
  ].join('\n');
}

export function formatBacktestResult(result: BacktestResult): string {
  if (!result.ok) {
    return [
      `Backtest blocked: ${result.symbol}`,
      `strategy: ${result.strategy}`,
      `reason: ${result.error ?? 'unknown'}`,
      result.next_command ? `next  /${result.next_command}` : '',
    ].filter(Boolean).join('\n');
  }
  return [
    `Backtest: ${result.symbol}`,
    `strategy: ${result.strategy} ${JSON.stringify(result.parameters)}`,
    `window: ${result.start_date} → ${result.end_date} (${result.rows} rows, ${result.source})`,
    '',
    `total_return: ${percent(result.total_return)}`,
    `benchmark_return: ${percent(result.benchmark_return)}`,
    `annualized_return: ${percent(result.annualized_return)}`,
    `annualized_volatility: ${percent(result.annualized_volatility)}`,
    `max_drawdown: ${percent(result.max_drawdown)}`,
    `exposure: ${percent(result.exposure)}`,
    `trades: ${result.trades ?? 0}`,
    `win_rate: ${percent(result.win_rate)}`,
    result.saved_to ? `saved_to: ${result.saved_to}` : '',
  ].filter(Boolean).join('\n');
}
