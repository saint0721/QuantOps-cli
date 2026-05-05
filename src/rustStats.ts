import { marketStats } from './marketAnalysis.ts';
import type { JsonObject } from './storage.ts';
import { runRustJsonHelper, rustHelperStatus } from './rustRuntime.ts';

export type RustStatsOptions = {
  base?: string;
  source?: string;
  interval?: string;
  providerSymbol?: string;
};

export function rustStatsStatus(): JsonObject {
  return rustHelperStatus(
    'quantops-stats',
    'QUANTOPS_RUST_STATS',
    'QUANTOPS_STATS_ENGINE',
    'cargo build --manifest-path tui/Cargo.toml --bin quantops-stats',
  );
}

function rustStatsArgs(symbol: string, options: RustStatsOptions): string[] {
  const args = [
    '--base', options.base || 'data',
    '--symbol', symbol,
    '--source', options.source || 'stooq',
    '--interval', options.interval || 'd',
  ];
  if (options.providerSymbol) args.push('--provider-symbol', options.providerSymbol);
  return args;
}

export function marketStatsRuntime(symbol: string, options: RustStatsOptions = {}): JsonObject {
  const engine = process.env.QUANTOPS_STATS_ENGINE || 'auto';
  if (engine !== 'typescript') {
    const rust = runRustJsonHelper('quantops-stats', 'QUANTOPS_RUST_STATS', 'QUANTOPS_STATS_ENGINE', rustStatsArgs(symbol, options));
    if (rust) return rust;
  }
  return { ...marketStats(symbol, options), engine: 'typescript' };
}
