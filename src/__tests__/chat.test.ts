import test from 'node:test';
import assert from 'node:assert/strict';
import { chatBox, chatDivider, inputHintBox, interactivePrompt } from '../ui/chat.ts';

test('chat UI uses black text without background', () => {
  const divider = chatDivider(4);
  assert.match(divider, /30m/);
  assert.doesNotMatch(divider, /48;2;/);
});

test('interactive prompt uses blue marker and black input text on chat background', () => {
  const prompt = interactivePrompt('quant');
  assert.match(prompt, /^\u001b\[48;2;245;247;250m\u001b\[1m\u001b\[38;2;0;100;255m ❯ \u001b\[48;2;245;247;250m\u001b\[30m\u001b\[K$/);
  assert.doesNotMatch(prompt, /TossQuant quant/);
});

test('input hint uses neofetch style without background or runtime HUD', () => {
  const hint = inputHintBox('quant');
  assert.match(hint, /TossQuant@quant/);
  assert.match(hint, /project\u001b\[0m  TossQuant-cli/);
  assert.match(hint, /beginner\u001b\[0m \/start/);
  assert.match(hint, /flow\u001b\[0m     \/idea new/);
  assert.match(hint, /tools\u001b\[0m    \/skills · \/tools · \/agent/);
  assert.match(hint, /keys\u001b\[0m     Tab completes/);
  assert.match(hint, /try\u001b\[0m      \/start/);
  assert.doesNotMatch(hint, /48;2;/);
  assert.doesNotMatch(hint, /\[TossQuant\]/);
});

test('chat output wraps long lines without box drawing frame', () => {
  const box = chatBox(['x'.repeat(90)], 40);
  assert.doesNotMatch(box, /[╭╮╰╯│]/);
  assert.equal(box.replace(/^\u001b\[30m|\u001b\[0m$/g, '').split('\n').length, 3);
});
