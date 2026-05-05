import { validateData } from './data.ts';
import { runRustJsonHelper, rustHelperStatus } from './rustRuntime.ts';
import type { JsonObject } from './storage.ts';

export type ValidateRuntimeOptions = {
  now?: string;
  maxStaleDays?: number;
};

export function rustValidateStatus(): JsonObject {
  return rustHelperStatus(
    'quantops-validate',
    'QUANTOPS_RUST_VALIDATE',
    'QUANTOPS_VALIDATE_ENGINE',
    'cargo build --manifest-path tui/Cargo.toml --bin quantops-validate',
  );
}

function validateArgs(base: string, symbol: string | undefined, options: ValidateRuntimeOptions): string[] {
  const args = ['--base', base];
  if (symbol) args.push('--symbol', symbol);
  if (options.now) args.push('--now', options.now);
  if (Number.isFinite(options.maxStaleDays)) args.push('--max-stale-days', String(options.maxStaleDays));
  return args;
}

export function validateDataRuntime(base = 'data', symbol?: string, options: ValidateRuntimeOptions = {}): JsonObject {
  const engine = process.env.QUANTOPS_VALIDATE_ENGINE || 'auto';
  if (engine !== 'typescript') {
    const rust = runRustJsonHelper('quantops-validate', 'QUANTOPS_RUST_VALIDATE', 'QUANTOPS_VALIDATE_ENGINE', validateArgs(base, symbol, options));
    if (rust) return rust;
  }
  return { ...validateData(base, symbol, options), engine: 'typescript' };
}
