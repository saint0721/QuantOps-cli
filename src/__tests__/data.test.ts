import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dataInfo, downloadHistory, downloadWatchlist, listDatasets, marketDatasetPath, normalizeDate, normalizeStooqSymbol, parseStooqCsv, parseYahooChart, refreshHistory, refreshWatchlist, safeDatasetName, stooqUrl, validateData, yahooUrl } from '../data.ts';
import { validateDataRuntime } from '../rustValidate.ts';
import { appendJsonl, readJsonl, writeWatchlist } from '../storage.ts';

const CSV = [
  'Date,Open,High,Low,Close,Volume',
  '2026-01-02,100,110,99,108,12345',
  '2026-01-03,108,112,107,111,23456',
].join('\n');

const YAHOO = JSON.stringify({
  chart: {
    result: [{
      timestamp: [1704153600, 1704240000],
      indicators: {
        quote: [{
          open: [100, 108],
          high: [110, 112],
          low: [99, 107],
          close: [108, 111],
          volume: [12345, 23456],
        }],
        adjclose: [{ adjclose: [107.5, 110.5] }],
      },
    }],
    error: null,
  },
});

test('stooq helpers normalize dates, symbols, and URLs', () => {
  assert.equal(normalizeDate('2026-01-02'), '20260102');
  assert.throws(() => normalizeDate('2026-02-31'), /invalid calendar date/);
  assert.equal(normalizeStooqSymbol('aapl'), 'aapl.us');
  assert.equal(normalizeStooqSymbol('^spx'), '^spx');
  assert.match(stooqUrl({ symbol: 'AAPL', start: '2026-01-02', end: '2026-01-03' }), /s=aapl\.us/);
  assert.match(stooqUrl({ symbol: 'AAPL', start: '2026-01-02', end: '2026-01-03' }), /d1=20260102/);
});

test('dataset names strip path separators from provider input', () => {
  assert.equal(safeDatasetName('../AAPL/evil', '1/d'), 'aapl_evil_1_d');
  assert.doesNotMatch(marketDatasetPath('/tmp/tq', 'yahoo', '../AAPL/evil', 'd'), /\.\./);
});

test('yahoo helpers build chart URLs and parse OHLCV JSON', () => {
  const url = yahooUrl({ symbol: 'AAPL', source: 'yahoo', start: '2024-01-02', end: '2024-01-03' });
  assert.match(url, /query1\.finance\.yahoo\.com/);
  assert.match(url, /interval=1d/);
  assert.match(url, /period1=/);
  const rows = parseYahooChart(YAHOO);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.date, '2024-01-02');
  assert.equal((rows[1] as any)?.adj_close, 110.5);
});

test('parseStooqCsv extracts OHLCV rows', () => {
  const rows = parseStooqCsv(CSV);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.date, '2026-01-02');
  assert.equal((rows[1] as any)?.close, 111);
});

test('downloadHistory stores raw CSV, merged stooq market rows, and manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-data-'));
  const result = await downloadHistory({ symbol: 'AAPL', source: 'stooq', start: '2026-01-02', end: '2026-01-03' }, { base: dir, fetcher: () => CSV });

  assert.equal(result.ok, true);
  assert.equal(result.ticker, 'AAPL');
  assert.equal(result.rows, 2);
  assert.equal(result.new_rows, 2);
  const records = readJsonl(marketDatasetPath(dir, 'stooq', 'aapl.us', 'd'));
  assert.equal(records.length, 2);
  assert.equal((records[0]?.payload as any).close, 108);

  const second = await downloadHistory({ symbol: 'AAPL', source: 'stooq', start: '2026-01-02', end: '2026-01-03' }, { base: dir, fetcher: () => CSV });
  assert.equal(second.new_rows, 0);
});

test('downloadHistory stores yahoo chart rows when requested', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-yahoo-data-'));
  const result = await downloadHistory({ symbol: 'AAPL', source: 'yahoo', start: '2024-01-02', end: '2024-01-03' }, { base: dir, fetcher: () => YAHOO });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'yahoo');
  assert.equal(result.provider_symbol, 'AAPL');
  const records = readJsonl(marketDatasetPath(dir, 'yahoo', 'AAPL', 'd'));
  assert.equal(records.length, 2);
  assert.equal((records[0]?.payload as any).adj_close, 107.5);
});

test('downloadWatchlist summarizes per-symbol downloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-watchlist-data-'));
  writeWatchlist(['aapl', 'msft'], dir);

  const result = await downloadWatchlist({ base: dir, source: 'stooq', fetcher: () => CSV });

  assert.equal(result.ok, true);
  assert.equal(result.downloaded, 2);
  assert.equal(listDatasets(dir).length, 2);
});

test('dataInfo summarizes saved market datasets with age and next command', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-data-info-'));
  await downloadHistory({ symbol: 'AAPL', source: 'yahoo', start: '2024-01-02', end: '2024-01-03' }, { base: dir, fetcher: () => YAHOO });

  const info = dataInfo(dir, 'AAPL', { now: '2024-01-05' });

  assert.equal(info.ok, true);
  assert.equal(info.count, 1);
  const dataset = (info.datasets as any[])[0];
  assert.equal(dataset.provider_symbol, 'AAPL');
  assert.equal(dataset.latest_age_days, 2);
  assert.match(dataset.next_command, /data refresh AAPL --source yahoo/);

  const broad = dataInfo(dir, 'A', { now: '2024-01-05' });
  assert.equal(broad.ok, false);
});

test('validateData flags duplicate invalid stale rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-data-validate-'));
  const path = marketDatasetPath(dir, 'yahoo', 'AAPL', 'd');
  appendJsonl(path, { ticker: 'AAPL', provider_symbol: 'AAPL', source: 'yahoo', interval: 'd', date: '2024-01-03', payload: { close: 111, volume: 10 } });
  appendJsonl(path, { ticker: 'AAPL', provider_symbol: 'AAPL', source: 'yahoo', interval: 'd', date: '2024-01-02', payload: { close: 'bad', volume: 'bad' } });
  appendJsonl(path, { ticker: 'AAPL', provider_symbol: 'AAPL', source: 'yahoo', interval: 'd', date: '2024-01-02', payload: { close: 112, volume: 12 } });

  const result = validateData(dir, 'AAPL', { now: '2024-01-20', maxStaleDays: 7 });
  const codes = (result.issues as any[]).map((issue) => issue.code);

  assert.equal(result.ok, false);
  assert.ok(codes.includes('unsorted_rows'));
  assert.ok(codes.includes('invalid_close'));
  assert.ok(codes.includes('invalid_volume'));
  assert.ok(codes.includes('duplicate_date'));
  assert.ok(codes.includes('stale_dataset'));
});

test('validateDataRuntime keeps a TypeScript fallback contract', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-data-validate-runtime-'));
  const path = marketDatasetPath(dir, 'yahoo', 'AAPL', 'd');
  appendJsonl(path, { ticker: 'AAPL', provider_symbol: 'AAPL', source: 'yahoo', interval: 'd', date: '2024-01-02', payload: { close: 111, volume: 10 } });

  const previous = process.env.QUANTOPS_VALIDATE_ENGINE;
  process.env.QUANTOPS_VALIDATE_ENGINE = 'typescript';
  const result = validateDataRuntime(dir, 'AAPL', { now: '2024-01-03', maxStaleDays: 7 });
  if (previous === undefined) delete process.env.QUANTOPS_VALIDATE_ENGINE;
  else process.env.QUANTOPS_VALIDATE_ENGINE = previous;

  assert.equal(result.ok, true);
  assert.equal(result.engine, 'typescript');
  assert.equal((result.datasets as any[])[0].latest_age_days, 1);
});

test('refreshHistory uses the next day after latest saved row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-data-refresh-'));
  await downloadHistory({ symbol: 'AAPL', source: 'yahoo', start: '2024-01-02', end: '2024-01-03' }, { base: dir, fetcher: () => YAHOO });

  const result = await refreshHistory({ symbol: 'AAPL', source: 'yahoo' }, { base: dir, today: '2024-01-10', fetcher: () => YAHOO });

  assert.equal(result.ok, true);
  assert.equal(result.previous_latest_date, '2024-01-03');
  assert.equal(result.refresh_start, '2024-01-04');
  assert.equal(result.refresh_end, '2024-01-10');
});

test('refreshWatchlist summarizes refreshed tickers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-watchlist-refresh-'));
  writeWatchlist(['aapl', 'msft'], dir);

  const result = await refreshWatchlist({ base: dir, source: 'yahoo', today: '2024-01-10', fetcher: () => YAHOO });

  assert.equal(result.ok, true);
  assert.equal(result.refreshed, 2);
  assert.equal((result.results as any[]).length, 2);
});
