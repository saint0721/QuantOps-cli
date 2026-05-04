import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { marketDatasetPath } from '../data.ts';
import { buildResearchContext, buildResearchPrompt, researchReportPath, runResearch } from '../research.ts';
import { appendJsonl } from '../storage.ts';

function writeMarketRow(base: string, close: number, day: number) {
  appendJsonl(marketDatasetPath(base, 'yahoo', 'AAPL', 'd'), {
    ticker: 'AAPL',
    provider_symbol: 'AAPL',
    source: 'yahoo',
    interval: 'd',
    date: `2026-01-${String(day).padStart(2, '0')}`,
    fetched_at: '2026-01-01T00:00:00Z',
    payload: { open: close - 1, high: close + 1, low: close - 2, close, volume: 1000 + day },
  });
}

function seedMarket(base: string) {
  for (let day = 1; day <= 60; day += 1) writeMarketRow(base, 100 + day, day);
}

test('research reports actionable missing-data fallback before external research', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-research-missing-'));

  const result = runResearch('AAPL', { base: dir }, () => ({ ok: true, text: 'should not run' }));

  assert.equal(result.ok, false);
  assert.equal(result.missing_data, true);
  assert.equal(result.next_command, 'data download AAPL --period 1y');
  assert.match(result.report, /No saved market dataset found for AAPL/);
});

test('research prompt includes local context and explicit safety boundaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-research-prompt-'));
  seedMarket(dir);

  const context = buildResearchContext('aapl', { base: dir });
  assert.ok(context);
  const prompt = buildResearchPrompt(context!);

  assert.match(prompt, /recent news, earnings, filings/);
  assert.match(prompt, /Do not provide buy\/sell\/hold advice/);
  assert.match(prompt, /Do not produce a single numeric buy\/sell score/);
  assert.match(prompt, /Do not suggest or perform order placement/);
  assert.match(prompt, /default to contextual\/uncertain wording/);
  assert.match(prompt, /"ticker": "AAPL"/);
});

test('research persists a redacted report under data research jsonl', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-research-save-'));
  seedMarket(dir);

  const result = runResearch('AAPL', { base: dir, now: '2026-05-04T00:00:00Z' }, () => ({
    ok: true,
    text: 'Event/news timeline: earnings coverage may loosely line up with movement. No advice.',
  }));

  assert.equal(result.ok, true);
  assert.equal(result.saved_to, researchReportPath('AAPL', dir));
  assert.ok(existsSync(result.saved_to!));
  const saved = readFileSync(result.saved_to!, 'utf8');
  assert.match(saved, /research\/AAPL\.jsonl/);
  assert.match(saved, /Uncertainty \/ source boundaries/);
  assert.match(saved, /Do not provide buy\/sell\/hold advice/);
});
