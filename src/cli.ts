#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { classify, historyRows } from './analysis.ts';
import { auditAll } from './audit.ts';
import { collectionPlan, collectionSummary, collectQuote, runCollectionPlan } from './collect.ts';
import { filteredCodexOutput } from './codex.ts';
import { dataInfo, downloadHistory, downloadWatchlist, listDatasets, refreshHistory, refreshWatchlist, validateData, type DownloadRequest } from './data.ts';
import { defaultTmuxSession, launchTmuxHud, launchTmuxRuntime, printHudOnce, shutdownManagedTmuxRuntime, tmuxInstallHint, tmuxPath, watchHud } from './hud.ts';
import { addIdeaHypothesis, addIdeaSymbol, createIdea, ideaPath, ideaStatus, listIdeas, readIdea, type IdeaReadiness, type QuantIdea } from './idea.ts';
import { installLocalBins, pathHint } from './setup.ts';
import { recordRuntime, renderRuntimeLine, statusSummary } from './runtime.ts';
import { appendJsonl, quoteHistoryPath, readJsonl, readWatchlist, redact, snapshotPath, utcNow, writeWatchlist } from './storage.ts';
import { accountSummary, authStatus, orderPreview, portfolioPositions, version } from './toss.ts';
import { chatBox, inputHintBox, interactivePrompt } from './ui/chat.ts';
import { table } from './ui/table.ts';
import { SOURCES, discoverMarket, searchSymbolsLive, sourceById, symbolInfo, type DiscoverResult, type SourceInfo, type SymbolInfo, type SymbolSearchResult } from './discovery.ts';
import { formatNaturalPlan, planNatural } from './natural.ts';
import { nextRecommendation } from './next.ts';
import { periodToDateRange } from './period.ts';
import { marketStats } from './marketAnalysis.ts';
import { formatResearchReport, runResearch, type ResearchCodexResult } from './research.ts';

export { periodToDateRange } from './period.ts';

const APP = 'TossQuant';
const VERSION = '0.1.0';
const GREEN = '\u001b[92m';
const CYAN = '\u001b[96m';
const YELLOW = '\u001b[93m';
const RESET = '\u001b[0m';
let INTERACTIVE_CHAT_UI = false;

export const ROOT_COMPLETIONS = ['start', 'next', 'find', 'download', 'analyze', 'research', 'idea', 'list', 'doctor', 'collect', 'data', 'discover', 'sources', 'symbol', 'stats', 'audit', 'quote', 'history', 'classify', 'portfolio', 'order', 'brief', 'runtime', 'hud', 'tmux', 'setup'];
export const SLASH_COMPLETIONS = ['/start', '/next', '/find', '/download', '/analyze', '/research', '/idea', '/list', '/help', '/status', '/collect', '/data', '/discover', '/sources', '/symbol', '/stats', '/audit', '/quote', '/history', '/classify', '/portfolio', '/order', '/brief', '/watchlist', '/hud', '/runtime', '/ask', '/codex', '/quant', '/exit'];
const DISCOVER_CATEGORIES = ['trending', 'most-active', 'gainers', 'losers', 'etf', 'semiconductor'];
const DISCOVER_OPTIONS = ['--source', '--limit', '--download', '--period', '--start', '--end'];

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

export function completionCandidates(line: string, mode = 'quant'): string[] {
  const trimmed = line.trimStart();
  if (mode === 'codex') return SLASH_COMPLETIONS;
  if (!trimmed) return [...ROOT_COMPLETIONS, ...SLASH_COMPLETIONS].sort();
  const baseParts = trimmed.trimEnd().split(/\s+/).filter(Boolean);
  const parts = trimmed.endsWith(' ') ? [...baseParts, ''] : baseParts;
  if (parts.length <= 1) return [...ROOT_COMPLETIONS, ...SLASH_COMPLETIONS].sort();
  const first = parts[0];
  const command = first?.startsWith('/') ? first.slice(1) : first;
  if (command === 'watchlist') return ['add', 'fetch', 'list', 'remove'];
  if (command === 'hud') return first?.startsWith('/') ? ['tmux'] : ['--tmux', '--watch'];
  if (command === 'runtime') return ['line', 'snapshot'];
  if (command === 'collect') {
    if (parts[1] === 'plan') return parts.length <= 3 ? ['--watchlist'] : [];
    return parts.length <= 2 ? ['plan', 'quote', 'watchlist'] : [];
  }
  if (command === 'idea') {
    if (parts.length <= 2) return ['new', 'list', 'show', 'add-symbol', 'add-hypothesis', 'status'];
    return [];
  }
  if (command === 'data') {
    if (parts.length <= 2) return ['download', 'watchlist', 'list', 'info', 'validate', 'refresh'];
    if ((parts.at(-1) ?? '') === '' && parts.at(-2) === '--source') return ['yahoo', 'stooq'];
    if (parts[1] === 'download') return ['--period', '--start', '--end', '--interval', '--source', '--provider-symbol'];
    if (parts[1] === 'refresh') return ['--period', '--start', '--end', '--interval', '--source', '--provider-symbol'];
    if (parts[1] === 'info') return ['--json', '--source', '--interval'];
    if (parts[1] === 'validate') return ['--json', '--max-stale-days'];
    if (parts[1] === 'watchlist') {
      if (parts.length <= 3) return ['refresh', '--period', '--start', '--end', '--interval', '--source'];
      if (parts[2] === 'refresh') return ['--period', '--start', '--end', '--interval', '--source'];
      return ['--period', '--start', '--end', '--interval', '--source'];
    }
    return [];
  }
  if (command === 'find') {
    if (parts.length <= 2) return ['trending', 'most-active', 'gainers', 'losers'];
    if ((parts.at(-1) ?? '') === '' && parts.at(-2) === '--limit') return ['10', '25', '50', '100'];
    return ['--limit'];
  }
  if (command === 'download') return parts.length >= 3 && trimmed.endsWith(' ') ? ['--period', '--start', '--end'] : [];
  if (command === 'analyze') return [];
  if (command === 'research') {
    if (parts.length <= 2) return ['AAPL', 'NVDA', 'TSM', 'SPY'];
    return trimmed.endsWith(' ') ? ['--topic', '--source', '--interval', '--provider-symbol', '--no-save', '--no-codex'] : [];
  }
  if (command === 'list') return [];
  if (command === 'audit') return [];
  if (command === 'discover') {
    return discoverCompletionCandidates(parts);
  }
  if (command === 'sources') return parts.length <= 2 ? ['list', 'stooq', 'tossctl', 'yahoo', 'nasdaq', 'vendor'] : [];
  if (command === 'symbol') {
    if (parts.length <= 2) return ['search', 'info'];
    if (parts[1] === 'search') {
      if ((parts.at(-1) ?? '') === '' && parts.at(-2) === '--source') return ['local', 'yahoo'];
      if ((parts.at(-1) ?? '') === '' && parts.at(-2) === '--limit') return ['5', '10', '25', '50'];
      return ['--source', '--limit'];
    }
    return [];
  }
  if (command === 'stats') return [];
  if (command === 'quote') return parts.length <= 2 ? ['fetch', 'history'] : [];
  if (command === 'portfolio') return parts.length <= 2 ? ['snapshot'] : [];
  if (command === 'order') return parts.length <= 2 ? ['preview'] : [];
  if (command === 'tmux') return parts[1] === 'start' ? (parts.length <= 3 ? ['--session', '--height', '--interval'] : []) : ['start'];
  if (command === 'setup') return ['bin'];
  return [];
}

export function completeLine(line: string, mode = 'quant'): [string[], string] {
  const token = line.endsWith(' ') ? '' : (line.split(/\s+/).at(-1) ?? '');
  const candidates = completionCandidates(line, mode);
  const matches = candidates.filter((candidate) => candidate.startsWith(token));
  return [matches.length ? matches : candidates, token];
}

function emitChat(text: string) {
  console.log(chatBox(text.split(/\r?\n/)));
}
function ok(text: string) {
  if (INTERACTIVE_CHAT_UI) { emitChat(text); return; }
  console.log(`  ${GREEN}ok${RESET}    ${text}`);
}
function warn(text: string) {
  if (INTERACTIVE_CHAT_UI) { emitChat(text); return; }
  console.log(`  ${YELLOW}warn${RESET}  ${text}`);
}
function printJson(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  if (INTERACTIVE_CHAT_UI) { emitChat(text); return; }
  console.log(text);
}

function printText(text: string) {
  if (INTERACTIVE_CHAT_UI) { emitChat(text); return; }
  console.log(text);
}

function expandDataArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const item = args[i]!;
    if (item === '--json') continue;
    if (item === '--period') {
      const period = args[++i];
      if (!period) throw new Error('--period requires a value such as 1y, 6mo, 30d, ytd, or max');
      if (['max', 'all', 'full'].includes(period.trim().toLowerCase())) continue;
      const range = periodToDateRange(period);
      out.push('--start', range.start, '--end', range.end);
      continue;
    }
    out.push(item);
  }
  return out;
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
      `next  /${result.next_command ?? `stats ${result.ticker ?? result.symbol}`}`,
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
    `next  /stats ${result.ticker ?? result.symbol}`,
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
  if (!datasets.length) return '저장된 market dataset이 없습니다.\nnext  /data download AAPL --period 1y';
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
  if (!datasets.length) return `저장된 market dataset이 없습니다.\nnext  /${result?.next_command ?? 'data download AAPL --period 1y'}`;
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
    result.next_command ? `\nnext  /${result.next_command}` : '',
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

function takeOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, value === undefined ? 1 : 2);
  return value;
}
function dataDirFrom(argv: string[]): { dataDir: string; rest: string[]; noTmux: boolean } {
  const rest: string[] = [];
  let dataDir = 'data';
  let noTmux = false;
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]!;
    if (item === '--data-dir') { dataDir = argv[++i] ?? dataDir; continue; }
    if (item === '--no-tmux') { noTmux = true; continue; }
    rest.push(item);
  }
  return { dataDir, rest, noTmux };
}

function optionValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function optionNumber(args: string[], flag: string, fallback: number): number {
  const value = optionValue(args, flag);
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function takeNumberOption(args: string[], flag: string): number | undefined {
  const value = takeOption(args, flag);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} requires a number`);
  return parsed;
}

function parseJsonOrRaw(stdout: string, stderr: string, returncode: number): unknown {
  try { return JSON.parse(stdout); } catch { return { raw: stdout, stderr, returncode }; }
}

function commandDoctor(dataDir: string): number {
  const ver = version();
  const auth = authStatus();
  printJson({
    app: APP,
    version: VERSION,
    data_dir: dataDir,
    trading_mutations: 'disabled',
    tossctl_version_ok: ver.ok,
    tossctl_version: (ver.stdout || ver.stderr).trim(),
    auth_status_ok: auth.ok,
    auth_status: (auth.stdout || auth.stderr).trim(),
    tmux_path: tmuxPath(),
    tmux_available: Boolean(tmuxPath()),
    tmux_install_hint: tmuxPath() ? 'ok' : tmuxInstallHint(),
  });
  return ver.ok ? 0 : 1;
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

function formatReadiness(item: IdeaReadiness): string[] {
  return [item.symbol, item.market_data, item.validation, item.research, item.next_commands.map((cmd) => `/${cmd}`).join(' | ')];
}

function formatIdeaStatus(result: ReturnType<typeof ideaStatus>): string {
  const idea = result.idea;
  const next = result.next_commands.map((cmd, index) => `${index + 1}. /${cmd}`);
  return [
    formatIdea(idea),
    '',
    'Evidence readiness:',
    result.readiness.length ? table(['symbol', 'market', 'validation', 'research', 'next'], result.readiness.map(formatReadiness)) : '- no symbols yet',
    '',
    'Next commands:',
    ...(next.length ? next : [`1. /idea add-symbol ${idea.id} AAPL`]),
  ].join('\n');
}

function commandIdea(dataDir: string, action = 'list', tail: string[] = []): number {
  try {
    if (action === 'new') {
      const title = tail.join(' ');
      const idea = createIdea(dataDir, title);
      const suggestedSymbol = title.match(/\b[A-Z][A-Z0-9.-]{1,9}\b/)?.[0] ?? 'AAPL';
      printText([
        `created idea ${idea.id}`,
        `title: ${idea.title}`,
        `saved_to: ${ideaPath(dataDir, idea.id)}`,
        `next  /idea add-symbol ${idea.id} ${suggestedSymbol}`,
      ].join('\n'));
      return 0;
    }
    if (action === 'list') {
      const ideas = listIdeas(dataDir);
      printText(ideas.length ? table(['id', 'status', 'symbols', 'hypotheses', 'title'], ideas.map(ideaSummaryRow)) : '저장된 idea가 없습니다.\nnext  /idea new "NVDA earnings momentum"');
      return 0;
    }
    if (action === 'show') {
      const id = tail[0];
      if (!id) { warn('usage: idea show <ID>'); return 2; }
      printText(formatIdea(readIdea(dataDir, id)));
      return 0;
    }
    if (action === 'add-symbol') {
      const [id, symbol] = tail;
      if (!id || !symbol) { warn('usage: idea add-symbol <ID> <SYMBOL>'); return 2; }
      const idea = addIdeaSymbol(dataDir, id, symbol);
      printText([
        `updated idea ${idea.id}`,
        `symbols: ${idea.symbols.join(', ') || '-'}`,
        `next  /idea status ${idea.id}`,
      ].join('\n'));
      return 0;
    }
    if (action === 'add-hypothesis') {
      const id = tail[0];
      const hypothesis = tail.slice(1).join(' ');
      if (!id || !hypothesis) { warn('usage: idea add-hypothesis <ID> <TEXT>'); return 2; }
      const idea = addIdeaHypothesis(dataDir, id, hypothesis);
      printText([
        `updated idea ${idea.id}`,
        `hypotheses: ${idea.hypotheses.length}`,
        `next  /idea status ${idea.id}`,
      ].join('\n'));
      return 0;
    }
    if (action === 'status') {
      const id = tail[0];
      if (!id) { warn('usage: idea status <ID>'); return 2; }
      printText(formatIdeaStatus(ideaStatus(dataDir, id)));
      return 0;
    }
  } catch (error) {
    printJson({ ok: false, action, error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
  warn('usage: idea [new <TITLE>|list|show <ID>|add-symbol <ID> <SYMBOL>|add-hypothesis <ID> <TEXT>|status <ID>]');
  return 2;
}

function dataOptionsFromTail(tail: string[]): { json: boolean; request: Omit<DownloadRequest, 'symbol'>; rest: string[] } {
  const rest = [...tail];
  const json = rest.includes('--json');
  for (let i = rest.length - 1; i >= 0; i -= 1) if (rest[i] === '--json') rest.splice(i, 1);
  const expanded = expandDataArgs(rest);
  const source = takeOption(expanded, '--source');
  const interval = takeOption(expanded, '--interval');
  const start = takeOption(expanded, '--start');
  const end = takeOption(expanded, '--end');
  const providerSymbol = takeOption(expanded, '--provider-symbol');
  return { json, request: { source: source || 'yahoo', interval, start, end, providerSymbol }, rest: expanded };
}

function commandResearch(dataDir: string, symbol?: string, tail: string[] = []): number {
  if (!symbol) { warn('usage: research <SYMBOL> [--topic <TEXT>] [--source yahoo|stooq] [--provider-symbol <ID>]'); return 2; }
  try {
    const rest = [...tail];
    const noSave = rest.includes('--no-save');
    const noCodex = rest.includes('--no-codex') || process.env.TOSSQUANT_RESEARCH_NO_CODEX === '1';
    for (let i = rest.length - 1; i >= 0; i -= 1) if (rest[i] === '--no-save') rest.splice(i, 1);
    for (let i = rest.length - 1; i >= 0; i -= 1) if (rest[i] === '--no-codex') rest.splice(i, 1);
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
    }, noCodex ? undefined : runCodexPromptText);
    printText(formatResearchReport(result));
    return result.missing_data ? 1 : 0;
  } catch (error) {
    printJson({ ok: false, symbol: symbol.toUpperCase(), error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}

function commandStats(dataDir: string, symbol?: string, tail: string[] = []): number {
  if (!symbol) { warn('usage: stats <SYMBOL>'); return 2; }
  try {
    const { request } = dataOptionsFromTail(tail);
    const result = marketStats(symbol, { base: dataDir, source: request.source, interval: request.interval, providerSymbol: request.providerSymbol });
    printJson(result);
    return result.ok ? 0 : 1;
  } catch (error) {
    printJson({ ok: false, symbol: symbol.toUpperCase(), error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
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
      const result = validateData(dataDir, symbol, { maxStaleDays });
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

function commandStart(): number {
  printText([
    'Start here — 초보자용 5단계',
    '',
    table(
      ['step', 'command', 'why'],
      [
        ['1', '/find', '실시간 후보 10개 찾기'],
        ['2', '/symbol info NVDA', '고른 심볼이 뭔지 확인'],
        ['3', '/download NVDA', '1년치 일봉 데이터 저장'],
        ['4', '/analyze NVDA', '수익률/변동성/추세 확인'],
        ['5', '/next', '현재 상태에서 다음 행동 추천'],
      ],
    ),
    '',
    '기본 흐름: /find → /download <SYMBOL> → /analyze <SYMBOL> → /next',
    '고급 명령: /idea, /discover, /data download, /stats, /sources, /runtime',
  ].join('\n'));
  return 0;
}

function commandNext(dataDir: string): number {
  printText(nextRecommendation(dataDir));
  return 0;
}

type DiscoverCommandOptions = {
  category: string;
  source: 'local' | 'yahoo' | 'live';
  limit: number;
  download: boolean;
  dataArgs: string[];
};

function parseDiscoverArgs(parts: string[]): DiscoverCommandOptions {
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

function findAliasArgs(sub?: string, tail: string[] = []): string[] {
  const category = sub && !sub.startsWith('--') ? sub : 'most-active';
  const rest = sub && sub.startsWith('--') ? [sub, ...tail] : tail;
  const hasSource = rest.includes('--source');
  const hasLimit = rest.includes('--limit');
  return [
    category,
    ...(hasSource ? [] : ['--source', 'yahoo']),
    ...(hasLimit ? [] : ['--limit', '10']),
    ...rest,
  ];
}

function downloadAliasArgs(symbol?: string, tail: string[] = []): string[] {
  if (!symbol) return [];
  const hasRange = tail.includes('--period') || tail.includes('--start') || tail.includes('--end');
  return [symbol, ...(hasRange ? [] : ['--period', '1y']), ...tail];
}

function parseSymbolSearchArgs(query: string): { query: string; source: 'local' | 'yahoo' | 'live'; limit: number } {
  const parts = query.split(/\s+/).filter(Boolean);
  const source = (takeOption(parts, '--source') ?? 'yahoo').toLowerCase();
  const limit = Number(takeOption(parts, '--limit') ?? 10);
  return {
    query: parts.join(' '),
    source: source === 'local' || source === 'live' ? source : 'yahoo',
    limit: Number.isFinite(limit) ? limit : 10,
  };
}

async function commandSymbol(dataDir: string, action = 'search', query = ''): Promise<number> {
  if (action !== 'search' && action !== 'info') {
    query = action;
    action = 'info';
  }
  if (action === 'info') {
    const item = symbolInfo(query);
    if (!item) { warn(`unknown symbol: ${query}`); return 1; }
    printText([
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
  const options = parseSymbolSearchArgs(query);
  const result = await searchSymbolsLive({
    query: options.query,
    source: options.source,
    limit: options.limit,
    dataDir,
  });
  printText(formatSymbolSearchResult(result));
  return 0;
}

function commandQuoteHistory(dataDir: string, ticker?: string): number {
  if (!ticker) { warn('usage: quote history <TICKER>'); return 2; }
  const records = readJsonl(quoteHistoryPath(ticker, dataDir));
  printJson({ ticker: ticker.toUpperCase(), samples: records.length, history: historyRows(records) });
  return 0;
}

function commandClassify(dataDir: string, ticker?: string): number {
  if (!ticker) { warn('usage: classify <TICKER>'); return 2; }
  const records = readJsonl(quoteHistoryPath(ticker, dataDir));
  printJson({ ticker: ticker.toUpperCase(), ...classify(records) });
  return 0;
}

function commandPortfolioSnapshot(dataDir: string): number {
  const summary = accountSummary();
  const positions = portfolioPositions();
  const payload = {
    account_summary: redact(parseJsonOrRaw(summary.stdout, summary.stderr, summary.returncode) as never),
    positions: redact(parseJsonOrRaw(positions.stdout, positions.stderr, positions.returncode) as never),
    errors: [summary.ok ? null : summary.stderr || summary.stdout, positions.ok ? null : positions.stderr || positions.stdout].filter(Boolean),
  };
  const record = { fetched_at: utcNow(), source: 'tossctl account/portfolio', payload };
  const path = snapshotPath('portfolio', dataDir);
  appendJsonl(path, record as never);
  printJson({ ok: summary.ok && positions.ok, saved_to: path, fetched_at: record.fetched_at, errors: payload.errors });
  return summary.ok && positions.ok ? 0 : 1;
}

function commandOrderPreview(args: string[]): number {
  const result = orderPreview(args);
  if (result.ok) {
    const text = result.stdout.trim();
    if (INTERACTIVE_CHAT_UI) emitChat(text);
    else console.log(text);
    return 0;
  }
  printJson({ ok: false, command: result.command, error: result.stderr || result.stdout });
  return result.returncode || 1;
}

function runCodexPromptText(prompt: string): ResearchCodexResult {
  if (!prompt.trim()) return { ok: false, error: 'empty prompt', returncode: 2 };
  const hasCodex = spawnSync('sh', ['-lc', 'command -v codex'], { encoding: 'utf8' });
  if (hasCodex.status !== 0) return { ok: false, error: 'codex CLI not found in PATH', returncode: 127 };
  const codex = hasCodex.stdout.trim();
  const result = spawnSync(codex, ['exec', '--sandbox', 'read-only', '--cd', process.cwd(), prompt], { encoding: 'utf8' });
  const text = filteredCodexOutput(result.stdout ?? '', result.stderr ?? '');
  const code = result.status ?? 1;
  return code === 0 ? { ok: true, text, returncode: code } : { ok: false, text, error: text || result.stderr || result.stdout || `codex exited ${code}`, returncode: code };
}

function runCodexPrompt(prompt: string): number {
  if (!prompt.trim()) { warn('usage: /ask <QUESTION>'); return 2; }
  const result = runCodexPromptText(prompt);
  if (result.error === 'codex CLI not found in PATH') { warn(result.error); return 127; }
  if (result.text) {
    if (INTERACTIVE_CHAT_UI) emitChat(result.text);
    else console.log(result.text);
  }
  return result.returncode ?? (result.ok ? 0 : 1);
}

function launchRustTui(dataDir: string): number | null {
  const cargo = spawnSync('sh', ['-lc', 'command -v cargo'], { encoding: 'utf8' });
  if (cargo.status !== 0 || !cargo.stdout.trim()) return null;
  const manifest = new URL('../tui/Cargo.toml', import.meta.url).pathname;
  const entry = new URL('./cli.ts', import.meta.url).pathname;
  const result = spawnSync(cargo.stdout.trim(), [
    'run',
    '--quiet',
    '--manifest-path',
    manifest,
    '--',
    '--entry',
    entry,
    '--data-dir',
    dataDir,
    '--node',
    process.execPath,
  ], { encoding: 'utf8', stdio: 'inherit' });
  return result.status ?? 1;
}

function printStatus(dataDir: string) {
  const summary = statusSummary(dataDir);
  printJson(summary);
}

function handleWatchlist(parts: string[], dataDir: string): number {
  const action = parts[1] ?? 'list';
  const tickers = readWatchlist(dataDir);
  if (action === 'list') { printJson({ watchlist: tickers }); return 0; }
  if (action === 'add' && parts[2]) { writeWatchlist([...tickers, parts[2]], dataDir); ok(`${parts[2].toUpperCase()} added to watchlist`); return 0; }
  if ((action === 'remove' || action === 'rm') && parts[2]) { writeWatchlist(tickers.filter((item) => item !== parts[2]!.toUpperCase()), dataDir); ok(`${parts[2].toUpperCase()} removed from watchlist`); return 0; }
  if (action === 'fetch') { let code = 0; for (const ticker of tickers) code = commandQuoteFetch(dataDir, ticker) || code; return code; }
  warn('usage: /watchlist [list|add <TICKER>|remove <TICKER>|fetch]');
  return 2;
}

function runtimeLine(dataDir: string, mode = 'quant', lastAction = 'line'): string {
  return renderRuntimeLine(recordRuntime({ base: dataDir, mode, lastAction }));
}

export function welcomeCard(): string {
  return [
    `${CYAN}${APP}${RESET} ${VERSION} · TypeScript runtime · trading mutations disabled`,
    '',
    'project     TossQuant-cli — terminal-first quant runtime around tossctl',
    'runtime     TypeScript / Node 24+ / tmux HUD when available',
    'safety      read-only data by default · no real order mutation',
    '',
    'beginner    /start · /next · /idea · /find · /download <SYMBOL> · /analyze <SYMBOL> · /research <SYMBOL> · /list',
    'flow        /idea new "NVDA momentum"  →  /idea add-symbol <ID> NVDA  →  /download NVDA  →  /analyze NVDA',
    'advanced    /discover · /data info · /data refresh <SYMBOL> · /stats <SYMBOL> · /sources',
    'codex       /ask <question> · /codex · /quant · /exit',
    'plain mode  quant --no-tmux',
    '',
  ].join('\n');
}

async function runInteractive(dataDir: string): Promise<number> {
  if (input.isTTY && output.isTTY) {
    const code = launchRustTui(dataDir);
    if (code !== null) return code;
  }
  let mode = 'quant';
  let lastAction = 'ready';
  INTERACTIVE_CHAT_UI = true;
  console.log(inputHintBox(mode));
  const handleLine = async (rawLine: string): Promise<boolean> => {
    output.write(RESET);
    const line = rawLine.trim();
    if (!line) return false;
    if (line === '/exit') {
      shutdownManagedTmuxRuntime();
      return true;
    }
    if (['exit', '/quit', 'quit', '/:q', ':q'].includes(line)) {
      warn('Use /exit to close TossQuant and its managed tmux session.');
      lastAction = 'exit-help';
      return false;
    }
    const parts = line.split(/\s+/);
    if (line === '/codex') { mode = 'codex'; lastAction = '/codex'; console.log(inputHintBox(mode)); return false; }
    if (line === '/quant') { mode = 'quant'; lastAction = '/quant'; console.log(inputHintBox(mode)); return false; }
    if (line === '/start') { commandStart(); lastAction = '/start'; return false; }
    if (line === '/next') { commandNext(dataDir); lastAction = '/next'; return false; }
    if (line === '/status') { printStatus(dataDir); lastAction = '/status'; return false; }
    if (line.startsWith('/watchlist')) { handleWatchlist(parts, dataDir); lastAction = '/watchlist'; return false; }
    if (line === '/hud') { emitChat(runtimeLine(dataDir, mode, lastAction)); lastAction = '/hud'; return false; }
    if (line === '/hud tmux') { const r = launchTmuxHud(dataDir); r.code === 0 ? ok(r.message) : warn(r.message); lastAction = '/hud'; return false; }
    if (line.startsWith('/runtime')) { emitChat(runtimeLine(dataDir, mode, '/runtime')); lastAction = '/runtime'; return false; }
    if (line.startsWith('/ask ')) { runCodexPrompt(line.slice(5)); lastAction = '/ask'; return false; }
    if (line.startsWith('/research ')) { await runOnce(['--data-dir', dataDir, ...line.slice(1).split(/\s+/)], { quietUnknown: true }); lastAction = '/research'; return false; }
    if (mode === 'codex') { runCodexPrompt(line); lastAction = 'codex'; return false; }
    if (!line.startsWith('/')) {
      emitChat(formatNaturalPlan(planNatural(line)));
      lastAction = 'natural-plan';
      return false;
    }
    const commandParts = line.slice(1).split(/\s+/);
    const code = await runOnce(['--data-dir', dataDir, ...commandParts], { quietUnknown: true });
    lastAction = commandParts.slice(0, 2).join(' ');
    if (code === 2) warn('unknown slash command: try /start, /find, /download NVDA, /analyze NVDA, /next, or /exit');
    return false;
  };
  const rl = createInterface({ input, output, completer: (line: string) => completeLine(line, mode) });
  if (!input.isTTY) {
    for await (const line of rl) {
      recordRuntime({ base: dataDir, mode, lastAction });
      if (await handleLine(line)) break;
    }
    output.write(RESET);
    rl.close();
    return 0;
  }
  const lines = rl[Symbol.asyncIterator]();
  for (;;) {
    recordRuntime({ base: dataDir, mode, lastAction });
    rl.setPrompt(interactivePrompt(mode));
    rl.prompt();
    const answer = await lines.next();
    if (answer.done) { output.write(RESET); rl.close(); return 0; }
    if (await handleLine(answer.value)) {
      rl.close();
      return 0;
    }
  }
}

export async function runOnce(argv: string[], opts: { quietUnknown?: boolean } = {}): Promise<number> {
  const { dataDir, rest } = dataDirFrom(argv);
  const [cmd, sub, ...tail] = rest;
  if (!cmd) return 2;
  if (cmd === 'start') return commandStart();
  if (cmd === 'next') return commandNext(dataDir);
  if (cmd === 'find' && sub && !sub.startsWith('--') && !DISCOVER_CATEGORIES.includes(sub)) {
    return commandSymbol(dataDir, 'search', [sub, ...tail].join(' '));
  }
  if (cmd === 'find') return commandDiscover(dataDir, findAliasArgs(sub, tail));
  if (cmd === 'download') return commandData(dataDir, 'download', downloadAliasArgs(sub, tail));
  if (cmd === 'analyze') return commandStats(dataDir, sub, tail);
  if (cmd === 'research') return commandResearch(dataDir, sub, tail);
  if (cmd === 'idea') return commandIdea(dataDir, sub ?? 'list', tail);
  if (cmd === 'list') return commandData(dataDir, 'list', tail);
  if (cmd === 'status') { printStatus(dataDir); return 0; }
  if (cmd === 'doctor') return commandDoctor(dataDir);
  if (cmd === 'collect') return commandCollect(dataDir, sub, tail);
  if (cmd === 'data') return commandData(dataDir, sub, tail);
  if (cmd === 'sources') return commandSources(sub ?? 'list');
  if (cmd === 'discover') return commandDiscover(dataDir, [sub, ...tail].filter(Boolean));
  if (cmd === 'symbol') return commandSymbol(dataDir, sub ?? 'search', tail.join(' '));
  if (cmd === 'stats') return commandStats(dataDir, sub, tail);
  if (cmd === 'audit') return commandAudit(dataDir, sub);
  if (cmd === 'quote' && sub === 'fetch') return commandQuoteFetch(dataDir, tail[0]);
  if (cmd === 'quote' && sub === 'history') return commandQuoteHistory(dataDir, tail[0]);
  if (cmd === 'quote' && sub) return commandQuoteFetch(dataDir, sub);
  if (cmd === 'history') return commandQuoteHistory(dataDir, sub);
  if (cmd === 'classify') return commandClassify(dataDir, sub);
  if (cmd === 'portfolio' && (sub === 'snapshot' || !sub)) return commandPortfolioSnapshot(dataDir);
  if (cmd === 'order' && sub === 'preview') return commandOrderPreview(tail);
  if (cmd === 'watchlist') return handleWatchlist(['watchlist', sub ?? 'list', ...tail], dataDir);
  if (cmd === 'ask') return runCodexPrompt([sub, ...tail].filter(Boolean).join(' '));
  if (cmd === 'runtime' && sub === 'snapshot') { printJson(recordRuntime({ base: dataDir, lastAction: 'snapshot' })); return 0; }
  if (cmd === 'runtime' && sub === 'line') { console.log(runtimeLine(dataDir)); return 0; }
  if (cmd === 'hud' && rest.includes('--watch')) { void watchHud(dataDir, Number(rest[rest.indexOf('--interval') + 1] ?? 1)); return 0; }
  if (cmd === 'hud' && rest.includes('--tmux')) { const r = launchTmuxHud(dataDir); r.code === 0 ? ok(r.message) : warn(r.message); return r.code; }
  if (cmd === 'hud') { printHudOnce(dataDir); return 0; }
  if (cmd === 'tmux' && sub === 'start') {
    const session = optionValue(tail, '--session') || defaultTmuxSession();
    const height = optionNumber(tail, '--height', 3);
    const interval = optionNumber(tail, '--interval', 1);
    const r = launchTmuxRuntime(dataDir, session, height, interval);
    r.code === 0 ? ok(r.message) : warn(r.message);
    return r.code;
  }
  if (cmd === 'setup' && sub === 'bin') {
    try {
      const dirFlag = tail.indexOf('--dir');
      const dir = dirFlag >= 0 ? tail[dirFlag + 1] : undefined;
      const result = installLocalBins({ dir, force: tail.includes('--force') });
      printJson(result);
      if (INTERACTIVE_CHAT_UI) emitChat(pathHint(dir));
      else console.log(pathHint(dir));
      return 0;
    } catch (error) {
      warn(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (cmd === 'brief') return runCodexPrompt('Create a concise TossQuant session brief from local redacted data. Do not give buy/sell/hold advice.');
  if (!opts.quietUnknown) warn(`unknown command: ${cmd}`);
  return 2;
}

export function shouldAutoStartTmux(noTmux: boolean): boolean {
  return !noTmux && !process.env.TOSSQUANT_NO_TMUX && !process.env.TMUX && input.isTTY && output.isTTY && Boolean(tmuxPath());
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { dataDir, rest, noTmux } = dataDirFrom(argv);
  if (rest.length === 0) {
    if (shouldAutoStartTmux(noTmux)) {
      const r = launchTmuxRuntime(dataDir, defaultTmuxSession());
      if (r.code !== 127) return r.code;
      warn(r.message);
    }
    return runInteractive(dataDir);
  }
  return runOnce(argv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main();
  process.exitCode = code;
}
