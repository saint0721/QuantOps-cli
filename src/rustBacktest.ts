import { appendJsonl, redact, utcNow, type JsonObject, type JsonValue } from './storage.ts';
import { backtestReportPath, runBacktest, type BacktestOptions, type BacktestResult } from './backtest.ts';
import { runRustJsonHelper, rustHelperStatus } from './rustRuntime.ts';

export function rustBacktestStatus(): JsonObject {
  return rustHelperStatus(
    'quantops-backtest',
    'QUANTOPS_RUST_BACKTEST',
    'QUANTOPS_BACKTEST_ENGINE',
    'cargo build --manifest-path tui/Cargo.toml --bin quantops-backtest',
  );
}

function pushNumber(args: string[], flag: string, value: number | undefined): void {
  if (Number.isFinite(value)) args.push(flag, String(value));
}

function rustBacktestArgs(symbol: string, options: BacktestOptions, createdAt: string): string[] {
  const args = [
    '--base', options.base || 'data',
    '--symbol', symbol,
    '--source', options.source || 'yahoo',
    '--interval', options.interval || 'd',
    '--strategy', options.strategy || 'ma-cross',
    '--created-at', createdAt,
  ];
  if (options.providerSymbol) args.push('--provider-symbol', options.providerSymbol);
  pushNumber(args, '--fast', options.fast);
  pushNumber(args, '--slow', options.slow);
  pushNumber(args, '--lookback', options.lookback);
  pushNumber(args, '--threshold', options.threshold);
  return args;
}

export function runBacktestRuntime(symbol: string, options: BacktestOptions = {}): BacktestResult {
  const engine = process.env.QUANTOPS_BACKTEST_ENGINE || 'auto';
  const createdAt = options.now ?? utcNow();
  if (engine !== 'typescript') {
    const rust = runRustJsonHelper('quantops-backtest', 'QUANTOPS_RUST_BACKTEST', 'QUANTOPS_BACKTEST_ENGINE', rustBacktestArgs(symbol, options, createdAt));
    if (rust) {
      const result = rust as unknown as BacktestResult;
      if (options.save !== false && result.ok) {
        const ticker = String(result.symbol || symbol).toUpperCase();
        const path = backtestReportPath(ticker, options.base ?? 'data');
        appendJsonl(path, redact(result as unknown as JsonValue) as JsonObject);
        result.saved_to = path;
      }
      return result;
    }
  }
  return { ...runBacktest(symbol, { ...options, now: createdAt }), engine: 'typescript' } as BacktestResult;
}
