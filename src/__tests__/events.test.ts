import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { marketDatasetPath } from '../data.ts';
import { defineEvent, parseEventWindows, runEventStudy } from '../events.ts';
import { runEventStudyRuntime } from '../rustEvent.ts';
import { appendJsonl } from '../storage.ts';

function writeClose(base: string, symbol: string, day: number, close: number) {
  appendJsonl(marketDatasetPath(base, 'yahoo', symbol, 'd'), {
    ticker: symbol,
    provider_symbol: symbol,
    source: 'yahoo',
    interval: 'd',
    date: `2026-01-${String(day).padStart(2, '0')}`,
    fetched_at: '2026-01-01T00:00:00Z',
    payload: { open: close - 1, high: close + 1, low: close - 1, close, volume: 1000 + day },
  });
}

test('event definitions and custom windows are machine-readable', () => {
  const windows = parseEventWindows(['-2,-1', '1,3']);
  const result = defineEvent({
    type: 'competitor_negative',
    sourceSymbol: '005930.KS',
    targetSymbol: 'TSM',
    benchmark: 'SOXX',
    topic: 'Samsung bad news vs TSMC benefit',
    windows,
  });

  assert.equal(result.ok, true);
  assert.equal((result.event_definition as any).target_symbol, 'TSM');
  assert.equal(((result.event_definition as any).windows as any[]).length, 2);
  assert.match(JSON.stringify(result.next), /event study TSM/);
});

test('event study computes target and benchmark windows from saved data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-event-study-'));
  for (let day = 1; day <= 30; day += 1) {
    writeClose(dir, 'TSM', day, 100 + day);
    writeClose(dir, 'SOXX', day, 200 + day);
  }

  const result = runEventStudy('TSM', {
    base: dir,
    eventDate: '2026-01-15',
    benchmark: 'SOXX',
    windows: parseEventWindows(['0,0', '1,5']),
  });

  assert.equal(result.ok, true);
  assert.equal(result.symbol, 'TSM');
  assert.equal(result.matched_event_row_date, '2026-01-15');
  assert.equal(result.benchmark_symbol, 'SOXX');
  assert.equal((result.windows as any[]).length, 2);
  assert.equal((result.abnormal_returns as any[]).length, 2);
});

test('event study runtime preserves a TypeScript fallback contract', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-event-runtime-'));
  for (let day = 1; day <= 10; day += 1) writeClose(dir, 'TSM', day, 100 + day);

  const previous = process.env.QUANTOPS_EVENT_ENGINE;
  process.env.QUANTOPS_EVENT_ENGINE = 'typescript';
  const result = runEventStudyRuntime('TSM', {
    base: dir,
    eventDate: '2026-01-05',
    windows: parseEventWindows(['1,3']),
  });
  if (previous === undefined) delete process.env.QUANTOPS_EVENT_ENGINE;
  else process.env.QUANTOPS_EVENT_ENGINE = previous;

  assert.equal(result.ok, true);
  assert.equal(result.engine, 'typescript');
  assert.equal((result.windows as any[]).length, 1);
});
