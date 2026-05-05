import type { DownloadRequest } from './data.ts';
import { periodToDateRange } from './period.ts';

export function takeOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, value === undefined ? 1 : 2);
  return value;
}

export function takeRepeatedOption(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length;) {
    if (args[i] === flag) {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      values.push(value);
      args.splice(i, 2);
      continue;
    }
    i += 1;
  }
  return values;
}

export function numberOption(args: string[], flag: string): number | undefined {
  const value = takeOption(args, flag);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a number`);
  return parsed;
}

export function expandDataArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const item = args[i]!;
    if (item === '--json') continue;
    if (item === '--period') {
      const period = args[++i];
      if (!period) throw new Error('--period requires a value such as 1y, 6mo, 30d, ytd, or max');
      if (['max', 'all', 'full'].includes(period.trim().toLowerCase())) continue;
      const range = periodToDateRange(period);
      out.push('--start', range.start, '--end', range.end);
      continue;
    }
    out.push(item);
  }
  return out;
}

export function dataOptionsFromTail(tail: string[]): { json: boolean; request: Omit<DownloadRequest, 'symbol'>; rest: string[] } {
  const rest = [...tail];
  const json = rest.includes('--json');
  for (let i = rest.length - 1; i >= 0; i -= 1) if (rest[i] === '--json') rest.splice(i, 1);
  const expanded = expandDataArgs(rest);
  const source = takeOption(expanded, '--source');
  const interval = takeOption(expanded, '--interval');
  const start = takeOption(expanded, '--start');
  const end = takeOption(expanded, '--end');
  const providerSymbol = takeOption(expanded, '--provider-symbol');
  return { json, request: { source: source || 'yahoo', interval, start, end, providerSymbol }, rest: expanded };
}
