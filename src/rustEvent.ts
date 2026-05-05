import { runEventStudy, type EventWindow } from './events.ts';
import { runRustJsonHelper, rustHelperStatus } from './rustRuntime.ts';
import type { JsonObject } from './storage.ts';

export function rustEventStatus(): JsonObject {
  return rustHelperStatus(
    'quantops-event',
    'QUANTOPS_RUST_EVENT',
    'QUANTOPS_EVENT_ENGINE',
    'cargo build --manifest-path tui/Cargo.toml --bin quantops-event',
  );
}

function eventArgs(symbol: string, options: {
  base?: string;
  eventDate?: string;
  benchmark?: string;
  windows?: EventWindow[];
  source?: string;
  interval?: string;
  providerSymbol?: string;
}): string[] {
  const args = [
    '--base', options.base || 'data',
    '--symbol', symbol,
    '--event-date', options.eventDate || '',
    '--source', options.source || 'yahoo',
    '--interval', options.interval || 'd',
  ];
  if (options.benchmark) args.push('--benchmark', options.benchmark);
  if (options.providerSymbol) args.push('--provider-symbol', options.providerSymbol);
  for (const window of options.windows || []) args.push('--window', `${window.from},${window.to}`);
  return args;
}

export function runEventStudyRuntime(symbol: string, options: {
  base?: string;
  eventDate?: string;
  benchmark?: string;
  windows?: EventWindow[];
  source?: string;
  interval?: string;
  providerSymbol?: string;
} = {}): JsonObject {
  const engine = process.env.QUANTOPS_EVENT_ENGINE || 'auto';
  if (!options.eventDate) return { ...runEventStudy(symbol, options), engine: 'typescript' };
  if (engine !== 'typescript') {
    const rust = runRustJsonHelper('quantops-event', 'QUANTOPS_RUST_EVENT', 'QUANTOPS_EVENT_ENGINE', eventArgs(symbol, options));
    if (rust) return rust;
  }
  return { ...runEventStudy(symbol, options), engine: 'typescript' };
}
