import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { marketDatasetPath } from '../data.ts';
import { addIdeaHypothesis, addIdeaSymbol, createIdea, ideaStatus, listIdeas, readIdea } from '../idea.ts';
import { researchReportPath } from '../research.ts';
import { appendJsonl } from '../storage.ts';

test('idea lifecycle stores title, symbols, and hypotheses locally', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-idea-'));
  const idea = createIdea(dir, 'NVDA earnings momentum', { now: '2026-05-05T03:10:00Z' });

  assert.equal(idea.id, 'idea-20260505T031000-nvda-earnings-momentum');
  assert.equal(idea.status, 'draft');
  assert.deepEqual(idea.symbols, []);
  assert.equal(listIdeas(dir).length, 1);

  const withSymbol = addIdeaSymbol(dir, idea.id, 'nvda');
  assert.deepEqual(withSymbol.symbols, ['NVDA']);

  const withHypothesis = addIdeaHypothesis(dir, idea.id, 'Earnings surprise momentum persists for 20 trading days');
  assert.equal(withHypothesis.hypotheses.length, 1);

  const saved = readIdea(dir, idea.id);
  assert.equal(saved.title, 'NVDA earnings momentum');
  assert.deepEqual(saved.symbols, ['NVDA']);
  assert.deepEqual(saved.hypotheses, ['Earnings surprise momentum persists for 20 trading days']);
});

test('idea status recommends existing data, stats, and research commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-idea-status-'));
  const idea = createIdea(dir, 'AAPL buyback event study', { now: '2026-05-05T03:11:00Z' });
  addIdeaSymbol(dir, idea.id, 'AAPL');
  appendJsonl(marketDatasetPath(dir, 'yahoo', 'AAPL', 'd'), {
    ticker: 'AAPL',
    provider_symbol: 'AAPL',
    source: 'yahoo',
    interval: 'd',
    date: '2026-05-04',
    fetched_at: '2026-05-05T03:11:00Z',
    payload: { open: 100, high: 110, low: 99, close: 108, volume: 12345 },
  });
  appendJsonl(researchReportPath('AAPL', dir), { ticker: 'AAPL', report: 'saved context' });

  const status = ideaStatus(dir, idea.id);
  const readiness = status.readiness[0]!;

  assert.equal(readiness.symbol, 'AAPL');
  assert.equal(readiness.market_data, 'ready');
  assert.equal(readiness.validation, 'pass');
  assert.equal(readiness.research, 'saved');
  assert.deepEqual(status.next_commands, ['data validate AAPL', 'stats AAPL']);
});

test('idea status without symbols starts with add-symbol guidance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-idea-empty-'));
  const idea = createIdea(dir, 'Semiconductor momentum', { now: '2026-05-05T03:12:00Z' });

  const status = ideaStatus(dir, idea.id);

  assert.deepEqual(status.readiness, []);
  assert.deepEqual(status.next_commands, [`idea add-symbol ${idea.id} AAPL`]);
});
