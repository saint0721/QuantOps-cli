import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendJsonl, quoteHistoryPath, writeWatchlist } from '../storage.ts';
import { auditAll, auditQuotes } from '../audit.ts';

test('auditAll warns when no watchlist or quote history exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-audit-empty-'));

  const findings = auditAll(dir);

  assert.equal(findings.some((item) => item.code === 'empty_watchlist'), true);
});

test('auditQuotes catches malformed, duplicate, sensitive, and large jump records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-audit-quotes-'));
  writeWatchlist(['AAPL'], dir);
  const path = quoteHistoryPath('AAPL', dir);
  mkdirSync(dirname(path), { recursive: true });
  appendJsonl(path, { ticker: 'AAPL', fetched_at: '2026-01-01T00:00:00Z', payload: { price: 100, account_id: 'secret' } });
  appendJsonl(path, { ticker: 'AAPL', fetched_at: '2026-01-01T00:00:00Z', payload: { price: 150 } });
  appendFileSync(path, '{bad json\n', 'utf8');

  const findings = auditQuotes(dir, 'AAPL');

  assert.equal(findings.some((item) => item.code === 'sensitive_key'), true);
  assert.equal(findings.some((item) => item.code === 'duplicate_timestamp'), true);
  assert.equal(findings.some((item) => item.code === 'large_price_jump'), true);
  assert.equal(findings.some((item) => item.code === 'malformed_record'), true);
});
