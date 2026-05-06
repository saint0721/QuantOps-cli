import test from 'node:test';
import assert from 'node:assert/strict';
import { clampedHudHeight, commandPaneTarget, defaultTmuxSession, hudPaneTarget, hudWatchCommand, interactiveCommand, managedTmuxSession, parseTmuxPaneSnapshot, sessionHash, shellCommand, tmuxRuntimeHasHudPane, tmuxRuntimeHasUsableCommandPane, tmuxRuntimeOptions } from '../hud.ts';
import { hudColor } from '../ui/hud.ts';

test('tmux command builders quote runtime commands', () => {
  assert.equal(shellCommand(['a', "b'c"]), "'a' 'b'\\''c'");
  assert.match(hudWatchCommand('/tmp/data', 0.5), /hud' '--watch/);
  assert.match(interactiveCommand(), /--no-tmux/);
  assert.match(interactiveCommand('/tmp/data'), /--data-dir/);
  assert.match(interactiveCommand('/tmp/data', 'quantops-test'), /QUANTOPS_TMUX_MANAGED=1/);
  assert.match(interactiveCommand('/tmp/data', 'quantops-test'), /QUANTOPS_TMUX_SESSION=quantops-test/);
});

test('default tmux session derives a short stable hash from Codex or project context', () => {
  assert.equal(sessionHash('abc').length, 8);
  assert.equal(defaultTmuxSession({ CODEX_SESSION_ID: 'codex-session-1' } as any, '/repo'), `quantops-${sessionHash('codex-session-1')}`);
  assert.equal(defaultTmuxSession({} as any, '/repo'), `quantops-${sessionHash('/repo')}`);
});

test('tmux runtime commands pass data dir and reselect top command pane', () => {
  assert.match(interactiveCommand('/tmp/data'), /\/tmp\/data/);
  assert.equal(commandPaneTarget('quantops-test'), 'quantops-test:main.0');
  assert.equal(commandPaneTarget('quantops-test', 1), 'quantops-test:main.1');
  assert.equal(hudPaneTarget('quantops-test'), 'quantops-test:main.1');
  assert.equal(hudPaneTarget('quantops-test', 2), 'quantops-test:main.2');
  assert.equal(clampedHudHeight(3, 24), 3);
  assert.equal(clampedHudHeight(20, 24), 16);
  assert.equal(clampedHudHeight(3, 5), 1);
});

test('tmux runtime enables mouse scroll friendly session options', () => {
  assert.deepEqual(tmuxRuntimeOptions('quantops-test'), [
    ['set-option', '-t', 'quantops-test', 'mouse', 'on'],
    ['set-option', '-t', 'quantops-test', 'history-limit', '50000'],
    ['set-option', '-t', 'quantops-test', 'status-keys', 'vi'],
    ['set-option', '-t', 'quantops-test', 'renumber-windows', 'on'],
    ['set-window-option', '-t', 'quantops-test:main', 'mode-keys', 'vi'],
  ]);
});

test('managed tmux session marker is explicit', () => {
  assert.equal(managedTmuxSession({ QUANTOPS_TMUX_MANAGED: '1', QUANTOPS_TMUX_SESSION: 'tq' } as any), 'tq');
  assert.equal(managedTmuxSession({ QUANTOPS_TMUX_SESSION: 'tq' } as any), null);
});

test('tmux runtime refuses to attach hud-only stale sessions', () => {
  const hudOnly = [
    parseTmuxPaneSnapshot("0\t0\tQuantOps HUD\tnode\t'/usr/bin/node' '/repo/src/cli.ts' '--data-dir' 'data' 'hud' '--watch'")!,
  ];
  const healthy = [
    parseTmuxPaneSnapshot("0\t0\tQuantOps command\tnode\t'env' 'QUANTOPS_TMUX_MANAGED=1' '/usr/bin/node' '/repo/src/cli.ts' '--no-tmux' '--data-dir' 'data'")!,
    parseTmuxPaneSnapshot("1\t0\tQuantOps HUD\tnode\t'/usr/bin/node' '/repo/src/cli.ts' '--data-dir' 'data' 'hud' '--watch'")!,
  ];

  assert.equal(tmuxRuntimeHasUsableCommandPane(hudOnly), false);
  assert.equal(tmuxRuntimeHasHudPane(hudOnly), true);
  assert.equal(tmuxRuntimeHasUsableCommandPane(healthy), true);
  assert.equal(tmuxRuntimeHasHudPane(healthy), true);
});



test('tmux runtime detects command and HUD panes even when pane indexes start at one', () => {
  const oneBased = [
    parseTmuxPaneSnapshot("1	0	QuantOps command	node	'env' 'QUANTOPS_TMUX_MANAGED=1' '/usr/bin/node' '/repo/src/cli.ts' '--no-tmux' '--data-dir' 'data'")!,
    parseTmuxPaneSnapshot("2	0	QuantOps HUD	node	'/usr/bin/node' '/repo/src/cli.ts' '--data-dir' 'data' 'hud' '--watch'")!,
  ];

  assert.equal(tmuxRuntimeHasUsableCommandPane(oneBased), true);
  assert.equal(tmuxRuntimeHasHudPane(oneBased), true);
});

test('tmux runtime recovers panes whose titles drift from their start command', () => {
  const titleDrift = [
    parseTmuxPaneSnapshot("1	0	QuantOps HUD	node	'env' 'QUANTOPS_TMUX_MANAGED=1' '/usr/bin/node' '/repo/src/cli.ts' '--no-tmux' '--data-dir' 'data'")!,
    parseTmuxPaneSnapshot("2	0	gbrl-server01	node	'/usr/bin/node' '/repo/src/cli.ts' '--data-dir' 'data' 'hud' '--watch' '--interval' '1'")!,
  ];

  assert.equal(tmuxRuntimeHasUsableCommandPane(titleDrift), true);
  assert.equal(tmuxRuntimeHasHudPane(titleDrift), true);
});

test('HUD line uses black text with blue field labels and no background', () => {
  const line = hudColor('[QuantOps 0.1.0] main | mode:quant | codex:ready');
  assert.match(line, /^\u001b\[30m\[QuantOps 0\.1\.0\] main \| \u001b\[38;2;0;100;255mmode:\u001b\[30mquant/);
  assert.match(line, /\u001b\[38;2;0;100;255mcodex:\u001b\[30mready/);
  assert.doesNotMatch(line, /last:/);
  assert.doesNotMatch(line, /updated:/);
  assert.doesNotMatch(line, /\u001b\[2m/);
  assert.doesNotMatch(line, /48;2;/);
});
