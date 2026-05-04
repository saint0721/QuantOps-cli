import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installLocalBins } from '../setup.ts';

test('setup bin installs quant and tossquant symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-bin-'));
  const result = installLocalBins({ dir });
  assert.equal(result.ok, true);
  assert.equal(result.links.length, 2);
  assert.ok(existsSync(join(dir, 'quant')));
  assert.ok(readlinkSync(join(dir, 'quant')).endsWith('/src/cli.ts'));
  assert.ok(existsSync(join(dir, 'tossquant')));
});
