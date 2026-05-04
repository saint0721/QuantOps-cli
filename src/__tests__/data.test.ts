import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadHistory, downloadWatchlist, listDatasets, marketDatasetPath, normalizeDate, normalizeStooqSymbol, parseStooqCsv, parseYahooChart, stooqUrl, yahooUrl } from '../data.ts';
import { readJsonl, writeWatchlist } from '../storage.ts';

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
  assert.equal(normalizeStooqSymbol('aapl'), 'aapl.us');
  assert.equal(normalizeStooqSymbol('^spx'), '^spx');
  assert.match(stooqUrl({ symbol: 'AAPL', start: '2026-01-02', end: '2026-01-03' }), /s=aapl\.us/);
  assert.match(stooqUrl({ symbol: 'AAPL', start: '2026-01-02', end: '2026-01-03' }), /d1=20260102/);
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
