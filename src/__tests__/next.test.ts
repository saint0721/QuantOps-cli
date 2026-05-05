import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latestDiscoverySymbol, nextRecommendation, savedMarketSymbols } from '../next.ts';
import { createIdea, addIdeaSymbol } from '../idea.ts';

test('next recommendation prefers saved market data before discovery hints', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'quantops-next-'));
  await mkdir(join(tmp, 'market', 'stooq'), { recursive: true });
  await writeFile(join(tmp, 'market', 'stooq', 'nvda.jsonl'), JSON.stringify({ ticker: 'nvda' }) + '\n', 'utf8');
  await mkdir(join(tmp, 'discovery', 'local'), { recursive: true });
  await writeFile(join(tmp, 'discovery', 'local', 'trending.json'), JSON.stringify({ items: [{ symbol: 'TSM' }] }), 'utf8');

  assert.deepEqual(savedMarketSymbols(tmp), ['NVDA']);
  assert.equal(latestDiscoverySymbol(tmp), 'TSM');
  assert.match(nextRecommendation(tmp), /next  \/stats NVDA/);
});

test('next recommendation prioritizes saved idea workflow readiness', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'quantops-next-idea-'));
  createIdea(tmp, 'NVDA earnings momentum', { now: '2026-05-05T00:00:00Z' });

  assert.match(nextRecommendation(tmp), /next  \/idea add-symbol latest <SYMBOL>/);

  addIdeaSymbol(tmp, 'latest', 'NVDA');
  assert.match(nextRecommendation(tmp), /next  \/data download NVDA --period 1y/);
  assert.match(nextRecommendation(tmp), /\/lab workflow latest → \/backtest run latest/);
});

test('next recommendation falls through to natural chat when no local state exists', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'quantops-next-empty-'));

  assert.match(nextRecommendation(tmp), /많이 거래되는 종목 10개 찾아줘/);
  assert.match(nextRecommendation(tmp), /\/discover most-active/);
});
