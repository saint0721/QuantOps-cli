import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { marketDatasetPath } from '../data.ts';
import { runBacktest, formatBacktestResult, listBacktestStrategies } from '../backtest.ts';
import { appendJsonl } from '../storage.ts';

function writeYahooClose(base: string, day: number, close: number) {
  appendJsonl(marketDatasetPath(base, 'yahoo', 'AAPL', 'd'), {
    ticker: 'AAPL',
    provider_symbol: 'AAPL',
    source: 'yahoo',
    interval: 'd',
    date: `2026-01-${String(day).padStart(2, '0')}`,
    fetched_at: '2026-01-01T00:00:00Z',
    payload: { open: close - 1, high: close + 1, low: close - 1, close, volume: 1000 + day },
  });
}

test('backtest runs deterministic moving-average strategy on saved OHLCV data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-backtest-'));
  for (let i = 1; i <= 80; i += 1) writeYahooClose(dir, i, 100 + i);

  const result = runBacktest('AAPL', { base: dir, source: 'yahoo', strategy: 'ma-cross', fast: 5, slow: 20, save: false });

  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'ma-cross');
  assert.equal(result.rows, 80);
  assert.equal(result.parameters.fast, 5);
  assert.equal(typeof result.total_return, 'number');
  assert.match(formatBacktestResult(result), /Backtest: AAPL/);
  assert.ok(listBacktestStrategies().some((strategy) => strategy.name === 'momentum'));
});

test('backtest points beginners to download when data is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-backtest-missing-'));

  const result = runBacktest('AAPL', { base: dir, source: 'yahoo' });

  assert.equal(result.ok, false);
  assert.equal(result.next_command, 'data download AAPL --period 1y');
  assert.match(formatBacktestResult(result), /Backtest blocked/);
});
