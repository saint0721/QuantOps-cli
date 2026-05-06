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

test('codex transcript filter does not duplicate the same response from stdout and stderr', () => {
  const answer = ['분석 결과', '- TSM 데이터 확인이 필요합니다.'].join('\n');
  const output = filteredCodexOutput(answer, answer);
  assert.equal(output, answer);
});

test('codex transcript filter preserves distinct stderr evidence', () => {
  const output = filteredCodexOutput('visible answer', 'provider warning');
  assert.equal(output, 'visible answer\nprovider warning');
});
