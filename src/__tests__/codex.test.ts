import test from 'node:test';
import assert from 'node:assert/strict';
import { filteredCodexOutput } from '../codex.ts';

test('codex transcript filter hides hooks warnings and echoed prompt', () => {
  const output = filteredCodexOutput(['OpenAI Codex v0', 'user', 'secret prompt', 'warning: Codex could not find bubblewrap on PATH.', 'codex', 'visible answer', 'hook: Stop', 'tokens used', '1,234'].join('\n'));
  assert.equal(output, 'visible answer');
});

test('codex transcript filter hides OMX tmux injection control lines', () => {
  const output = filteredCodexOutput(['Continue from current mode state. [OMX_TMUX_INJECT]', 'visible answer'].join('\n'));
  assert.equal(output, 'visible answer');
});
