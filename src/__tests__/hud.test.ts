import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTmuxSession, hudWatchCommand, interactiveCommand, sessionHash, shellCommand } from '../hud.ts';

test('tmux command builders quote runtime commands', () => {
  assert.equal(shellCommand(['a', "b'c"]), "'a' 'b'\\''c'");
  assert.match(hudWatchCommand('/tmp/data', 0.5), /hud' '--watch/);
  assert.match(interactiveCommand(), /--no-tmux/);
  assert.match(interactiveCommand('/tmp/data'), /--data-dir/);
});

test('default tmux session derives a short stable hash from Codex or project context', () => {
  assert.equal(sessionHash('abc').length, 8);
  assert.equal(defaultTmuxSession({ CODEX_SESSION_ID: 'codex-session-1' } as any, '/repo'), `tossquant-${sessionHash('codex-session-1')}`);
  assert.equal(defaultTmuxSession({} as any, '/repo'), `tossquant-${sessionHash('/repo')}`);
});

test('tmux runtime commands pass data dir and reselect top command pane', () => {
  assert.match(interactiveCommand('/tmp/data'), /\/tmp\/data/);
});
