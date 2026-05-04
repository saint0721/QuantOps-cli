import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classify, historyRows } from '../src/analysis.ts';
import { filteredCodexOutput } from '../src/codex.ts';
import { defaultTmuxSession, hudWatchCommand, interactiveCommand, sessionHash, shellCommand } from '../src/hud.ts';
import { buildRuntimeSnapshot, recordRuntime, renderRuntimeLine, runtimeStatePath } from '../src/runtime.ts';
import { chatDivider, completeLine, completionCandidates, interactivePrompt, welcomeCard } from '../src/cli.ts';
import { installLocalBins } from '../src/setup.ts';
import { appendJsonl, quoteHistoryPath, readJsonl, readWatchlist, redact, writeWatchlist } from '../src/storage.ts';

test('storage redacts sensitive keys and normalizes watchlist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-ts-'));
  writeWatchlist(['aapl', 'SPY', 'aapl'], dir);
  assert.deepEqual(readWatchlist(dir), ['AAPL', 'SPY']);
  assert.equal((redact({ token: 'secret', nested: { account_id: 'acct', price: 1 } }) as any).token, '<redacted>');
});

test('history and classify use accumulated quote samples', () => {
  const records = [
    { ticker: 'AAPL', fetched_at: 't1', payload: { price: 100 } },
    { ticker: 'AAPL', fetched_at: 't2', payload: { price: 103 } },
    { ticker: 'AAPL', fetched_at: 't3', payload: { price: 106 } },
  ];
  assert.equal(historyRows(records as any)[1]?.change?.toFixed(2), '0.03');
  assert.equal(classify(records as any).classification, 'momentum-candidate');
});

test('runtime snapshot writes and renders HUD line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-ts-'));
  writeWatchlist(['AAPL'], dir);
  appendJsonl(quoteHistoryPath('AAPL', dir), { ticker: 'AAPL', fetched_at: 't1', payload: { price: 1 } } as any);
  appendJsonl(quoteHistoryPath('AAPL', dir), { ticker: 'AAPL', fetched_at: 't2', payload: { price: 2 } } as any);
  appendJsonl(quoteHistoryPath('AAPL', dir), { ticker: 'AAPL', fetched_at: 't3', payload: { price: 3 } } as any);
  const snapshot = buildRuntimeSnapshot({ base: dir, mode: 'quant', lastAction: 'test' });
  assert.equal(snapshot.watchlist_count, 1);
  assert.equal(snapshot.quote_samples, 3);
  assert.deepEqual(snapshot.classify_ready, ['AAPL']);
  recordRuntime({ base: dir, mode: 'quant', lastAction: 'test' });
  assert.ok(readJsonl(quoteHistoryPath('AAPL', dir)).length === 3);
  assert.ok(runtimeStatePath(dir).endsWith('runtime/state.json'));
  const line = renderRuntimeLine(snapshot);
  assert.match(line, /\[TossQuant\]/);
  assert.match(line, /quotes:1\/3 samples/);
  assert.match(line, /last:test/);
});

test('codex transcript filter hides hooks warnings and echoed prompt', () => {
  const output = filteredCodexOutput(['OpenAI Codex v0', 'user', 'secret prompt', 'warning: Codex could not find bubblewrap on PATH.', 'codex', 'visible answer', 'hook: Stop', 'tokens used', '1,234'].join('\n'));
  assert.equal(output, 'visible answer');
});

test('tmux command builders quote runtime commands', () => {
  assert.equal(shellCommand(['a', "b'c"]), "'a' 'b'\\''c'");
  assert.match(hudWatchCommand('/tmp/data', 0.5), /hud' '--watch/);
  assert.match(interactiveCommand(), /--no-tmux/);
  assert.match(interactiveCommand('/tmp/data'), /--data-dir/);
});


test('setup bin installs quant and tossquant symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-bin-'));
  const result = installLocalBins({ dir });
  assert.equal(result.ok, true);
  assert.equal(result.links.length, 2);
  assert.ok(existsSync(join(dir, 'quant')));
  assert.ok(readlinkSync(join(dir, 'quant')).endsWith('/bin/quant'));
  assert.ok(existsSync(join(dir, 'tossquant')));
});


test('interactive prompt omits runtime HUD line while welcome keeps neofetch summary', () => {
  assert.match(interactivePrompt('quant'), /TossQuant quant ❯/);
  assert.doesNotMatch(interactivePrompt('quant'), /\[TossQuant\]/);
  assert.match(chatDivider(4), /38;2;238;238;238m/);
  const welcome = welcomeCard();
  assert.match(welcome, /TossQuant-cli/);
  assert.match(welcome, /commands/);
  assert.match(welcome, /trading mutations disabled/);
  assert.doesNotMatch(welcome, /watchlist:\d/);
});


test('tab completion suggests root slash and nested commands', () => {
  assert.ok(completionCandidates('', 'quant').includes('/status'));
  assert.ok(completionCandidates('', 'quant').includes('doctor'));
  assert.deepEqual(completionCandidates('quote ', 'quant'), ['fetch', 'history']);
  assert.deepEqual(completionCandidates('/watchlist ', 'quant'), ['add', 'fetch', 'list', 'remove']);
  assert.ok(completeLine('runt', 'quant')[0].includes('runtime'));
  assert.ok(completeLine('tmux start --s', 'quant')[0].includes('--session'));
});

test('default tmux session derives a short stable hash from Codex or project context', () => {
  assert.equal(sessionHash('abc').length, 8);
  assert.equal(defaultTmuxSession({ CODEX_SESSION_ID: 'codex-session-1' } as any, '/repo'), `tossquant-${sessionHash('codex-session-1')}`);
  assert.equal(defaultTmuxSession({} as any, '/repo'), `tossquant-${sessionHash('/repo')}`);
});


test('tmux runtime commands pass data dir and reselect top command pane', () => {
  assert.match(interactiveCommand('/tmp/data'), /\/tmp\/data/);
});
