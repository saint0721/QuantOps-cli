import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWatchlist, redact, writeWatchlist } from '../storage.ts';

test('storage redacts sensitive keys and normalizes watchlist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-ts-'));
  writeWatchlist(['aapl', 'SPY', 'aapl'], dir);
  assert.deepEqual(readWatchlist(dir), ['AAPL', 'SPY']);
  assert.equal((redact({ token: 'secret', nested: { account_id: 'acct', price: 1 } }) as any).token, '<redacted>');
});
