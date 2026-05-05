import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendJsonl } from '../storage.ts';
import { marketDatasetPath } from '../data.ts';
import { listTools, runTool, toolSummaries, redactToolOutput, redactToolText } from '../tools.ts';

function writeYahooClose(base: string, day: number, close: number) {
  appendJsonl(marketDatasetPath(base, 'yahoo', 'AAPL', 'd'), {
    ticker: 'AAPL', provider_symbol: 'AAPL', source: 'yahoo', interval: 'd', date: `2026-01-${String(day).padStart(2, '0')}`, fetched_at: '2026-01-01T00:00:00Z', payload: { open: close, high: close + 1, low: close - 1, close, volume: 1000 + day },
  });
}

function writeYahooCloseFor(base: string, symbol: string, day: number, close: number) {
  appendJsonl(marketDatasetPath(base, 'yahoo', symbol, 'd'), {
    ticker: symbol, provider_symbol: symbol, source: 'yahoo', interval: 'd', date: `2026-01-${String(day).padStart(2, '0')}`, fetched_at: '2026-01-01T00:00:00Z', payload: { open: close, high: close + 1, low: close - 1, close, volume: 1000 + day },
  });
}

test('tool registry exposes a curated safe allowlist without trading mutation tools', () => {
  const names = listTools().map((tool) => tool.name);

  assert.ok(names.includes('data.info'));
  assert.ok(names.includes('stats.run'));
  assert.ok(names.includes('event.study'));
  assert.equal(names.some((name) => name.includes('order')), false);
  assert.equal(toolSummaries().every((tool) => tool.mutates_trading === false), true);
  assert.equal(toolSummaries().every((tool) => typeof tool.rtk_command === 'string' && tool.rtk_command.startsWith('rtk ')), true);
});

test('stats.run tool reads local yahoo market data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-tools-stats-'));
  for (let i = 1; i <= 60; i += 1) writeYahooClose(dir, i, 100 + i);

  const result = await runTool('stats.run', { symbol: 'AAPL', source: 'yahoo' }, { base: dir });

  assert.equal(result.ok, true);
  assert.equal(result.output.ticker, 'AAPL');
  assert.equal((result.output.readiness as any).backtest_ready, true);
  assert.equal(result.rtk_command, 'rtk stats AAPL --source yahoo --json');
});

test('event.study tool routes event windows through the runtime contract', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-tools-event-'));
  const previous = process.env.QUANTOPS_EVENT_ENGINE;
  process.env.QUANTOPS_EVENT_ENGINE = 'typescript';
  for (let i = 1; i <= 20; i += 1) {
    writeYahooCloseFor(dir, 'TSM', i, 100 + i);
    writeYahooCloseFor(dir, 'SOXX', i, 200 + i);
  }

  try {
    const result = await runTool('event.study', { symbol: 'TSM', event_date: '2026-01-10', benchmark: 'SOXX', windows: ['1,5'], source: 'yahoo' }, { base: dir });

    assert.equal(result.ok, true);
    assert.equal(result.output.symbol, 'TSM');
    assert.equal(result.output.benchmark_symbol, 'SOXX');
    assert.equal(result.output.engine, 'typescript');
    assert.equal(result.rtk_command, 'rtk event study TSM --event-date 2026-01-10 --benchmark SOXX --source yahoo --window 1,5 --json');
  } finally {
    if (previous === undefined) delete process.env.QUANTOPS_EVENT_ENGINE;
    else process.env.QUANTOPS_EVENT_ENGINE = previous;
  }
});


test('tool output redacts provider URL query secrets before text rendering', () => {
  const output = redactToolOutput({ ok: true, url: 'https://example.test/download?s=aapl&apikey=super-secret&token=abc' } as any) as any;

  assert.equal(output.url, 'https://example.test/download?s=aapl&apikey=<redacted>&token=<redacted>');
});


test('tool text redaction covers thrown error-style strings', () => {
  const text = redactToolText('failed https://example.test/?apikey=super-secret access_token=abc session_id=sess-123 sk-abcdefghi');

  assert.doesNotMatch(text, /super-secret/);
  assert.doesNotMatch(text, /sk-abcdefghi/);
  assert.doesNotMatch(text, /sess-123/);
  assert.match(text, /<redacted>/);
});


test('unknown tool path redacts secret-like tool names and errors', async () => {
  const result = await runTool('unknown?apikey=super-secret&session_id=sess-123');
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, false);
  assert.doesNotMatch(serialized, /super-secret/);
  assert.doesNotMatch(serialized, /sess-123/);
  assert.match(serialized, /<redacted>/);
});
