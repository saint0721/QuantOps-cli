import test from 'node:test';
import assert from 'node:assert/strict';
import { welcomeCard } from '../cli.ts';

test('welcome keeps neofetch summary without runtime HUD line', () => {
  const welcome = welcomeCard();
  assert.match(welcome, /TossQuant-cli/);
  assert.match(welcome, /beginner/);
  assert.match(welcome, /\/find/);
  assert.match(welcome, /\/download <SYMBOL>/);
  assert.match(welcome, /trading mutations disabled/);
  assert.doesNotMatch(welcome, /watchlist:\d/);
});
