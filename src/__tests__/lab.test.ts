import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addIdeaHypothesis, addIdeaSymbol, createIdea } from '../idea.ts';
import { buildLabPrompt, formatLabRun, formatLabWorkflow, labReportPath, runLabStage } from '../lab.ts';

test('lab prompt turns a saved idea into safe swarm workflow instructions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-lab-prompt-'));
  const idea = createIdea(dir, 'NVDA earnings momentum', { now: '2026-05-05T04:00:00Z' });
  addIdeaSymbol(dir, idea.id, 'NVDA');
  addIdeaHypothesis(dir, idea.id, 'Earnings surprise momentum persists');

  const run = runLabStage('verify', 'latest', { base: dir, save: false, now: '2026-05-05T04:01:00Z' });
  const prompt = buildLabPrompt({ ok: true, idea: run.idea, readiness: run.readiness, next_commands: [] }, 'backtest', 'earnings drift');

  assert.match(run.report, /Lab verify: NVDA earnings momentum/);
  assert.match(run.report, /Blocking gaps/);
  assert.match(run.prompt, /Agent-swarm task split/);
  assert.match(run.prompt, /Do not provide buy\/sell\/hold advice/);
  assert.match(prompt, /backtest implementation swarm lead/);
  assert.match(prompt, /User discussion focus/);
});

test('lab run can save and format workflow artifacts without Codex', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-lab-save-'));
  const idea = createIdea(dir, 'AAPL buyback event study', { now: '2026-05-05T04:02:00Z' });
  addIdeaSymbol(dir, idea.id, 'AAPL');

  const run = runLabStage('discuss', idea.id, { base: dir, now: '2026-05-05T04:03:00Z' });
  const formatted = formatLabRun(run);
  const workflow = formatLabWorkflow({ ok: true, idea: run.idea, readiness: run.readiness, next_commands: ['data download AAPL --period 1y'] });

  assert.equal(run.saved_to, labReportPath(idea.id, dir));
  assert.equal(existsSync(run.saved_to!), true);
  assert.match(formatted, /saved_to:/);
  assert.match(formatted, /아직 논의 주제가 없습니다/);
  assert.match(workflow, /quant lab discuss/);
  assert.match(workflow, /quant lab backtest/);
});

test('lab discuss accepts a natural-language focus without Codex', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-lab-focus-'));
  const idea = createIdea(dir, 'NVDA earnings momentum', { now: '2026-05-05T04:04:00Z' });
  addIdeaSymbol(dir, idea.id, 'NVDA');

  const run = runLabStage('discuss', 'latest', {
    base: dir,
    save: false,
    focus: '실적 모멘텀이 가격에 반영되는지 보고 싶어',
  });

  assert.equal(run.focus, '실적 모멘텀이 가격에 반영되는지 보고 싶어');
  assert.match(run.report, /discussion_focus/);
  assert.match(run.report, /논의 주제: 실적 모멘텀이 가격에 반영되는지 보고 싶어/);
  assert.match(run.report, /\/agent 실적 모멘텀이 가격에 반영되는지 보고 싶어/);
});
