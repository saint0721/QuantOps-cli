import { marketStatsRuntime } from './rustStats.ts';
import type { JsonObject } from './storage.ts';
import { table } from './ui/table.ts';

export type CompareOptions = {
  base?: string;
  source?: string;
  interval?: string;
  providerSymbol?: string;
};

export function compareSymbols(symbols: string[], options: CompareOptions = {}): JsonObject {
  const targets = symbols.map((symbol) => symbol.toUpperCase());
  const results = targets.map((symbol) => marketStatsRuntime(symbol, {
    base: options.base,
    source: options.source || 'yahoo',
    interval: options.interval || 'd',
    providerSymbol: targets.length === 1 ? options.providerSymbol : undefined,
  }));
  return {
    ok: results.every((item) => item.ok !== false),
    command: 'compare',
    symbols: targets,
    results,
    note: 'Compare uses saved local datasets; download/validate missing symbols before interpreting relative performance.',
  };
}

export function formatCompareResult(payload: JsonObject): string {
  const results = Array.isArray(payload.results) ? payload.results as JsonObject[] : [];
  return table(
    ['symbol', 'ok', 'rows', 'start', 'end', 'total_return', 'volatility', 'regime'],
    results.map((item) => [
      String(item.ticker ?? '-'),
      item.ok === false ? 'no' : 'yes',
      String(item.rows ?? '-'),
      String(item.start_date ?? '-'),
      String(item.end_date ?? '-'),
      item.total_return === null || item.total_return === undefined ? '-' : Number(item.total_return).toFixed(4),
      item.volatility === null || item.volatility === undefined ? '-' : Number(item.volatility).toFixed(4),
      String(item.regime ?? '-'),
    ]),
  );
}
