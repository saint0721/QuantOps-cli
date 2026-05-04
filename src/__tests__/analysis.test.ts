import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, historyRows } from '../analysis.ts';

test('history and classify use accumulated quote samples', () => {
  const records = [
    { ticker: 'AAPL', fetched_at: 't1', payload: { price: 100 } },
    { ticker: 'AAPL', fetched_at: 't2', payload: { price: 103 } },
    { ticker: 'AAPL', fetched_at: 't3', payload: { price: 106 } },
  ];
  assert.equal(historyRows(records as any)[1]?.change?.toFixed(2), '0.03');
  assert.equal(classify(records as any).classification, 'momentum-candidate');
});
