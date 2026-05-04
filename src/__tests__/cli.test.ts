import test from 'node:test';
import assert from 'node:assert/strict';
import { chatDivider, commandEchoBox, completeLine, completionCandidates, inputHintBox, interactivePrompt, welcomeCard } from '../cli.ts';

test('interactive prompt omits runtime HUD line while welcome keeps neofetch summary', () => {
  assert.match(interactivePrompt('quant'), /TossQuant quant ❯/);
  assert.doesNotMatch(interactivePrompt('quant'), /\[TossQuant\]/);
  assert.match(chatDivider(4), /30m/);
  assert.match(chatDivider(4), /48;2;238;238;238m/);
  const hint = inputHintBox('quant');
  assert.match(hint, /30m/);
  assert.match(hint, /48;2;238;238;238m/);
  assert.match(hint, /╭─ TossQuant · quant/);
  assert.match(hint, /press Tab/);
  assert.doesNotMatch(hint, /\[TossQuant\]/);
  const echo = commandEchoBox('quote AAPL');
  assert.match(echo, /You · command/);
  assert.match(echo, /quote AAPL/);
  assert.doesNotMatch(echo, /\[TossQuant\]/);
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
