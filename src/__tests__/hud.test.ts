import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTmuxSession, hudWatchCommand, interactiveCommand, managedTmuxSession, sessionHash, shellCommand } from '../hud.ts';
import { hudColor } from '../ui/hud.ts';

test('tmux command builders quote runtime commands', () => {
  assert.equal(shellCommand(['a', "b'c"]), "'a' 'b'\\''c'");
  assert.match(hudWatchCommand('/tmp/data', 0.5), /hud' '--watch/);
  assert.match(interactiveCommand(), /--no-tmux/);
  assert.match(interactiveCommand('/tmp/data'), /--data-dir/);
  assert.match(interactiveCommand('/tmp/data', 'tossquant-test'), /TOSSQUANT_TMUX_MANAGED=1/);
  assert.match(interactiveCommand('/tmp/data', 'tossquant-test'), /TOSSQUANT_TMUX_SESSION=tossquant-test/);
});

test('default tmux session derives a short stable hash from Codex or project context', () => {
  assert.equal(sessionHash('abc').length, 8);
  assert.equal(defaultTmuxSession({ CODEX_SESSION_ID: 'codex-session-1' } as any, '/repo'), `tossquant-${sessionHash('codex-session-1')}`);
  assert.equal(defaultTmuxSession({} as any, '/repo'), `tossquant-${sessionHash('/repo')}`);
});

test('tmux runtime commands pass data dir and reselect top command pane', () => {
  assert.match(interactiveCommand('/tmp/data'), /\/tmp\/data/);
});

test('managed tmux session marker is explicit', () => {
  assert.equal(managedTmuxSession({ TOSSQUANT_TMUX_MANAGED: '1', TOSSQUANT_TMUX_SESSION: 'tq' } as any), 'tq');
  assert.equal(managedTmuxSession({ TOSSQUANT_TMUX_SESSION: 'tq' } as any), null);
});

test('HUD line uses black text on light background without dimming', () => {
  const line = hudColor('[TossQuant] main');
  assert.match(line, /^\u001b\[30m\u001b\[48;2;238;238;238m\[TossQuant\] main\u001b\[0m$/);
  assert.doesNotMatch(line, /\u001b\[2m/);
});
