import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { marketStats } from './marketAnalysis.ts';
import type { JsonObject } from './storage.ts';

export type RustStatsOptions = {
  base?: string;
  source?: string;
  interval?: string;
  providerSymbol?: string;
};

function repoRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

function helperCandidates(): string[] {
  const root = repoRoot();
  return [
    process.env.QUANTOPS_RUST_STATS,
    resolve(root, 'tui', 'target', 'release', 'quantops-stats'),
    resolve(root, 'tui', 'target', 'debug', 'quantops-stats'),
  ].filter((item): item is string => Boolean(item));
}

function commandExists(command: string): boolean {
  return (spawnSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).status ?? 1) === 0;
}

export function rustStatsStatus(): JsonObject {
  const helper = helperCandidates().find((candidate) => existsSync(candidate));
  return {
    available: Boolean(helper) || process.env.QUANTOPS_STATS_ENGINE === 'rust-cargo',
    helper: helper || null,
    cargo_available: commandExists('cargo'),
    engine_env: process.env.QUANTOPS_STATS_ENGINE || 'auto',
    build_hint: 'cargo build --manifest-path tui/Cargo.toml --bin quantops-stats',
  };
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

function runRustStats(symbol: string, options: RustStatsOptions): JsonObject | null {
  const helper = helperCandidates().find((candidate) => existsSync(candidate));
  const args = rustStatsArgs(symbol, options);
  const engine = process.env.QUANTOPS_STATS_ENGINE || 'auto';
  let result: ReturnType<typeof spawnSync>;
  if (helper) {
    result = spawnSync(helper, args, { encoding: 'utf8', cwd: repoRoot() });
  } else if (engine === 'rust-cargo') {
    result = spawnSync('cargo', ['run', '--quiet', '--manifest-path', resolve(repoRoot(), 'tui', 'Cargo.toml'), '--bin', 'quantops-stats', '--', ...args], { encoding: 'utf8', cwd: repoRoot() });
  } else {
    return null;
  }
  if ((result.status ?? 1) !== 0 || !result.stdout.trim()) return null;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

export function marketStatsRuntime(symbol: string, options: RustStatsOptions = {}): JsonObject {
  const engine = process.env.QUANTOPS_STATS_ENGINE || 'auto';
  if (engine !== 'typescript') {
    const rust = runRustStats(symbol, options);
    if (rust) return rust;
  }
  return { ...marketStats(symbol, options), engine: 'typescript' };
}
