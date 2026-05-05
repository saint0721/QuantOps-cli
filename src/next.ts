import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { statusSummary } from './runtime.ts';
import { ideaStatus, listIdeas } from './idea.ts';

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
  const latestIdea = listIdeas(dataDir)[0];
  if (latestIdea) {
    const status = ideaStatus(dataDir, latestIdea.id);
    if (!latestIdea.symbols.length) {
      return [
        '추천 다음 행동',
        '',
        `최근 idea가 있습니다: ${latestIdea.title}`,
        `next  /idea add-symbol latest <SYMBOL>`,
        '',
        '종목을 붙이면 /lab workflow latest 와 /backtest run latest 로 이어갈 수 있습니다.',
      ].join('\n');
    }
    const firstMissing = status.next_commands[0];
    if (firstMissing) {
      return [
        '추천 다음 행동',
        '',
        `최근 idea가 있습니다: ${latestIdea.title}`,
        `symbols: ${latestIdea.symbols.join(', ')}`,
        `next  /${firstMissing}`,
        '',
        '데이터/리서치가 준비되면 /lab workflow latest → /backtest run latest 순서로 진행하세요.',
      ].join('\n');
    }
    return [
      '추천 다음 행동',
      '',
      `최근 idea 준비도가 좋습니다: ${latestIdea.title}`,
      'next  /lab workflow latest',
      'next  /backtest run latest --strategy ma-cross',
    ].join('\n');
  }
  const marketSymbols = savedMarketSymbols(dataDir);
  if (marketSymbols.length > 0) {
    const symbol = marketSymbols[0]!;
    return [
      '추천 다음 행동',
      '',
      `데이터가 준비된 종목이 있습니다: ${marketSymbols.join(', ')}`,
      `next  /stats ${symbol}`,
      '',
      '그 다음에는 자연어로 새 후보를 물어보거나 /discover 로 비교 대상을 추가하세요.',
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
      '다운로드 후 /stats 로 확인하세요.',
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
    'next  그냥 입력: 많이 거래되는 종목 10개 찾아줘',
    '',
    '에이전트/고급 CLI에서는 /discover most-active --source yahoo --limit 10 을 사용할 수 있습니다.',
  ].join('\n');
}
