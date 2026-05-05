import { marketRows, type MarketRow } from './marketAnalysis.ts';
import type { JsonObject } from './storage.ts';

export type EventWindow = {
  from: number;
  to: number;
  label: string;
};

export const DEFAULT_EVENT_WINDOWS: EventWindow[] = [
  { from: -5, to: -1, label: 'D-5..D-1' },
  { from: 0, to: 0, label: 'D0' },
  { from: 1, to: 5, label: 'D+1..D+5' },
  { from: 6, to: 20, label: 'D+6..D+20' },
];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'event';
}

function parseWindow(value: string): EventWindow {
  const [rawFrom, rawTo] = value.split(',');
  const from = Number(rawFrom);
  const to = Number(rawTo ?? rawFrom);
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error(`invalid event window: ${value}`);
  return { from, to, label: `D${from >= 0 ? '+' : ''}${from}..D${to >= 0 ? '+' : ''}${to}` };
}

export function parseEventWindows(values: string[] = []): EventWindow[] {
  return values.length ? values.map(parseWindow) : DEFAULT_EVENT_WINDOWS;
}

export function defineEvent(input: {
  type?: string;
  targetSymbol?: string;
  sourceSymbol?: string;
  benchmark?: string;
  topic?: string;
  thesis?: string;
  windows?: EventWindow[];
}): JsonObject {
  const type = input.type || 'unspecified';
  const target = input.targetSymbol?.toUpperCase();
  const source = input.sourceSymbol?.toUpperCase();
  const id = slug([type, source, target, input.topic].filter(Boolean).join('-'));
  return {
    ok: true,
    event_definition: {
      id,
      type,
      source_symbol: source ?? null,
      target_symbol: target ?? null,
      benchmark: input.benchmark?.toUpperCase() ?? null,
      topic: input.topic ?? null,
      thesis: input.thesis ?? null,
      windows: (input.windows?.length ? input.windows : DEFAULT_EVENT_WINDOWS).map((window) => ({ label: window.label, from: window.from, to: window.to })),
    },
    next: [
      target ? `rtk data info ${target} --json` : 'rtk symbol search <target> --json',
      target ? `rtk event study ${target} --event-date YYYY-MM-DD${input.benchmark ? ` --benchmark ${input.benchmark.toUpperCase()}` : ''} --json` : 'rtk event study <target> --event-date YYYY-MM-DD --json',
    ],
  };
}

function eventIndex(rows: MarketRow[], eventDate: string): number {
  return rows.findIndex((row) => row.date >= eventDate);
}

function windowReturn(rows: MarketRow[], index: number, window: EventWindow): JsonObject {
  const startIndex = index + window.from;
  const endIndex = index + window.to;
  const baseIndex = window.from <= 0 ? startIndex - 1 : index;
  if (baseIndex < 0 || endIndex < 0 || baseIndex >= rows.length || endIndex >= rows.length || endIndex < baseIndex) {
    return { ok: false, label: window.label, from: window.from, to: window.to, error: 'window outside available data' };
  }
  const base = rows[baseIndex]!;
  const end = rows[endIndex]!;
  return {
    ok: true,
    label: window.label,
    from: window.from,
    to: window.to,
    start_date: rows[startIndex < 0 ? 0 : startIndex]!.date,
    base_date: base.date,
    end_date: end.date,
    return: base.close === 0 ? null : end.close / base.close - 1,
  };
}

export function runEventStudy(symbol: string, options: {
  base?: string;
  eventDate?: string;
  benchmark?: string;
  windows?: EventWindow[];
  source?: string;
  interval?: string;
  providerSymbol?: string;
} = {}): JsonObject {
  const eventDate = options.eventDate;
  if (!eventDate) return { ok: false, symbol: symbol.toUpperCase(), error: 'event-date is required' };
  const source = options.source || 'yahoo';
  const interval = options.interval || 'd';
  const rows = marketRows(symbol, { base: options.base, source, interval, providerSymbol: options.providerSymbol });
  if (!rows.length) return { ok: false, symbol: symbol.toUpperCase(), error: 'no target market data', next_command: `data download ${symbol.toUpperCase()} --period 1y` };
  const index = eventIndex(rows, eventDate);
  if (index < 0) return { ok: false, symbol: symbol.toUpperCase(), event_date: eventDate, error: 'event date is after available data' };
  const windows = options.windows?.length ? options.windows : DEFAULT_EVENT_WINDOWS;
  const target = windows.map((window) => windowReturn(rows, index, window));
  const benchmarkRows = options.benchmark ? marketRows(options.benchmark, { base: options.base, source, interval }) : [];
  const benchmarkIndex = benchmarkRows.length ? eventIndex(benchmarkRows, eventDate) : -1;
  const benchmark = benchmarkRows.length && benchmarkIndex >= 0 ? windows.map((window) => windowReturn(benchmarkRows, benchmarkIndex, window)) : [];
  const abnormal = target.map((targetWindow, i) => {
    const benchmarkWindow = benchmark[i];
    const targetReturn = typeof targetWindow.return === 'number' ? targetWindow.return : null;
    const benchmarkReturn = benchmarkWindow && typeof benchmarkWindow.return === 'number' ? benchmarkWindow.return : null;
    return {
      label: String(targetWindow.label),
      target_return: targetReturn,
      benchmark_return: benchmarkReturn,
      excess_return: targetReturn === null || benchmarkReturn === null ? null : targetReturn - benchmarkReturn,
    };
  });
  return {
    ok: true,
    symbol: rows.at(-1)!.ticker,
    event_date: eventDate,
    matched_event_row_date: rows[index]!.date,
    source,
    interval,
    rows: rows.length,
    benchmark_symbol: options.benchmark?.toUpperCase() ?? null,
    benchmark_rows: benchmarkRows.length,
    windows: target,
    benchmark_windows: benchmark,
    abnormal_returns: abnormal,
    note: 'Event study is descriptive context, not trading advice. Check event timing, market hours, and source quality before drawing conclusions.',
  };
}
