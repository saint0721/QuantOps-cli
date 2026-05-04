import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { statusSummary } from './runtime.ts';

export function latestDiscoverySymbol(dataDir: string): string | undefined {
  const root = join(dataDir, 'discovery');
  if (!existsSync(root)) return undefined;
  const candidates: string[] = [];
  for (const source of readdirSync(root).sort()) {
    const dir = join(root, source);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((item) => item.endsWith('.json')).sort()) {
      candidates.push(join(dir, file));
    }
  }
  const latest = candidates
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .at(0);
  if (!latest) return undefined;
  try {
    const payload = JSON.parse(readFileSync(latest.path, 'utf8'));
    const symbol = payload?.items?.[0]?.symbol;
    return typeof symbol === 'string' ? symbol.toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}

export function savedMarketSymbols(dataDir: string): string[] {
  const root = join(dataDir, 'market');
  if (!existsSync(root)) return [];
  const symbols = new Set<string>();
  for (const source of readdirSync(root).sort()) {
    const dir = join(root, source);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((item) => item.endsWith('.jsonl')).sort()) {
      const path = join(dir, file);
      const firstLine = readFileSync(path, 'utf8').split(/\r?\n/).find(Boolean);
      if (!firstLine) continue;
      try {
        const row = JSON.parse(firstLine);
        if (typeof row.ticker === 'string') symbols.add(row.ticker.toUpperCase());
      } catch {
        // Ignore corrupt local rows; /data list remains the diagnostic command.
      }
    }
  }
  return [...symbols].sort();
}

export function nextRecommendation(dataDir: string): string {
  const marketSymbols = savedMarketSymbols(dataDir);
  if (marketSymbols.length > 0) {
    const symbol = marketSymbols[0]!;
    return [
      '추천 다음 행동',
      '',
      `데이터가 준비된 종목이 있습니다: ${marketSymbols.join(', ')}`,
      `next  /analyze ${symbol}`,
      '',
      '그 다음에는 /find 로 새 후보를 찾거나 /download <SYMBOL> 로 비교 대상을 추가하세요.',
    ].join('\n');
  }
  const discovered = latestDiscoverySymbol(dataDir);
  if (discovered) {
    return [
      '추천 다음 행동',
      '',
      `최근 discover 후보가 있습니다: ${discovered}`,
      `next  /download ${discovered}`,
      '',
      '다운로드 후 /analyze 로 확인하세요.',
    ].join('\n');
  }
  const summary = statusSummary(dataDir);
  if (summary.watchlist.length > 0) {
    const symbol = summary.watchlist[0]!;
    return [
      '추천 다음 행동',
      '',
      `watchlist에 ${symbol}가 있습니다.`,
      `next  /download ${symbol}`,
    ].join('\n');
  }
  return [
    '추천 다음 행동',
    '',
    '아직 market 데이터가 없습니다.',
    'next  /find',
    '',
    '/find 는 /discover most-active --source yahoo --limit 10 의 쉬운 별칭입니다.',
  ].join('\n');
}
