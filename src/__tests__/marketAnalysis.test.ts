import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendJsonl } from '../storage.ts';
import { marketDatasetPath } from '../data.ts';
import { marketRows, marketStats } from '../marketAnalysis.ts';

function writeClose(base: string, date: string, close: number, volume = 1000) {
  appendJsonl(marketDatasetPath(base, 'stooq', 'aapl.us', 'd'), {
    ticker: 'AAPL',
    provider_symbol: 'aapl.us',
    source: 'stooq',
    interval: 'd',
    date,
    fetched_at: '2026-01-01T00:00:00Z',
    payload: { open: close - 1, high: close + 1, low: close - 2, close, volume },
  });
}

test('marketRows reads saved OHLCV records in date order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-market-rows-'));
  writeClose(dir, '2026-01-03', 103);
  writeClose(dir, '2026-01-02', 100);

  const rows = marketRows('AAPL', { base: dir });

  assert.deepEqual(rows.map((row) => row.date), ['2026-01-02', '2026-01-03']);
  assert.equal(rows[1]?.close, 103);
});

test('marketStats reports readiness, return, volatility, and drawdown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-market-stats-'));
  for (let i = 1; i <= 60; i += 1) writeClose(dir, `2026-01-${String(i).padStart(2, '0')}`, 100 + i);

  const stats = marketStats('AAPL', { base: dir });

  assert.equal(stats.ok, true);
  assert.equal(stats.rows, 60);
  assert.equal((stats.readiness as any).backtest_ready, true);
  assert.equal(stats.regime, 'trend-up');
  assert.equal(typeof stats.annualized_volatility, 'number');
});

test('marketStats points beginners to download when dataset is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-market-missing-'));

  const stats = marketStats('AAPL', { base: dir });

  assert.equal(stats.ok, false);
  assert.equal(stats.next_command, 'data download AAPL');
});
