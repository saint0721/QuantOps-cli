#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auditAll } from './audit.ts';
import { collectionPlan, collectionSummary, collectQuote, runCollectionPlan } from './collect.ts';
import { dataInfo, downloadHistory, downloadWatchlist, listDatasets, refreshHistory, refreshWatchlist, OHLCV_DOWNLOAD_SOURCES } from './data.ts';
import { addIdeaHypothesis, addIdeaSymbol, createIdea, ideaPath, ideaStatus, listIdeas, readIdea, type IdeaReadiness, type QuantIdea } from './idea.ts';
import { buildRustHelpers, installLocalBins, pathHint } from './setup.ts';
import { recordRuntime, renderRuntimeLine } from './runtime.ts';
import { readWatchlist, writeWatchlist, type JsonObject } from './storage.ts';
import { formatLabRun, formatLabWorkflow, runLabStage, type LabStage } from './lab.ts';
import { providersJson, listMarketDataProviders } from './providers.ts';
import { ensureQuantSession, listQuantSessions, recordSessionEvent, sessionHandoff } from './session.ts';
import { formatBacktestResult, formatStrategyList, listBacktestStrategies } from './backtest.ts';
import { runBacktestRuntime } from './rustBacktest.ts';
import { validateDataRuntime } from './rustValidate.ts';
import { table } from './ui/table.ts';
import { SOURCES, discoverMarket, searchSymbolsLive, sourceById, symbolInfo, type DiscoverResult, type SourceInfo, type SymbolInfo, type SymbolSearchResult } from './discovery.ts';
import { periodToDateRange } from './period.ts';
import { marketStats } from './marketAnalysis.ts';
import { marketStatsRuntime } from './rustStats.ts';
import { formatResearchReport, runResearch } from './research.ts';
import { codexRuntimeGuide, formatCodexRuntimeGuide } from './guide.ts';
import { defineEvent, parseEventWindows } from './events.ts';
import { runEventStudyRuntime } from './rustEvent.ts';
import { compareSymbols, formatCompareResult } from './compare.ts';
import { runtimeInfoPayload, formatRuntimeInfo } from './runtimeContract.ts';
import { dataOptionsFromTail, numberOption, takeOption, takeRepeatedOption } from './cliArgs.ts';
import { doctorPayload } from './doctor.ts';
import { helpText } from './help.ts';

export { periodToDateRange } from './period.ts';

const APP = 'QuantOps';
const VERSION = '0.1.0';
const CYAN = '\u001b[96m';
const YELLOW = '\u001b[93m';
const RESET = '\u001b[0m';
export const ROOT_COMPLETIONS = ['start', 'help', 'codex-guide', 'runtime', 'symbol', 'data', 'stats', 'compare', 'research', 'event', 'backtest', 'session', 'provider', 'sources', 'doctor', 'setup'];
const DISCOVER_CATEGORIES = ['trending', 'most-active', 'gainers', 'losers', 'etf', 'semiconductor'];
const DISCOVER_OPTIONS = ['--source', '--limit', '--download', '--period', '--start', '--end'];
const DATA_SOURCE_COMPLETIONS = [...OHLCV_DOWNLOAD_SOURCES];

function discoverCompletionCandidates(parts: string[]): string[] {
  if (parts.length <= 2) return DISCOVER_CATEGORIES;
  const previous = parts.at(-2);
  const token = parts.at(-1) ?? '';
  if (token === '' && previous === '--source') return ['local', 'yahoo'];
  if (token === '' && previous === '--limit') return ['10', '25', '50', '100'];
  if (token === '' && previous === '--period') return ['5d', '30d', '6mo', '1y', 'ytd', 'max'];
  if (token === '' && (previous === '--start' || previous === '--end')) return [];
  return DISCOVER_OPTIONS;
}

export function completionCandidates(line: string, _mode = 'quant', _completionDataDir = 'data'): string[] {
  const trimmed = line.trimStart();
  if (!trimmed) return [...ROOT_COMPLETIONS].sort();
  const baseParts = trimmed.trimEnd().split(/\s+/).filter(Boolean);
  const parts = trimmed.endsWith(' ') ? [...baseParts, ''] : baseParts;
  if (parts.length <= 1) return [...ROOT_COMPLETIONS].sort();
  const command = parts[0];
  if (command === 'runtime') return ['info', 'line', 'snapshot', '--json'];
  if (command === 'event') return parts.length <= 2 ? ['define', 'study', 'windows'] : ['--json', '--event-date', '--benchmark', '--window', '--type', '--target-symbol', '--source-symbol', '--topic', '--thesis'];
  if (command === 'compare') return parts.length <= 2 ? [] : ['--source', '--interval', '--provider-symbol', '--json'];
  if (command === 'provider') return parts.length <= 2 ? ['list'] : ['--json'];
  if (command === 'session') return parts.length <= 2 ? ['current', 'list', 'handoff'] : ['--json'];
  if (command === 'data') {
    if (parts.length <= 2) return ['download', 'watchlist', 'list', 'info', 'validate', 'refresh'];
    if ((parts.at(-1) ?? '') === '' && parts.at(-2) === '--source') return DATA_SOURCE_COMPLETIONS;
    if (parts[1] === 'download' || parts[1] === 'refresh') return ['--period', '--start', '--end', '--interval', '--source', '--provider-symbol', '--json'];
    if (parts[1] === 'info') return ['--json', '--source', '--interval'];
    if (parts[1] === 'validate') return ['--json', '--max-stale-days'];
    if (parts[1] === 'watchlist') return ['refresh', '--period', '--start', '--end', '--interval', '--source', '--json'];
    return [];
  }
  if (command === 'backtest') {
    if (parts.length <= 2) return ['run', 'strategies', 'list'];
    if (parts[1] === 'run') {
      if (parts.length <= 3) return ['AAPL', 'NVDA', 'SPY', 'TSM'];
      if ((parts.at(-1) ?? '') === '' && parts.at(-2) === '--strategy') return listBacktestStrategies().map((strategy) => strategy.name);
      if ((parts.at(-1) ?? '') === '' && parts.at(-2) === '--source') return DATA_SOURCE_COMPLETIONS;
      return ['--strategy', '--fast', '--slow', '--lookback', '--threshold', '--source', '--interval', '--provider-symbol', '--no-save', '--json'];
    }
    return [];
  }
  if (command === 'research') {
    if (parts.length <= 2) return ['AAPL', 'NVDA', 'TSM', 'SPY'];
    if (trimmed.endsWith(' ') && parts.at(-2) === '--source') return DATA_SOURCE_COMPLETIONS;
    if (trimmed.endsWith(' ') && parts.at(-2) === '--interval') return ['d', '1d', '1wk', '1mo'];
    return trimmed.endsWith(' ') || (parts.at(-1) ?? '').startsWith('--') ? ['--topic', '--source', '--interval', '--provider-symbol', '--no-save', '--json'] : [];
  }
  if (command === 'sources') return parts.length <= 2 ? ['list', 'stooq', 'yahoo', 'alphavantage', 'twelve', 'polygon', 'fmp', 'sec', 'nasdaq', 'vendor'] : [];
  if (command === 'symbol') {
    if (parts.length <= 2) return ['search', 'info'];
    if (parts[1] === 'search') return ['--source', '--limit', '--json'];
    return ['--json'];
  }
  if (command === 'stats') return ['--source', '--interval', '--provider-symbol', '--json'];
  if (command === 'setup') return ['bin', 'rust'];
  return [];
}

export function completeLine(line: string, mode = 'quant', completionDataDir = 'data'): [string[], string] {
  const token = line.endsWith(' ') ? '' : (line.split(/\s+/).at(-1) ?? '');
  const candidates = completionCandidates(line, mode, completionDataDir);
  const matches = candidates.filter((candidate) => candidate.startsWith(token));
  return [matches.length ? matches : candidates, token];
}

function warn(text: string) {
  console.log(`  ${YELLOW}warn${RESET}  ${text}`);
}
function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function printText(text: string) {
  console.log(text);
}

function compactDate(value: unknown): string {
  const text = String(value ?? '');
  return text.length === 8 && /^\d+$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : text || '-';
}

function formatSource(source: SourceInfo): string[] {
  return [source.id, source.kind, source.auth, source.command];
}

function formatSymbol(symbol: SymbolInfo): string[] {
  return [symbol.symbol, symbol.assetClass, symbol.category, symbol.source, symbol.next];
}

function formatSymbolSearchResult(result: SymbolSearchResult): string {
  const meta = [
    `Symbol search: ${result.query || 'all'}`,
    `source: ${result.source}${result.live ? ' live' : ' cached/local'}`,
    result.note,
  ];
  if (result.fallback) meta.push(`fallback: ${result.fallback}`);
  if (result.cachePath) meta.push(`cache: ${result.cachePath}`);
  return [
    ...meta,
    '',
    table(['symbol', 'type', 'category', 'source', 'next'], result.items.map(formatSymbol)),
  ].join('\n');
}

function formatDownloadResult(result: any): string {
  if (result?.skipped) {
    return [
      `✅ ${result.ticker ?? result.symbol} refresh skipped`,
      result.reason ?? 'dataset already current',
      `latest: ${result.latest_date ?? '-'}`,
      '',
    `next  rtk ${result.next_command ?? `stats ${result.ticker ?? result.symbol}`}`,
    ].join('\n');
  }
  if (!result?.ok) return JSON.stringify(result, null, 2);
  const period = `${compactDate(result.start)} ~ ${compactDate(result.end)}`;
  return [
    `✅ ${result.ticker ?? result.symbol} 다운로드 완료`,
    '',
    table(
      ['field', 'value'],
      [
        ['source', result.source ?? '-'],
        ['provider', result.provider_symbol ?? '-'],
        ['period', period === '- ~ -' ? 'full available history' : period],
        ['interval', result.interval ?? '-'],
        ['rows', String(result.rows ?? 0)],
        ['new_rows', String(result.new_rows ?? 0)],
        ['raw', result.raw_path ?? '-'],
        ['dataset', result.dataset_path ?? '-'],
        ['url', result.url ?? '-'],
      ],
    ),
    '',
    `next  rtk stats ${result.ticker ?? result.symbol}`,
  ].join('\n');
}

function formatWatchlistDownloadResult(result: any): string {
  if (!result?.results) return JSON.stringify(result, null, 2);
  const completed = result.downloaded ?? result.refreshed ?? 0;
  const action = result.refreshed === undefined ? 'downloaded' : 'refreshed';
  const title = result.refreshed === undefined ? 'watchlist 다운로드' : 'watchlist refresh';
  const rows = result.results.map((item: any) => [
    item.ticker ?? '-',
    item.ok ? 'ok' : 'failed',
    item.source ?? '-',
    item.provider_symbol ?? '-',
    String(item.rows ?? 0),
    String(item.new_rows ?? 0),
    item.error ?? item.dataset_path ?? '-',
  ]);
  return [
    result.ok ? `✅ ${title} 완료` : `⚠️ ${title} 일부 실패`,
    '',
    table(['symbol', 'status', 'source', 'provider', 'rows', 'new', 'detail'], rows),
    '',
    `${action} ${completed}, failed ${result.failed ?? 0}`,
  ].join('\n');
}

function formatDataList(result: any): string {
  const datasets = result?.datasets ?? [];
  if (!datasets.length) return '저장된 market dataset이 없습니다.\nnext  rtk data download AAPL --period 1y';
  const rows = datasets.map((item: any) => [
    String(item.provider_symbol ?? item.name ?? '-').toUpperCase(),
    String(item.source ?? '-'),
    String(item.interval ?? item.name?.split('_').at(-1) ?? '-'),
    String(item.rows ?? 0),
    String(item.first_date ?? '-'),
    String(item.latest_date ?? '-'),
    String(item.path ?? '-'),
  ]);
  return table(['symbol', 'source', 'int', 'rows', 'first', 'last', 'path'], rows);
}

function formatDataInfo(result: any): string {
  const datasets = result?.datasets ?? [];
  if (!datasets.length) return `저장된 market dataset이 없습니다.\nnext  rtk ${result?.next_command ?? 'data download AAPL --period 1y'}`;
  const rows = datasets.map((item: any) => [
    String(item.provider_symbol ?? item.name ?? '-').toUpperCase(),
    String(item.source ?? '-'),
    String(item.interval ?? '-'),
    String(item.rows ?? 0),
    String(item.first_date ?? '-'),
    String(item.latest_date ?? '-'),
    item.latest_age_days === null || item.latest_age_days === undefined ? '-' : `${item.latest_age_days}d`,
    String(item.next_command ?? '-'),
  ]);
  return [
    `Market data info: ${result.symbol ?? 'all'} (${result.count ?? rows.length} dataset${(result.count ?? rows.length) === 1 ? '' : 's'})`,
    '',
    table(['symbol', 'source', 'int', 'rows', 'first', 'last', 'age', 'next'], rows),
  ].join('\n');
}

function formatDataValidation(result: any): string {
  const issues = result?.issues ?? [];
  const rows = issues.map((item: any) => [
    String(item.severity ?? '-'),
    String(item.code ?? '-'),
    String(item.dataset ?? '-'),
    String(item.date ?? '-'),
    String(item.message ?? '-'),
  ]);
  return [
    result.ok ? '✅ market data validation passed' : '⚠️ market data validation found issues',
    `datasets: ${(result.datasets ?? []).length}`,
    '',
    rows.length ? table(['sev', 'code', 'dataset', 'date', 'message'], rows) : 'No issues found.',
    result.next_command ? `\nnext  rtk ${result.next_command}` : '',
  ].join('\n').trimEnd();
}

function formatDataOutput(sub: string, stdout: string): string {
  let parsed: any;
  try { parsed = JSON.parse(stdout); } catch { return stdout; }
  if (sub === 'download') return formatDownloadResult(parsed);
  if (sub === 'refresh') return formatDownloadResult(parsed);
  if (sub === 'watchlist') return formatWatchlistDownloadResult(parsed);
  if (sub === 'list') return formatDataList(parsed);
  if (sub === 'info') return formatDataInfo(parsed);
  if (sub === 'validate') return formatDataValidation(parsed);
  return stdout;
}

function dataDirFrom(argv: string[]): { dataDir: string; rest: string[] } {
  const rest: string[] = [];
  let dataDir = 'data';
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]!;
    if (item === '--data-dir') { dataDir = argv[++i] ?? dataDir; continue; }
    if (item === '--no-tmux') continue;
    rest.push(item);
  }
  return { dataDir, rest };
}

function takeNumberOption(args: string[], flag: string): number | undefined {
  const value = takeOption(args, flag);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} requires a number`);
  return parsed;
}

function commandDoctor(dataDir: string): number {
  const payload = doctorPayload(dataDir, { app: APP, version: VERSION });
  printJson(payload);
  return payload.ok ? 0 : 1;
}

function commandQuoteFetch(dataDir: string, ticker?: string): number {
  if (!ticker) { warn('usage: quote fetch <TICKER>'); return 2; }
  const result = collectQuote(dataDir, ticker);
  printJson(result.ok ? { ok: true, saved_to: result.saved_to, ticker: result.ticker, fetched_at: result.fetched_at } : result);
  return result.ok ? 0 : result.returncode || 1;
}


function commandCollect(dataDir: string, sub?: string, tail: string[] = []): number {
  if (!sub || sub === 'plan') {
    const explicitTickers = tail.filter((item) => !item.startsWith('--'));
    const includeWatchlist = tail.includes('--watchlist') || tail.includes('--all') || explicitTickers.length === 0;
    printJson(collectionPlan({ dataDir, tickers: explicitTickers, includeWatchlist }));
    return 0;
  }
  if (sub === 'quote') {
    const ticker = tail[0];
    if (!ticker) { warn('usage: collect quote <TICKER>'); return 2; }
    const result = collectQuote(dataDir, ticker);
    printJson(result);
    return result.ok ? 0 : result.returncode || 1;
  }
  if (sub === 'watchlist') {
    const plan = collectionPlan({ dataDir, includeWatchlist: true });
    const summary = collectionSummary(runCollectionPlan(plan));
    printJson({ ...summary, plan });
    return summary.ok ? 0 : 1;
  }
  warn('usage: collect [plan [TICKER...|--watchlist]|quote <TICKER>|watchlist]');
  return 2;
}

function ideaSummaryRow(idea: QuantIdea): string[] {
  return [
    idea.id,
    idea.status,
    idea.symbols.join(', ') || '-',
    String(idea.hypotheses.length),
    idea.title,
  ];
}

function formatIdea(idea: QuantIdea): string {
  return [
    `Idea: ${idea.title}`,
    `ID: ${idea.id}`,
    `Status: ${idea.status}`,
    `Created: ${idea.created_at}`,
    `Updated: ${idea.updated_at}`,
    '',
    'Symbols:',
    ...(idea.symbols.length ? idea.symbols.map((symbol) => `- ${symbol}`) : ['- none']),
    '',
    'Hypotheses:',
    ...(idea.hypotheses.length ? idea.hypotheses.map((item) => `- ${item}`) : ['- none']),
  ].join('\n');
}

function formatIdeaPlain(idea: QuantIdea): string {
  return [
    `id=${idea.id}`,
    `title=${idea.title}`,
    `status=${idea.status}`,
    `created_at=${idea.created_at}`,
    `updated_at=${idea.updated_at}`,
    `symbols=${idea.symbols.join(',') || '-'}`,
    'hypotheses:',
    ...(idea.hypotheses.length ? idea.hypotheses.map((item) => `- ${item}`) : ['- none']),
  ].join('\n');
}

function formatReadiness(item: IdeaReadiness): string[] {
  return [item.symbol, item.market_data, item.validation, item.research, item.next_commands.map((cmd) => `rtk ${cmd}`).join(' | ')];
}

function formatIdeaStatus(result: ReturnType<typeof ideaStatus>): string {
  const idea = result.idea;
  const next = result.next_commands.map((cmd, index) => `${index + 1}. rtk ${cmd}`);
  return [
    formatIdea(idea),
    '',
    'Evidence readiness:',
    result.readiness.length ? table(['symbol', 'market', 'validation', 'research', 'next'], result.readiness.map(formatReadiness)) : '- no symbols yet',
    '',
    'Next commands:',
    ...(next.length ? next : [`1. rtk idea add-symbol ${idea.id} AAPL`]),
  ].join('\n');
}

function formatIdeaStatusPlain(result: ReturnType<typeof ideaStatus>): string {
  const idea = result.idea;
  return [
    formatIdeaPlain(idea),
    'readiness:',
    ...(result.readiness.length
      ? result.readiness.map((item) => `${item.symbol}: market=${item.market_data} validation=${item.validation} research=${item.research}`)
      : ['- no symbols yet']),
    'next:',
    ...(result.next_commands.length ? result.next_commands.map((cmd) => `rtk ${cmd}`) : [`rtk idea add-symbol ${idea.id} AAPL`]),
  ].join('\n');
}

function recordRuntimeContext(type: string, summary: string, payload: JsonObject = {}): void {
  const session = ensureQuantSession({ id: 'codex-runtime', title: summary.slice(0, 80) || 'QuantOps Codex runtime' });
  recordSessionEvent(session, { type, summary, payload });
}

function commandIdea(dataDir: string, action = 'list', tail: string[] = []): number {
  try {
    const plain = tail.includes('--plain');
    const args = tail.filter((item) => item !== '--plain');
    if (action === 'new') {
      const title = args.join(' ');
      const idea = createIdea(dataDir, title);
      const suggestedSymbol = title.match(/\b[A-Z][A-Z0-9.-]{1,9}\b/)?.[0] ?? 'AAPL';
      recordRuntimeContext('idea.created', `created idea ${idea.id}: ${idea.title}`, { idea: idea.id, title: idea.title, suggested_symbol: suggestedSymbol });
      printText([
        `created idea ${idea.id}`,
        `title: ${idea.title}`,
        `saved_to: ${ideaPath(dataDir, idea.id)}`,
        `next  rtk idea add-symbol ${idea.id} ${suggestedSymbol}`,
      ].join('\n'));
      return 0;
    }
    if (action === 'list') {
      const ideas = listIdeas(dataDir);
      printText(ideas.length ? table(['id', 'status', 'symbols', 'hypotheses', 'title'], ideas.map(ideaSummaryRow)) : '저장된 idea가 없습니다.\nnext  rtk idea new "NVDA earnings momentum"');
      return 0;
    }
    if (action === 'show') {
      const id = args[0];
      if (!id) { warn('usage: idea show <ID>'); return 2; }
      const idea = readIdea(dataDir, id);
      printText(plain ? formatIdeaPlain(idea) : formatIdea(idea));
      return 0;
    }
    if (action === 'add-symbol') {
      const [id, symbol] = args;
      if (!id || !symbol) { warn('usage: idea add-symbol <ID> <SYMBOL>'); return 2; }
      const idea = addIdeaSymbol(dataDir, id, symbol);
      recordRuntimeContext('idea.symbol_added', `added ${symbol.toUpperCase()} to ${idea.id}`, { idea: idea.id, symbol: symbol.toUpperCase(), symbols: idea.symbols });
      printText([
        `updated idea ${idea.id}`,
        `symbols: ${idea.symbols.join(', ') || '-'}`,
        `next  rtk idea status ${idea.id}`,
      ].join('\n'));
      return 0;
    }
    if (action === 'add-hypothesis') {
      const id = args[0];
      const hypothesis = args.slice(1).join(' ');
      if (!id || !hypothesis) { warn('usage: idea add-hypothesis <ID> <TEXT>'); return 2; }
      const idea = addIdeaHypothesis(dataDir, id, hypothesis);
      recordRuntimeContext('idea.hypothesis_added', `added hypothesis to ${idea.id}`, { idea: idea.id, hypothesis });
      printText([
        `updated idea ${idea.id}`,
        `hypotheses: ${idea.hypotheses.length}`,
        `next  rtk idea status ${idea.id}`,
      ].join('\n'));
      return 0;
    }
    if (action === 'status') {
      const id = args[0];
      if (!id) { warn('usage: idea status <ID>'); return 2; }
      const status = ideaStatus(dataDir, id);
      if (!plain) recordRuntimeContext('idea.status', `checked idea status ${status.idea.id}`, { idea: status.idea.id, readiness: status.readiness as unknown as JsonObject[] });
      printText(plain ? formatIdeaStatusPlain(status) : formatIdeaStatus(status));
      return 0;
    }
  } catch (error) {
    printJson({ ok: false, action, error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
  warn('usage: idea [new <TITLE>|list|show <ID>|add-symbol <ID> <SYMBOL>|add-hypothesis <ID> <TEXT>|status <ID>]');
  return 2;
}

function commandResearch(dataDir: string, symbol?: string, tail: string[] = []): number {
  if (!symbol) { warn('usage: research <SYMBOL> [--topic <TEXT>] [--source yahoo|stooq] [--provider-symbol <ID>]'); return 2; }
  try {
    const rest = [...tail];
    const json = rest.includes('--json');
    const noSave = rest.includes('--no-save');
    for (let i = rest.length - 1; i >= 0; i -= 1) if (rest[i] === '--no-save' || rest[i] === '--json') rest.splice(i, 1);
    const explicitSource = rest.includes('--source');
    const explicitInterval = rest.includes('--interval');
    const explicitProvider = rest.includes('--provider-symbol');
    const explicitTopic = takeOption(rest, '--topic');
    const { request } = dataOptionsFromTail(rest);
    const topic = [explicitTopic, ...rest.filter((item) => !item.startsWith('--'))].filter(Boolean).join(' ') || undefined;
    const result = runResearch(symbol, {
      base: dataDir,
      topic,
      source: explicitSource ? request.source : undefined,
      interval: explicitInterval ? request.interval : undefined,
      providerSymbol: explicitProvider ? request.providerSymbol : undefined,
      save: !noSave,
    });
    recordRuntimeContext('research.report', `research ${symbol.toUpperCase()}${topic ? `: ${topic}` : ''}`, {
      symbol: symbol.toUpperCase(),
      topic: topic ?? '',
      ok: !result.missing_data,
      missing_data: Boolean(result.missing_data),
      saved_to: result.saved_to ?? '',
    });
    printText(json ? JSON.stringify(result, null, 2) : [
      formatResearchReport(result),
      '',
      `next  rtk event define --target-symbol ${symbol.toUpperCase()} --json`,
    ].join('\n'));
    return result.missing_data ? 1 : 0;
  } catch (error) {
    printJson({ ok: false, symbol: symbol.toUpperCase(), error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}

function commandLab(dataDir: string, action = 'workflow', tail: string[] = []): number {
  const stages = new Set(['discuss', 'verify', 'backtest']);
  try {
    const promptOnly = tail.includes('--prompt');
    const noSave = tail.includes('--no-save') || promptOnly;
    const args = tail.filter((item) => item !== '--prompt' && item !== '--no-save');
    const ref = args[0];
    if (!ref) {
      warn('usage: lab [workflow|discuss|verify|backtest] <IDEA_REF> [--prompt] [--no-save]');
      return 2;
    }
    if (action === 'workflow') {
      printText(formatLabWorkflow(ideaStatus(dataDir, ref)));
      return 0;
    }
    if (stages.has(action)) {
      const focus = args.slice(1).join(' ');
      const result = runLabStage(action as LabStage, ref, { base: dataDir, save: !noSave, focus });
      if (action === 'discuss') {
        const session = ensureQuantSession({ id: 'codex-runtime', title: `Lab ${result.idea.title}` });
        recordSessionEvent(session, {
          type: 'lab.discuss',
          summary: focus || `created discussion prompt for ${result.idea.title}`,
          payload: { idea: result.idea.id, focus: focus || '', next: [`rtk lab verify ${result.idea.id} --prompt`] },
        });
      }
      printText(formatLabRun(result, { promptOnly }));
      return 0;
    }
  } catch (error) {
    printJson({ ok: false, action, error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
  warn('usage: lab [workflow|discuss|verify|backtest] <IDEA_REF> [--prompt] [--no-save]');
  return 2;
}

function commandStats(dataDir: string, symbol?: string, tail: string[] = []): number {
  if (!symbol) { warn('usage: stats <SYMBOL>'); return 2; }
  try {
    const { request } = dataOptionsFromTail(tail);
    const result = marketStatsRuntime(symbol, { base: dataDir, source: request.source, interval: request.interval, providerSymbol: request.providerSymbol });
    printJson(result);
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson({ ok: false, symbol: symbol.toUpperCase(), error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}

function commandCompare(dataDir: string, symbols: string[] = []): number {
  const rest = [...symbols];
  const json = rest.includes('--json');
  for (let i = rest.length - 1; i >= 0; i -= 1) if (rest[i] === '--json') rest.splice(i, 1);
  const explicitSource = rest.includes('--source');
  const explicitInterval = rest.includes('--interval');
  const explicitProvider = rest.includes('--provider-symbol');
  const { request, rest: expanded } = dataOptionsFromTail(rest);
  const targets = expanded.filter((item) => !item.startsWith('--'));
  if (targets.length < 2) { warn('usage: compare <SYMBOL> <PEER_OR_BENCHMARK...> [--json]'); return 2; }
  const payload = compareSymbols(targets, {
    base: dataDir,
    source: explicitSource ? request.source : 'yahoo',
    interval: explicitInterval ? request.interval : 'd',
    providerSymbol: explicitProvider ? request.providerSymbol : undefined,
  });
  printText(json ? JSON.stringify(payload, null, 2) : formatCompareResult(payload));
  return payload.ok ? 0 : 1;
}

function commandEvent(dataDir: string, action = 'windows', tail: string[] = []): number {
  try {
    const rest = [...tail];
    const json = rest.includes('--json');
    for (let i = rest.length - 1; i >= 0; i -= 1) if (rest[i] === '--json') rest.splice(i, 1);
    const windowValues = takeRepeatedOption(rest, '--window');
    const windows = parseEventWindows(windowValues);
    if (action === 'windows') {
      const payload = { ok: true, command: 'event.windows', windows };
      printText(json ? JSON.stringify(payload, null, 2) : table(['label', 'from', 'to'], windows.map((window) => [window.label, String(window.from), String(window.to)])));
      return 0;
    }
    if (action === 'define') {
      const type = takeOption(rest, '--type');
      const targetSymbol = takeOption(rest, '--target-symbol');
      const sourceSymbol = takeOption(rest, '--source-symbol');
      const benchmark = takeOption(rest, '--benchmark');
      const topic = takeOption(rest, '--topic') || rest.filter((item) => !item.startsWith('--')).join(' ') || undefined;
      const thesis = takeOption(rest, '--thesis');
      const payload = defineEvent({ type, targetSymbol, sourceSymbol, benchmark, topic, thesis, windows });
      printText(JSON.stringify(payload, null, 2));
      return 0;
    }
    if (action === 'study') {
      const symbol = rest.find((item) => !item.startsWith('--'));
      if (!symbol) { warn('usage: event study <SYMBOL> --event-date YYYY-MM-DD [--benchmark SYMBOL] [--window FROM,TO] [--json]'); return 2; }
      const eventDate = takeOption(rest, '--event-date');
      const benchmark = takeOption(rest, '--benchmark');
      const explicitSource = rest.includes('--source');
      const explicitInterval = rest.includes('--interval');
      const explicitProvider = rest.includes('--provider-symbol');
      const { request } = dataOptionsFromTail(rest);
      const payload = runEventStudyRuntime(symbol, {
        base: dataDir,
        eventDate,
        benchmark,
        windows,
        source: explicitSource ? request.source : 'yahoo',
        interval: explicitInterval ? request.interval : 'd',
        providerSymbol: explicitProvider ? request.providerSymbol : undefined,
      });
      printText(json ? JSON.stringify(payload, null, 2) : JSON.stringify(payload, null, 2));
      return payload.ok ? 0 : 1;
    }
  } catch (error) {
    printJson({ ok: false, command: `event.${action}`, error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
  warn('usage: event [windows|define|study] [--json]');
  return 2;
}

function commandRuntimeInfo(dataDir: string, json = false): number {
  const payload = runtimeInfoPayload(dataDir);
  printText(json ? JSON.stringify(payload, null, 2) : formatRuntimeInfo(payload));
  return 0;
}

function commandCodexGuide(tail: string[] = []): number {
  const json = tail.includes('--json');
  printText(json ? JSON.stringify(codexRuntimeGuide(), null, 2) : formatCodexRuntimeGuide());
  return 0;
}

async function commandData(dataDir: string, sub?: string, tail: string[] = []): Promise<number> {
  if (!sub) { warn('usage: data [download <SYMBOL>|refresh <SYMBOL>|watchlist [refresh]|list|info|validate]'); return 2; }
  try {
    const explicitSource = tail.includes('--source');
    const explicitInterval = tail.includes('--interval');
    const { json, request, rest } = dataOptionsFromTail(tail);
    if (sub === 'download') {
      const symbol = rest[0];
      if (!symbol) { warn('usage: data download <SYMBOL>'); return 2; }
      const result = await downloadHistory({ symbol, ...request }, { base: dataDir });
      printText(json ? JSON.stringify(result, null, 2) : formatDataOutput(sub, JSON.stringify(result)));
      return result.ok ? 0 : 1;
    }
    if (sub === 'refresh') {
      const symbol = rest[0];
      if (!symbol) { warn('usage: data refresh <SYMBOL>'); return 2; }
      const result = await refreshHistory({ symbol, ...request }, { base: dataDir });
      printText(json ? JSON.stringify(result, null, 2) : formatDataOutput(sub, JSON.stringify(result)));
      return result.ok ? 0 : 1;
    }
    if (sub === 'watchlist') {
      const action = rest[0] === 'refresh' ? 'refresh' : 'download';
      const result = action === 'refresh' ? await refreshWatchlist({
        base: dataDir,
        source: request.source,
        interval: request.interval,
        start: request.start,
        end: request.end,
      }) : await downloadWatchlist({
        base: dataDir,
        source: request.source,
        interval: request.interval,
        start: request.start,
        end: request.end,
      });
      printText(json ? JSON.stringify(result, null, 2) : formatDataOutput(sub, JSON.stringify(result)));
      return result.ok ? 0 : 1;
    }
    if (sub === 'list') {
      const result = { ok: true, datasets: listDatasets(dataDir) };
      printText(json ? JSON.stringify(result, null, 2) : formatDataOutput(sub, JSON.stringify(result)));
      return 0;
    }
    if (sub === 'info') {
      const symbol = rest.find((item) => !item.startsWith('--'));
      const result = dataInfo(dataDir, symbol, {
        source: explicitSource ? request.source : undefined,
        interval: explicitInterval ? request.interval : undefined,
      });
      printText(json ? JSON.stringify(result, null, 2) : formatDataOutput(sub, JSON.stringify(result)));
      return result.ok ? 0 : 1;
    }
    if (sub === 'validate') {
      const validateArgs = [...tail];
      const jsonOut = validateArgs.includes('--json');
      for (let i = validateArgs.length - 1; i >= 0; i -= 1) if (validateArgs[i] === '--json') validateArgs.splice(i, 1);
      const maxStaleDays = takeNumberOption(validateArgs, '--max-stale-days');
      const symbol = validateArgs.find((item) => !item.startsWith('--'));
      const result = validateDataRuntime(dataDir, symbol, { maxStaleDays });
      printText(jsonOut ? JSON.stringify(result, null, 2) : formatDataOutput(sub, JSON.stringify(result)));
      return result.ok ? 0 : 1;
    }
  } catch (error) {
    printJson({ ok: false, sub, error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
  warn('usage: data [download <SYMBOL>|refresh <SYMBOL>|watchlist [refresh]|list|info|validate]');
  return 2;
}

function commandAudit(dataDir: string, ticker?: string): number {
  const findings = auditAll(dataDir, ticker);
  printJson({ ok: !findings.some((item) => item.severity === 'error'), findings });
  return findings.some((item) => item.severity === 'error') ? 1 : 0;
}

function commandSources(kind = 'list'): number {
  const target = kind === 'list' ? undefined : sourceById(kind);
  if (target) {
    printText([
      `${target.name} (${target.id})`,
      '',
      table(
        ['field', 'value'],
        [
          ['kind', target.kind],
          ['auth', target.auth],
          ['coverage', target.coverage],
          ['command', target.command],
          ['note', target.note],
        ],
      ),
    ].join('\n'));
    return 0;
  }
  if (kind !== 'list') warn(`unknown source: ${kind}; showing all sources`);
  printText(table(['id', 'kind', 'auth', 'try'], SOURCES.map(formatSource)));
  return kind === 'list' ? 0 : 1;
}

function parseDiscoverArgs(parts: string[]): { category: string; source: 'local' | 'yahoo' | 'live'; limit: number; download: boolean; dataArgs: string[] } {
  const rest = [...parts];
  const source = (takeOption(rest, '--source') ?? 'local').toLowerCase();
  const limit = Number(takeOption(rest, '--limit') ?? 25);
  const dataArgs: string[] = [];
  for (const flag of ['--period', '--start', '--end', '--interval']) {
    const value = takeOption(rest, flag);
    if (value !== undefined) dataArgs.push(flag, value);
  }
  const download = rest.includes('--download');
  const filtered = rest.filter((item) => item !== '--download' && !item.startsWith('--'));
  return {
    category: filtered.join(' ') || 'trending',
    source: source === 'yahoo' || source === 'live' ? source : 'local',
    limit: Number.isFinite(limit) ? limit : 25,
    download,
    dataArgs,
  };
}

function formatDiscoverResult(result: DiscoverResult): string {
  const meta = [
    `Discover: ${result.category}`,
    `source: ${result.source}${result.live ? ' live' : ' cached/local'}`,
    result.note,
  ];
  if (result.fallback) meta.push(`fallback: ${result.fallback}`);
  if (result.cachePath) meta.push(`cache: ${result.cachePath}`);
  return [
    ...meta,
    '',
    table(['symbol', 'type', 'category', 'source', 'next'], result.items.map(formatSymbol)),
  ].join('\n');
}

async function downloadDiscoveredSymbols(dataDir: string, result: DiscoverResult, dataArgs: string[]): Promise<{ ok: boolean; text: string }> {
  const rows: string[][] = [];
  let failed = 0;
  const args = dataArgs.length ? dataArgs : ['--period', '1y'];
  for (const item of result.items) {
    let parsed: any = {};
    try {
      const { request } = dataOptionsFromTail(args);
      parsed = await downloadHistory({ symbol: item.symbol, ...request }, { base: dataDir });
    } catch (error) {
      parsed = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!parsed.ok) failed += 1;
    rows.push([
      item.symbol,
      parsed.ok ? 'ok' : 'failed',
      parsed.source ?? '-',
      parsed.provider_symbol ?? '-',
      String(parsed.rows ?? 0),
      String(parsed.new_rows ?? 0),
      parsed.error ?? parsed.dataset_path ?? '-',
    ]);
  }
  return {
    ok: failed === 0,
    text: [
      failed === 0 ? '✅ discover 다운로드 완료' : '⚠️ discover 다운로드 일부 실패',
      '',
      table(['symbol', 'status', 'source', 'provider', 'rows', 'new', 'detail'], rows),
      '',
      `downloaded ${rows.length - failed}, failed ${failed}`,
    ].join('\n'),
  };
}

async function commandDiscover(dataDir: string, parts: string[]): Promise<number> {
  const options = parseDiscoverArgs(parts);
  const result = await discoverMarket({
    category: options.category,
    source: options.source,
    limit: options.limit,
    dataDir,
  });
  const downloaded = options.download ? await downloadDiscoveredSymbols(dataDir, result, options.dataArgs) : undefined;
  printText([
    formatDiscoverResult(result),
    downloaded ? ['', downloaded.text].join('\n') : '',
  ].join('\n'));
  return 0;
}

function downloadAliasArgs(symbol?: string, tail: string[] = []): string[] {
  if (!symbol) return [];
  const hasRange = tail.includes('--period') || tail.includes('--start') || tail.includes('--end');
  return [symbol, ...(hasRange ? [] : ['--period', '1y']), ...tail];
}

function parseSymbolSearchArgs(query: string): { query: string; source: 'local' | 'yahoo' | 'live'; limit: number; json: boolean } {
  const parts = query.split(/\s+/).filter(Boolean);
  const json = parts.includes('--json');
  for (let i = parts.length - 1; i >= 0; i -= 1) if (parts[i] === '--json') parts.splice(i, 1);
  const source = (takeOption(parts, '--source') ?? 'yahoo').toLowerCase();
  const limit = Number(takeOption(parts, '--limit') ?? 10);
  return {
    query: parts.join(' '),
    source: source === 'local' || source === 'live' ? source : 'yahoo',
    limit: Number.isFinite(limit) ? limit : 10,
    json,
  };
}

async function commandSymbol(dataDir: string, action = 'search', query = ''): Promise<number> {
  if (action !== 'search' && action !== 'info') {
    query = action;
    action = 'info';
  }
  const options = parseSymbolSearchArgs(query);
  if (action === 'info') {
    const item = symbolInfo(options.query);
    if (!item) { warn(`unknown symbol: ${options.query}`); return 1; }
    const payload = { ok: true, command: 'symbol.info', symbol: item };
    printText(options.json ? JSON.stringify(payload, null, 2) : [
      `${item.symbol} — ${item.name}`,
      '',
      table(
        ['field', 'value'],
        [
          ['asset_class', item.assetClass],
          ['category', item.category],
          ['exchange', item.exchange ?? '-'],
          ['source', item.source],
          ['tags', item.tags.join(', ')],
          ['next', item.next],
          ['note', item.note],
        ],
      ),
    ].join('\n'));
    return 0;
  }
  const result = await searchSymbolsLive({
    query: options.query,
    source: options.source,
    limit: options.limit,
    dataDir,
  });
  const payload = { ok: true, command: 'symbol.search', ...result };
  printText(options.json ? JSON.stringify(payload, null, 2) : formatSymbolSearchResult(result));
  return 0;
}

function commandStart(): number {
  printText([
    'Start here — QuantOps JSON runtime',
    '',
    table(
      ['step', 'command', 'why'],
      [
        ['1', 'codex-guide', 'QuantOps JSON 런타임 계약 확인'],
        ['2', 'runtime info --json', '현재 런타임/계약/추천 시작 명령 확인'],
        ['3', 'symbol search TSMC --json', '자연어 이름을 ticker 후보로 변환'],
        ['4', 'data info/download/validate --json', '로컬 OHLCV 준비와 품질 확인'],
        ['5', 'stats / compare / research --json', '분석 재료와 리서치 컨텍스트 생성'],
        ['6', 'event define/study --json', '뉴스를 이벤트로 구조화하고 가격 반응 확인'],
        ['7', 'backtest run --json', '전략 가설 검증'],
      ],
    ),
    '',
    '기본 흐름: rtk CLI with --json → QuantOps returns artifacts/context.',
    '주력 명령: codex-guide, runtime info, symbol, data, stats, compare, research, event, backtest, session',
    '내린 기능: 로컬 대화 UI, 터미널 대시보드, 프로토콜-first 흐름',
  ].join('\n'));
  return 0;
}



function symbolFromBacktestTarget(dataDir: string, target: string): string {
  if (target === 'latest' || target.startsWith('idea-')) {
    const status = ideaStatus(dataDir, target);
    const symbol = status.idea.symbols[0];
    if (!symbol) throw new Error(`idea has no symbols yet: ${status.idea.id}`);
    return symbol;
  }
  return target.toUpperCase();
}

function commandStrategy(action = 'list', tail: string[] = []): number {
  const json = tail.includes('--json');
  if (action === 'list') {
    printText(json ? JSON.stringify({ ok: true, command: 'strategy.list', strategies: listBacktestStrategies() }, null, 2) : formatStrategyList());
    return 0;
  }
  warn('usage: strategy list [--json]');
  return 2;
}

function commandBacktest(dataDir: string, action = 'run', tail: string[] = []): number {
  try {
    if (action === 'list' || action === 'strategies') {
      const json = tail.includes('--json');
      printText(json ? JSON.stringify({ ok: true, command: 'backtest.strategies', strategies: listBacktestStrategies() }, null, 2) : formatStrategyList());
      return 0;
    }
    if (action !== 'run') {
      warn('usage: backtest [run <SYMBOL|latest>|strategies] [--strategy NAME] [--fast N] [--slow N] [--lookback N] [--threshold N] [--source yahoo|stooq] [--json] [--no-save]');
      return 2;
    }
    const rest = [...tail];
    const json = rest.includes('--json');
    const noSave = rest.includes('--no-save');
    for (let i = rest.length - 1; i >= 0; i -= 1) if (rest[i] === '--json' || rest[i] === '--no-save') rest.splice(i, 1);
    const strategy = takeOption(rest, '--strategy') || 'ma-cross';
    const fast = numberOption(rest, '--fast');
    const slow = numberOption(rest, '--slow');
    const lookback = numberOption(rest, '--lookback');
    const threshold = numberOption(rest, '--threshold');
    const explicitSource = rest.includes('--source');
    const explicitInterval = rest.includes('--interval');
    const explicitProvider = rest.includes('--provider-symbol');
    const { request, rest: expanded } = dataOptionsFromTail(rest);
    const target = expanded[0];
    if (!target) {
      warn('usage: backtest run <SYMBOL|latest> [--strategy ma-cross|momentum|mean-reversion|buy-hold]');
      return 2;
    }
    const symbol = symbolFromBacktestTarget(dataDir, target);
    const result = runBacktestRuntime(symbol, {
      base: dataDir,
      source: explicitSource ? request.source : 'yahoo',
      interval: explicitInterval ? request.interval : 'd',
      providerSymbol: explicitProvider ? request.providerSymbol : undefined,
      strategy,
      fast,
      slow,
      lookback,
      threshold,
      save: !noSave,
    });
    printText(json ? JSON.stringify(result, null, 2) : formatBacktestResult(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson({ ok: false, action, error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}

function commandProviders(action = 'list', tail: string[] = []): number {
  const json = tail.includes('--json');
  if (action === 'list') {
    const payload = providersJson();
    printText(json ? JSON.stringify(payload, null, 2) : [
      'Market data providers',
      table(['source', 'available', 'auth', 'env', 'detail'], listMarketDataProviders().map((provider) => [provider.name, provider.available ? 'yes' : 'no', provider.auth, (provider.env ?? []).join(' | ') || '-', provider.detail])),
    ].join('\n'));
    return 0;
  }
  warn('usage: provider list [--json]');
  return 2;
}

function commandSession(action = 'current', tail: string[] = []): number {
  try {
    const json = tail.includes('--json');
    const args = tail.filter((item) => item !== '--json');
    if (action === 'current') {
      const session = ensureQuantSession({ id: args[0] });
      printText(json ? JSON.stringify({ ok: true, session }, null, 2) : sessionHandoff(session));
      return 0;
    }
    if (action === 'list') {
      const sessions = listQuantSessions();
      printText(json ? JSON.stringify({ ok: true, sessions }, null, 2) : table(['id', 'updated', 'title'], sessions.map((session) => [session.id, session.updated_at, session.title])));
      return 0;
    }
    if (action === 'handoff') {
      const id = args[0] || listQuantSessions()[0]?.id;
      if (!id) { warn('usage: session handoff <SESSION_ID>'); return 2; }
      printText(sessionHandoff(id));
      return 0;
    }
  } catch (error) {
    printJson({ ok: false, action, error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
  warn('usage: session [current|list|handoff] [--json]');
  return 2;
}



function handleWatchlist(parts: string[], dataDir: string): number {
  const action = parts[1] ?? 'list';
  const tickers = readWatchlist(dataDir);
  if (action === 'list') { printJson({ watchlist: tickers }); return 0; }
  if (action === 'add' && parts[2]) { writeWatchlist([...tickers, parts[2]], dataDir); printText(`${parts[2].toUpperCase()} added to watchlist`); return 0; }
  if ((action === 'remove' || action === 'rm') && parts[2]) { writeWatchlist(tickers.filter((item) => item !== parts[2]!.toUpperCase()), dataDir); printText(`${parts[2].toUpperCase()} removed from watchlist`); return 0; }
  if (action === 'fetch') { let code = 0; for (const ticker of tickers) code = commandQuoteFetch(dataDir, ticker) || code; return code; }
  warn('usage: watchlist [list|add <TICKER>|remove <TICKER>|fetch]');
  return 2;
}

function runtimeLine(dataDir: string, mode = 'quant', lastAction = 'line'): string {
  return renderRuntimeLine(recordRuntime({ base: dataDir, mode, lastAction }));
}

export function welcomeCard(): string {
  return [
    `${CYAN}${APP}${RESET} ${VERSION} · headless quant runtime`,
    '',
    '기본 흐름: rtk ... --json → QuantOps returns artifacts/context.',
    '주력 명령: codex-guide, runtime info, symbol, data, stats, compare, research, event, backtest, session',
    '',
    'Start:',
    '  rtk codex-guide --json',
    '  rtk runtime info --json',
    '  rtk symbol search TSMC --json',
    '  rtk data download TSM --period 5y --json',
    '  rtk stats TSM --json',
  ].join('\n');
}


type CommandContext = {
  dataDir: string;
  sub?: string;
  tail: string[];
};

type CommandHandler = (ctx: CommandContext) => number | Promise<number>;

function argsWithSub(sub: string | undefined, tail: string[]): string[] {
  return [sub, ...tail].filter((item): item is string => Boolean(item));
}

function optionSub(defaultSub: string, sub: string | undefined, tail: string[]): { action: string; tail: string[] } {
  return sub?.startsWith('--')
    ? { action: defaultSub, tail: [sub, ...tail] }
    : { action: sub ?? defaultSub, tail };
}

function commandSetup(sub: string | undefined, tail: string[]): number {
  if (sub === 'bin') {
    try {
      const dirFlag = tail.indexOf('--dir');
      const dir = dirFlag >= 0 ? tail[dirFlag + 1] : undefined;
      const result = installLocalBins({ dir, force: tail.includes('--force') });
      printJson(result);
      console.log(pathHint(dir));
      return 0;
    } catch (error) {
      warn(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (sub === 'rust') {
    const result = buildRustHelpers({ release: tail.includes('--release') });
    printJson(result);
    return result.ok ? 0 : 1;
  }
  warn('usage: setup [bin|rust]');
  return 2;
}

function commandRuntime(dataDir: string, sub: string | undefined, tail: string[]): number {
  if (sub === 'snapshot') {
    printJson(recordRuntime({ base: dataDir, lastAction: 'snapshot' }));
    return 0;
  }
  if (sub === 'line') {
    console.log(runtimeLine(dataDir));
    return 0;
  }
  if (sub === 'info' || !sub || sub.startsWith('--')) {
    return commandRuntimeInfo(dataDir, argsWithSub(sub, tail).includes('--json'));
  }
  warn('usage: runtime [info|line|snapshot] [--json]');
  return 2;
}

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  help: () => { printText(helpText()); return 0; },
  '--help': () => { printText(helpText()); return 0; },
  '-h': () => { printText(helpText()); return 0; },
  start: () => commandStart(),
  'codex-guide': ({ sub, tail }) => commandCodexGuide(argsWithSub(sub, tail)),
  download: ({ dataDir, sub, tail }) => commandData(dataDir, 'download', downloadAliasArgs(sub, tail)),
  analyze: ({ dataDir, sub, tail }) => commandStats(dataDir, sub, tail),
  research: ({ dataDir, sub, tail }) => commandResearch(dataDir, sub, tail),
  event: ({ dataDir, sub, tail }) => commandEvent(dataDir, sub ?? 'windows', tail),
  compare: ({ dataDir, sub, tail }) => commandCompare(dataDir, argsWithSub(sub, tail)),
  idea: ({ dataDir, sub, tail }) => commandIdea(dataDir, sub ?? 'list', tail),
  lab: ({ dataDir, sub, tail }) => commandLab(dataDir, sub ?? 'workflow', tail),
  backtest: ({ dataDir, sub, tail }) => commandBacktest(dataDir, sub ?? 'run', tail),
  strategy: ({ sub, tail }) => {
    const args = optionSub('list', sub, tail);
    return commandStrategy(args.action, args.tail);
  },
  provider: ({ sub, tail }) => {
    const args = optionSub('list', sub, tail);
    return commandProviders(args.action, args.tail);
  },
  providers: ({ sub, tail }) => {
    const args = optionSub('list', sub, tail);
    return commandProviders(args.action, args.tail);
  },
  session: ({ sub, tail }) => {
    const args = optionSub('current', sub, tail);
    return commandSession(args.action, args.tail);
  },
  list: ({ dataDir, tail }) => commandData(dataDir, 'list', tail),
  doctor: ({ dataDir }) => commandDoctor(dataDir),
  collect: ({ dataDir, sub, tail }) => commandCollect(dataDir, sub, tail),
  data: ({ dataDir, sub, tail }) => commandData(dataDir, sub, tail),
  sources: ({ sub }) => commandSources(sub ?? 'list'),
  discover: ({ dataDir, sub, tail }) => commandDiscover(dataDir, argsWithSub(sub, tail)),
  symbol: ({ dataDir, sub, tail }) => commandSymbol(dataDir, sub ?? 'search', tail.join(' ')),
  stats: ({ dataDir, sub, tail }) => commandStats(dataDir, sub, tail),
  audit: ({ dataDir, sub }) => commandAudit(dataDir, sub),
  quote: ({ dataDir, sub, tail }) => sub === 'fetch' ? commandQuoteFetch(dataDir, tail[0]) : commandQuoteFetch(dataDir, sub),
  watchlist: ({ dataDir, sub, tail }) => handleWatchlist(['watchlist', sub ?? 'list', ...tail], dataDir),
  runtime: ({ dataDir, sub, tail }) => commandRuntime(dataDir, sub, tail),
  setup: ({ sub, tail }) => commandSetup(sub, tail),
};

export async function runOnce(argv: string[], opts: { quietUnknown?: boolean } = {}): Promise<number> {
  const { dataDir, rest } = dataDirFrom(argv);
  const [cmd, sub, ...tail] = rest;
  if (!cmd) return 2;
  const handler = COMMAND_HANDLERS[cmd];
  if (handler) return handler({ dataDir, sub, tail });
  if (!opts.quietUnknown) warn(`unknown command: ${cmd}`);
  return 2;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { rest } = dataDirFrom(argv);
  if (rest.length === 0) return commandStart();
  return runOnce(argv);
}


function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(invoked) === realpathSync(modulePath);
  } catch {
    return invoked === modulePath || import.meta.url === `file://${invoked}`;
  }
}

if (isCliEntrypoint()) {
  const code = await main();
  process.exitCode = code;
}
