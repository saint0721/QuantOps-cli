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
  const prompt = buildLabPrompt({ ok: true, idea: run.idea, readiness: run.readiness, next_commands: [] }, 'backtest');

  assert.match(run.report, /Lab verify: NVDA earnings momentum/);
  assert.match(run.report, /Blocking gaps/);
  assert.match(run.prompt, /Agent-swarm task split/);
  assert.match(run.prompt, /Do not provide buy\/sell\/hold advice/);
  assert.match(prompt, /backtest implementation swarm lead/);
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
  assert.match(formatted, /Codex discussion was not run/);
  assert.match(workflow, /quant lab discuss/);
  assert.match(workflow, /quant lab backtest/);
});
