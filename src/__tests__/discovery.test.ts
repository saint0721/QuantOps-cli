import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover, discoverMarket, searchSymbols, searchSymbolsLive, sourceById, symbolInfo } from '../discovery.ts';
import { periodToDateRange } from '../period.ts';

test('source catalog explains available data providers', () => {
  assert.match(sourceById('stooq')?.auth ?? '', /STOOQ_API_KEY/);
  assert.match(sourceById('yahoo')?.coverage ?? '', /OHLCV/);
});

test('discover buckets expose app-like market exploration candidates', () => {
  const trending = discover('trending');
  assert.equal(trending.category, 'trending');
  assert.ok(trending.items.some((item) => item.symbol === 'SOXL'));
  assert.ok(discover('etf leveraged').items.every((item) => item.tags.includes('leveraged')));
});

test('discoverMarket can fetch live-style Yahoo screeners and cache results', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'tossquant-discover-'));
  const fetcher = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      finance: {
        result: [{
          quotes: [
            { symbol: 'BTC-USD', shortName: 'Bitcoin USD', quoteType: 'CRYPTOCURRENCY' },
            { symbol: 'AMD', shortName: 'Advanced Micro Devices, Inc.', quoteType: 'EQUITY', fullExchangeName: 'NasdaqGS' },
            { symbol: 'SOXL', shortName: 'Direxion Daily Semiconductor Bull 3X Shares', quoteType: 'ETF' },
          ],
        }],
      },
    }),
  }) as Response;

  const result = await discoverMarket({ category: 'most-active', source: 'yahoo', limit: 2, dataDir: tmp, fetcher });

  assert.equal(result.live, true);
  assert.equal(result.source, 'yahoo');
  assert.equal(result.items[0]?.symbol, 'BTC-USD');
  assert.equal(result.items[0]?.assetClass, 'crypto');
  assert.match(result.items[0]?.note ?? '', /crypto download provider/);
  assert.equal(result.items[1]?.symbol, 'AMD');
  assert.ok(result.cachePath?.endsWith('most-active.json'));
  const cached = JSON.parse(await readFile(result.cachePath!, 'utf8'));
  assert.equal(cached.items.length, 2);
});

test('discoverMarket falls back to local buckets when live source fails', async () => {
  const result = await discoverMarket({
    category: 'trending',
    source: 'yahoo',
    fetcher: async () => { throw new Error('network unavailable'); },
  });

  assert.equal(result.live, false);
  assert.equal(result.source, 'local');
  assert.match(result.fallback ?? '', /network unavailable/);
  assert.ok(result.items.some((item) => item.symbol === 'SOXL'));
});

test('symbol search and info cover ETF names and tags', () => {
  assert.equal(symbolInfo('SOXL')?.category, 'leveraged semiconductor ETF');
  assert.ok(searchSymbols('semiconductor').some((item) => item.symbol === 'NVDA'));
  assert.ok(searchSymbols('sox').some((item) => item.symbol === 'SOXL'));
});

test('live symbol search finds Yahoo symbols beyond the local curated set', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'tossquant-symbols-'));
  const fetcher = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      quotes: [
        { symbol: 'TSM', shortName: 'Taiwan Semiconductor Manufacturing Company Limited', quoteType: 'EQUITY', exchange: 'NYQ' },
        { symbol: '2330.TW', shortName: 'Taiwan Semiconductor Manufacturing Company Limited', quoteType: 'EQUITY', exchange: 'TAI' },
      ],
    }),
  }) as Response;

  const result = await searchSymbolsLive({ query: 'TSM', source: 'yahoo', limit: 10, dataDir: tmp, fetcher });

  assert.equal(result.live, true);
  assert.equal(result.source, 'yahoo');
  assert.equal(result.items[0]?.symbol, 'TSM');
  assert.match(result.items[0]?.name ?? '', /Taiwan Semiconductor/);
  assert.ok(result.cachePath?.endsWith('TSM.json'));
});

test('live symbol search falls back to local search on failure', async () => {
  const result = await searchSymbolsLive({
    query: 'SOXL',
    source: 'yahoo',
    fetcher: async () => { throw new Error('search unavailable'); },
  });

  assert.equal(result.live, false);
  assert.equal(result.source, 'local');
  assert.match(result.fallback ?? '', /search unavailable/);
  assert.ok(result.items.some((item) => item.symbol === 'SOXL'));
});

test('period helper converts friendly periods to explicit date ranges', () => {
  const now = new Date(Date.UTC(2026, 4, 4));
  assert.deepEqual(periodToDateRange('1y', now), { start: '2025-05-04', end: '2026-05-04' });
  assert.deepEqual(periodToDateRange('6mo', now), { start: '2025-11-04', end: '2026-05-04' });
  assert.deepEqual(periodToDateRange('2w', now), { start: '2026-04-20', end: '2026-05-04' });
  assert.deepEqual(periodToDateRange('ytd', now), { start: '2026-01-01', end: '2026-05-04' });
});
