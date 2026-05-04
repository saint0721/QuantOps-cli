import test from 'node:test';
import assert from 'node:assert/strict';
import { completeLine, completionCandidates } from '../cli/completions.ts';

test('tab completion suggests root slash and nested commands', () => {
  assert.ok(completionCandidates('', 'quant').includes('/status'));
  assert.ok(completionCandidates('', 'quant').includes('doctor'));
  assert.deepEqual(completionCandidates('quote ', 'quant'), ['fetch', 'history']);
  assert.deepEqual(completionCandidates('/watchlist ', 'quant'), ['add', 'fetch', 'list', 'remove']);
  assert.ok(completeLine('runt', 'quant')[0].includes('runtime'));
  assert.ok(completeLine('tmux start --s', 'quant')[0].includes('--session'));
});

test('codex mode limits completion to slash controls', () => {
  const candidates = completionCandidates('hello', 'codex');
  assert.ok(candidates.includes('/quant'));
  assert.equal(candidates.includes('quote'), false);
});
