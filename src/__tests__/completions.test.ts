import test from 'node:test';
import assert from 'node:assert/strict';
import { completeLine, completionCandidates } from '../cli.ts';

test('completion exposes only headless rtk command surface', () => {
  const root = completionCandidates('', 'quant');
  for (const command of ['codex-guide', 'runtime', 'symbol', 'data', 'stats', 'compare', 'research', 'event', 'backtest', 'session', 'provider', 'sources', 'doctor', 'setup']) {
    assert.ok(root.includes(command), `${command} should be discoverable`);
  }
  for (const removed of ['mcp', 'model', 'skills', 'tools', 'hud', 'tmux', '/hud', '/model', '/tools', '/skills']) {
    assert.equal(root.includes(removed), false, `${removed} should not be suggested`);
  }
});

test('completion suggests nested options for supported JSON runtime commands', () => {
  assert.deepEqual(completionCandidates('runtime ', 'quant'), ['info', 'line', 'snapshot', '--json']);
  assert.deepEqual(completionCandidates('event ', 'quant'), ['define', 'study', 'windows']);
  assert.deepEqual(completionCandidates('data ', 'quant'), ['download', 'watchlist', 'list', 'info', 'validate', 'refresh']);
  assert.ok(completionCandidates('data download AAPL ', 'quant').includes('--json'));
  assert.ok(completionCandidates('data validate AAPL ', 'quant').includes('--max-stale-days'));
  assert.deepEqual(completionCandidates('backtest ', 'quant'), ['run', 'strategies', 'list']);
  assert.ok(completionCandidates('backtest run NVDA ', 'quant').includes('--strategy'));
  assert.deepEqual(completionCandidates('backtest run NVDA --strategy ', 'quant'), ['buy-hold', 'ma-cross', 'momentum', 'mean-reversion']);
  assert.ok(completionCandidates('research AAPL ', 'quant').includes('--topic'));
  assert.ok(completionCandidates('research AAPL ', 'quant').includes('--json'));
  assert.equal(completionCandidates('research AAPL ', 'quant').includes('--codex'), false);
  assert.deepEqual(completeLine('runt', 'quant')[0], ['runtime']);
});
