import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, extractLimit, extractPeriod, extractSymbol, formatNaturalPlan, planNatural } from '../natural.ts';

test('natural input maps Korean discovery requests to safe find commands', () => {
  const plan = planNatural('많이 거래되는 종목 5개 찾아줘');

  assert.equal(plan.ok, true);
  assert.equal(plan.intent, 'discover');
  assert.deepEqual(plan.steps.map((step) => step.command), ['find most-active --limit 5']);
  assert.match(formatNaturalPlan(plan), /\/find most-active --limit 5/);
});

test('natural input maps symbol download and analysis requests to an explicit command plan', () => {
  const plan = planNatural('TSM 6개월치 받아서 분석해줘');

  assert.equal(plan.intent, 'download-and-analyze');
  assert.deepEqual(plan.steps.map((step) => step.command), [
    'symbol search TSM --limit 5',
    'data download TSM --period 6mo',
    'stats TSM',
  ]);
});

test('natural helpers extract symbols, periods, limits, and token estimates conservatively', () => {
  assert.equal(extractSymbol('AI ETF 말고 NVDA 분석'), 'NVDA');
  assert.equal(extractPeriod('가능한 전부 받아줘'), 'max');
  assert.equal(extractPeriod('2주 데이터'), '2w');
  assert.equal(extractLimit('상위 25개'), 25);
  assert.equal(extractLimit('상위 999개'), 100);
  assert.ok(estimateTokens('TSM 1년치 받아서 분석해줘') > 1);
});
