import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendJsonl } from '../storage.ts';
import { marketDatasetPath } from '../data.ts';
import { runAgent, extractSymbols } from '../agent.ts';
import { ensureQuantSession, recordSessionEvent, sessionEvents } from '../session.ts';
import { addIdeaSymbol, createIdea } from '../idea.ts';

function writeYahooClose(base: string, day: number, close: number) {
  appendJsonl(marketDatasetPath(base, 'yahoo', 'NVDA', 'd'), {
    ticker: 'NVDA', provider_symbol: 'NVDA', source: 'yahoo', interval: 'd', date: `2026-01-${String(day).padStart(2, '0')}`, fetched_at: '2026-01-01T00:00:00Z', payload: { open: close, high: close + 1, low: close - 1, close, volume: 1000 + day },
  });
}

test('agent extracts symbols and records a .quant session while running safe tools', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-agent-data-'));
  const sessionRoot = mkdtempSync(join(tmpdir(), 'tq-agent-session-'));
  for (let i = 1; i <= 60; i += 1) writeYahooClose(dir, i, 100 + i);

  const run = await runAgent('NVDA earnings momentum research', { base: dir, sessionRoot, sessionId: 'test-session', now: '2026-05-05T00:00:00Z' });

  assert.deepEqual(extractSymbols('check NVDA and AAPL'), ['NVDA', 'AAPL']);
  assert.equal(run.ok, true);
  assert.equal(run.session.id, 'test-session');
  assert.equal(run.language, 'en');
  assert.ok(run.steps.some((step) => step.tool === 'stats.run'));
  assert.match(run.report, /Next safe commands/);
});

test('agent local report can auto-select Korean or explicit English', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-agent-lang-data-'));
  const sessionRoot = mkdtempSync(join(tmpdir(), 'tq-agent-lang-session-'));

  const korean = await runAgent('지금 전략 목록 알려줘', { base: dir, sessionRoot, sessionId: 'lang-ko', now: '2026-05-05T00:00:00Z' });
  const english = await runAgent('지금 전략 목록 알려줘', { base: dir, sessionRoot, sessionId: 'lang-en', language: 'en', now: '2026-05-05T00:00:00Z' });

  assert.equal(korean.language, 'ko');
  assert.match(korean.report, /에이전트 실행/);
  assert.match(korean.report, /다음 안전 명령/);
  assert.ok(korean.steps.some((step) => step.tool === 'strategy.list'));
  assert.equal(korean.steps.some((step) => step.tool === 'idea.create'), false);
  assert.equal(english.language, 'en');
  assert.match(english.report, /Agent run/);
});

test('agent keeps a conversational local reply when no tools are needed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-agent-chat-data-'));
  const sessionRoot = mkdtempSync(join(tmpdir(), 'tq-agent-chat-session-'));
  const session = ensureQuantSession({ id: 'agent-chat', root: sessionRoot, now: '2026-05-05T00:00:00Z' });
  recordSessionEvent(session, {
    at: '2026-05-05T00:00:01Z',
    type: 'lab.discuss',
    summary: 'NVDA earnings momentum',
    payload: { focus: '실적 모멘텀이 가격에 반영되는지 보고 싶어' },
  });

  const run = await runAgent('그럼 이걸 어떻게 논의하면 돼?', { base: dir, sessionRoot, sessionId: 'agent-chat', language: 'ko', now: '2026-05-05T00:01:00Z' });

  assert.equal(run.ok, true);
  assert.equal(run.session.id, 'agent-chat');
  assert.deepEqual(run.steps, []);
  assert.match(run.report, /에이전트 답변/);
  assert.match(run.report, /agent-chat 대화/);
  assert.match(run.report, /최근 이어받은 맥락/);
  assert.match(run.report, /lab\.discuss/);
  assert.doesNotMatch(run.report, /제공자 요약/);
});


test('agent session events store sanitized request previews instead of raw secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-agent-secret-data-'));
  const sessionRoot = mkdtempSync(join(tmpdir(), 'tq-agent-secret-session-'));

  const run = await runAgent('NVDA research access_token=super-secret sk-abcdefghi', { base: dir, sessionRoot, sessionId: 'secret-session', now: '2026-05-05T00:00:00Z' });
  const events = sessionEvents(run.session, sessionRoot);
  const serialized = JSON.stringify(events);

  assert.doesNotMatch(serialized, /super-secret/);
  assert.doesNotMatch(serialized, /sk-abcdefghi/);
  assert.doesNotMatch(run.report, /super-secret/);
  assert.doesNotMatch(run.report, /sk-abcdefghi/);
  assert.doesNotMatch(run.request, /super-secret/);
  assert.match(serialized, /<redacted>/);
});


test('agent does not extract uppercase secret values as symbols after request sanitization', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-agent-uppercase-secret-data-'));
  const sessionRoot = mkdtempSync(join(tmpdir(), 'tq-agent-uppercase-secret-session-'));

  const run = await runAgent('NVDA research api_key=ABCDEF123 session_id=SESSIONXYZ', { base: dir, sessionRoot, sessionId: 'secret-symbol-session', now: '2026-05-05T00:00:00Z' });
  const serialized = JSON.stringify({ run, events: sessionEvents(run.session, sessionRoot) });

  assert.deepEqual(run.symbols, ['NVDA']);
  assert.doesNotMatch(serialized, /ABCDEF123/);
  assert.doesNotMatch(serialized, /SESSIONXYZ/);
});

test('agent explains lab workflow latest by running the lab workflow tool', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-agent-lab-workflow-'));
  const sessionRoot = mkdtempSync(join(tmpdir(), 'tq-agent-lab-session-'));
  const idea = createIdea(dir, 'NVDA earnings momentum', { now: '2026-05-05T00:00:00Z' });
  addIdeaSymbol(dir, idea.id, 'NVDA');

  const run = await runAgent('지금 물어본 worflow latest는 뭐야', { base: dir, sessionRoot, sessionId: 'lab-help', now: '2026-05-05T00:01:00Z' });

  assert.equal(run.ok, true);
  assert.ok(run.steps.some((step) => step.tool === 'lab.workflow'));
  assert.match(run.report, /Lab workflow: NVDA earnings momentum/);
  assert.match(run.report, /discuss/);
  assert.match(run.report, /verify/);
  assert.match(run.report, /backtest/);
  assert.match(run.report, /lab discuss latest/);
  assert.doesNotMatch(run.report, /--no-codex/);
  assert.doesNotMatch(run.report, /idea new "<your strategy idea>"/);
});
