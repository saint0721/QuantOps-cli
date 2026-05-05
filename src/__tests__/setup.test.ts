import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRustHelpers, installLocalBins } from '../setup.ts';

test('setup bin installs rtk, quant, and quantops symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-bin-'));
  const result = installLocalBins({ dir });
  assert.equal(result.ok, true);
  assert.equal(result.links.length, 3);
  assert.ok(existsSync(join(dir, 'rtk')));
  assert.ok(readlinkSync(join(dir, 'rtk')).endsWith('/src/cli.ts'));
  assert.ok(existsSync(join(dir, 'quant')));
  assert.ok(readlinkSync(join(dir, 'quant')).endsWith('/src/cli.ts'));
  assert.ok(existsSync(join(dir, 'quantops')));
});

test('setup rust builds Rust helper commands in dry-run mode', () => {
  const result = buildRustHelpers({ dryRun: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.helpers.map((helper) => helper.name), ['quantops-stats', 'quantops-backtest', 'quantops-event', 'quantops-validate']);
  assert.ok(result.helpers.every((helper) => helper.command.includes('build')));
});
