import test from 'node:test';
import assert from 'node:assert/strict';
import { chatBox, chatDivider, commandEchoBox, inputHintBox, interactivePrompt } from '../ui/chat.ts';

test('chat UI uses light background with black text', () => {
  const divider = chatDivider(4);
  assert.match(divider, /30m/);
  assert.match(divider, /48;2;238;238;238m/);
});

test('interactive prompt backgrounds only the prompt label', () => {
  const prompt = interactivePrompt('quant');
  assert.match(prompt, /TossQuant quant ❯/);
  assert.match(prompt, /^\u001b\[30m\u001b\[48;2;238;238;238mTossQuant quant ❯\u001b\[0m $/);
});

test('chat boxes label input and omit runtime HUD unless explicitly provided', () => {
  const hint = inputHintBox('quant');
  assert.match(hint, /╭─ TossQuant · quant/);
  assert.match(hint, /press Tab/);
  assert.doesNotMatch(hint, /\[TossQuant\]/);
  const echo = commandEchoBox('quote AAPL');
  assert.match(echo, /You · command/);
  assert.match(echo, /quote AAPL/);
  assert.doesNotMatch(echo, /\[TossQuant\]/);
});

test('chat boxes wrap long lines inside fixed-width bodies', () => {
  const box = chatBox('TossQuant · runtime', ['x'.repeat(90)], 40);
  const bodyLines = box.split('\n').filter((line) => line.includes('│'));
  assert.equal(bodyLines.length, 3);
});
