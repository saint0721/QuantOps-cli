import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runOnce, welcomeCard } from '../cli.ts';

test('welcome keeps neofetch summary without runtime HUD line', () => {
  const welcome = welcomeCard();
  assert.match(welcome, /TossQuant-cli/);
  assert.match(welcome, /beginner/);
  assert.match(welcome, /\/find/);
  assert.match(welcome, /\/download <SYMBOL>/);
  assert.match(welcome, /\/research <SYMBOL>/);
  assert.match(welcome, /trading mutations disabled/);
  assert.doesNotMatch(welcome, /watchlist:\d/);
});

function captureConsole(fn: () => Promise<number>): Promise<{ code: number; output: string }> {
  const originalLog = console.log;
  let output = '';
  console.log = (...args: unknown[]) => { output += `${args.join(' ')}\n`; };
  return fn().then((code) => ({ code, output })).finally(() => { console.log = originalLog; });
}

test('research command routes to missing-data guidance without invoking generic codex chat', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-cli-research-missing-'));

  const { code, output } = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'research', 'AAPL']));

  assert.equal(code, 1);
  assert.match(output, /data download AAPL --period 1y/);
  assert.match(output, /before external research/);
});
