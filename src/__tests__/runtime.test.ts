import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRuntimeSnapshot, recordRuntime, renderRuntimeLine, runtimeStatePath } from '../runtime.ts';
import { appendJsonl, quoteHistoryPath, readJsonl, writeWatchlist } from '../storage.ts';

test('runtime snapshot writes and renders compact status line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-ts-'));
  writeWatchlist(['AAPL'], dir);
  appendJsonl(quoteHistoryPath('AAPL', dir), { ticker: 'AAPL', fetched_at: 't1', payload: { price: 1 } } as any);
  appendJsonl(quoteHistoryPath('AAPL', dir), { ticker: 'AAPL', fetched_at: 't2', payload: { price: 2 } } as any);
  appendJsonl(quoteHistoryPath('AAPL', dir), { ticker: 'AAPL', fetched_at: 't3', payload: { price: 3 } } as any);
  const snapshot = buildRuntimeSnapshot({ base: dir, mode: 'quant', lastAction: 'test' });
  assert.equal(snapshot.watchlist_count, 1);
  assert.equal(snapshot.quote_samples, 3);
  assert.deepEqual(snapshot.classify_ready, ['AAPL']);
  recordRuntime({ base: dir, mode: 'quant', lastAction: 'test' });
  assert.ok(readJsonl(quoteHistoryPath('AAPL', dir)).length === 3);
  assert.ok(runtimeStatePath(dir).endsWith('runtime/state.json'));
  const line = renderRuntimeLine(snapshot);
  assert.match(line, /\[QuantOps 0\.1\.0\]/);
  assert.match(line, /quotes:1\/3 samples/);
  assert.doesNotMatch(line, /last:/);
  assert.doesNotMatch(line, /updated:/);
});
