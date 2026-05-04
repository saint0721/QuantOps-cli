import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latestDiscoverySymbol, nextRecommendation, savedMarketSymbols } from '../next.ts';

test('next recommendation prefers saved market data before discovery hints', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'tossquant-next-'));
  await mkdir(join(tmp, 'market', 'stooq'), { recursive: true });
  await writeFile(join(tmp, 'market', 'stooq', 'nvda.jsonl'), JSON.stringify({ ticker: 'nvda' }) + '\n', 'utf8');
  await mkdir(join(tmp, 'discovery', 'local'), { recursive: true });
  await writeFile(join(tmp, 'discovery', 'local', 'trending.json'), JSON.stringify({ items: [{ symbol: 'TSM' }] }), 'utf8');

  assert.deepEqual(savedMarketSymbols(tmp), ['NVDA']);
  assert.equal(latestDiscoverySymbol(tmp), 'TSM');
  assert.match(nextRecommendation(tmp), /next  \/analyze NVDA/);
});

test('next recommendation falls through to find when no local state exists', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'tossquant-next-empty-'));

  assert.match(nextRecommendation(tmp), /next  \/find/);
});
