import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectQuote, collectionPlan, collectionSummary, normalizeTickers, runCollectionPlan } from '../collect.ts';
import { readJsonl, writeWatchlist } from '../storage.ts';
import type { TossResult } from '../toss.ts';

function tossOk(stdout: string): TossResult {
  return { ok: true, returncode: 0, stdout, stderr: '', command: ['tossctl', 'quote', 'get', 'AAPL', '--output', 'json'] };
}

test('collection planning normalizes explicit tickers and watchlist targets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-collect-'));
  writeWatchlist(['spy', 'aapl'], dir);

  const plan = collectionPlan({ dataDir: dir, tickers: ['msft', 'AAPL'], includeWatchlist: true });

  assert.equal(plan.provider, 'tossctl');
  assert.equal(plan.read_only, true);
  assert.deepEqual(plan.targets.map((target) => target.ticker), ['AAPL', 'MSFT', 'SPY']);
  assert.deepEqual(plan.warnings, []);
});

test('collection plan warns when no ticker source exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-collect-empty-'));
  const plan = collectionPlan({ dataDir: dir });

  assert.deepEqual(plan.targets, []);
  assert.equal(plan.warnings.length, 1);
});

test('collectQuote stores redacted tossctl quote payload in existing quote history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-collect-quote-'));
  const result = collectQuote(dir, 'aapl', () => tossOk('{"price":123,"account_id":"secret"}'));

  assert.equal(result.ok, true);
  assert.equal(result.ticker, 'AAPL');
  if (!result.ok) assert.fail('expected collection success');
  const records = readJsonl(result.saved_to);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.ticker, 'AAPL');
  assert.equal(records[0]?.provider, 'tossctl');
  assert.equal((records[0]?.payload as any).price, 123);
  assert.equal((records[0]?.payload as any).account_id, '<redacted>');
});

test('runCollectionPlan summarizes per-target failures without throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-collect-run-'));
  const plan = collectionPlan({ dataDir: dir, tickers: ['AAPL', 'MSFT'] });
  const results = runCollectionPlan(plan, (ticker) => ticker === 'AAPL'
    ? tossOk('{"price":10}')
    : { ok: false, returncode: 7, stdout: '', stderr: 'offline', command: ['tossctl'] });
  const summary = collectionSummary(results);

  assert.equal(summary.ok, false);
  assert.equal(summary.collected, 1);
  assert.equal(summary.failed, 1);
});

test('normalizeTickers trims, uppercases, dedupes, and sorts', () => {
  assert.deepEqual(normalizeTickers([' msft ', 'AAPL', 'msft', '']), ['AAPL', 'MSFT']);
});
