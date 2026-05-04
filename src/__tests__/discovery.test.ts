import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, searchSymbols, sourceById, symbolInfo } from '../discovery.ts';
import { periodToDateRange } from '../cli.ts';

test('source catalog explains available data providers', () => {
  assert.equal(sourceById('stooq')?.auth, 'no API key');
  assert.match(sourceById('yahoo')?.kind ?? '', /screeners/);
});

test('discover buckets expose app-like market exploration candidates', () => {
  const trending = discover('trending');
  assert.equal(trending.category, 'trending');
  assert.ok(trending.items.some((item) => item.symbol === 'SOXL'));
  assert.ok(discover('etf leveraged').items.every((item) => item.tags.includes('leveraged')));
});

test('symbol search and info cover ETF names and tags', () => {
  assert.equal(symbolInfo('SOXL')?.category, 'leveraged semiconductor ETF');
  assert.ok(searchSymbols('semiconductor').some((item) => item.symbol === 'NVDA'));
  assert.ok(searchSymbols('sox').some((item) => item.symbol === 'SOXL'));
});

test('period helper converts friendly periods to explicit date ranges', () => {
  const now = new Date(Date.UTC(2026, 4, 4));
  assert.deepEqual(periodToDateRange('1y', now), { start: '2025-05-04', end: '2026-05-04' });
  assert.deepEqual(periodToDateRange('6mo', now), { start: '2025-11-04', end: '2026-05-04' });
  assert.deepEqual(periodToDateRange('ytd', now), { start: '2026-01-01', end: '2026-05-04' });
});
