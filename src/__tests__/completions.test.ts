import test from 'node:test';
import assert from 'node:assert/strict';
import { completeLine, completionCandidates } from '../cli.ts';

test('tab completion suggests root slash and nested commands', () => {
  assert.ok(completionCandidates('', 'quant').includes('/status'));
  assert.ok(completionCandidates('', 'quant').includes('doctor'));
  assert.ok(completionCandidates('', 'quant').includes('collect'));
  assert.ok(completionCandidates('', 'quant').includes('/collect'));
  assert.ok(completionCandidates('', 'quant').includes('data'));
  assert.ok(completionCandidates('', 'quant').includes('discover'));
  assert.ok(completionCandidates('', 'quant').includes('sources'));
  assert.ok(completionCandidates('', 'quant').includes('symbol'));
  assert.ok(completionCandidates('', 'quant').includes('stats'));
  assert.ok(completionCandidates('', 'quant').includes('/data'));
  assert.ok(completionCandidates('', 'quant').includes('/discover'));
  assert.ok(completionCandidates('', 'quant').includes('/sources'));
  assert.ok(completionCandidates('', 'quant').includes('/symbol'));
  assert.ok(completionCandidates('', 'quant').includes('/stats'));
  assert.deepEqual(completionCandidates('quote ', 'quant'), ['fetch', 'history']);
  assert.deepEqual(completionCandidates('/quote ', 'quant'), ['fetch', 'history']);
  assert.deepEqual(completionCandidates('collect ', 'quant'), ['plan', 'quote', 'watchlist']);
  assert.deepEqual(completionCandidates('/collect ', 'quant'), ['plan', 'quote', 'watchlist']);
  assert.deepEqual(completionCandidates('collect plan ', 'quant'), ['--watchlist']);
  assert.deepEqual(completionCandidates('/collect plan ', 'quant'), ['--watchlist']);
  assert.deepEqual(completionCandidates('/collect plan --watchlist ', 'quant'), []);
  assert.deepEqual(completionCandidates('/collect quote AAPL ', 'quant'), []);
  assert.deepEqual(completionCandidates('data ', 'quant'), ['download', 'watchlist', 'list']);
  assert.deepEqual(completionCandidates('/data ', 'quant'), ['download', 'watchlist', 'list']);
  assert.ok(completionCandidates('/data download AAPL ', 'quant').includes('--period'));
  assert.ok(completionCandidates('/data watchlist ', 'quant').includes('--start'));
  assert.deepEqual(completionCandidates('/data list ', 'quant'), []);
  assert.deepEqual(completionCandidates('/discover ', 'quant'), ['trending', 'most-active', 'gainers', 'losers', 'etf', 'semiconductor']);
  assert.deepEqual(completionCandidates('/sources ', 'quant'), ['list', 'stooq', 'tossctl', 'yahoo', 'nasdaq', 'vendor']);
  assert.deepEqual(completionCandidates('/symbol ', 'quant'), ['search', 'info']);
  assert.deepEqual(completionCandidates('/stats AAPL ', 'quant'), []);
  assert.deepEqual(completionCandidates('/watchlist ', 'quant'), ['add', 'fetch', 'list', 'remove']);
  assert.ok(completeLine('/co', 'quant')[0].includes('/collect'));
  assert.ok(completeLine('runt', 'quant')[0].includes('runtime'));
  assert.ok(completeLine('tmux start --s', 'quant')[0].includes('--session'));
});

test('codex mode limits completion to slash controls', () => {
  const candidates = completionCandidates('hello', 'codex');
  assert.ok(candidates.includes('/quant'));
  assert.equal(candidates.includes('quote'), false);
});
