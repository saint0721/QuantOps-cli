#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { classify, historyRows } from './analysis.ts';
import { collectionPlan, collectionSummary, collectQuote, runCollectionPlan } from './collect.ts';
import { filteredCodexOutput } from './codex.ts';
import { defaultTmuxSession, launchTmuxHud, launchTmuxRuntime, printHudOnce, shutdownManagedTmuxRuntime, tmuxInstallHint, tmuxPath, watchHud } from './hud.ts';
import { installLocalBins, pathHint } from './setup.ts';
import { recordRuntime, renderRuntimeLine, statusSummary } from './runtime.ts';
import { appendJsonl, quoteHistoryPath, readJsonl, readWatchlist, redact, snapshotPath, utcNow, writeWatchlist } from './storage.ts';
import { accountSummary, authStatus, orderPreview, portfolioPositions, version } from './toss.ts';
import { chatBox, inputHintBox, interactivePrompt } from './ui/chat.ts';
import { SOURCES, discover, searchSymbols, sourceById, symbolInfo, type SourceInfo, type SymbolInfo } from './discovery.ts';

const APP = 'TossQuant';
const VERSION = '0.1.0';
const GREEN = '\u001b[92m';
const CYAN = '\u001b[96m';
const YELLOW = '\u001b[93m';
const RESET = '\u001b[0m';
let INTERACTIVE_CHAT_UI = false;

export const ROOT_COMPLETIONS = ['doctor', 'collect', 'data', 'discover', 'sources', 'symbol', 'stats', 'quote', 'history', 'classify', 'portfolio', 'order', 'brief', 'runtime', 'hud', 'tmux', 'setup'];
export const SLASH_COMPLETIONS = ['/help', '/status', '/collect', '/data', '/discover', '/sources', '/symbol', '/stats', '/quote', '/history', '/classify', '/portfolio', '/order', '/brief', '/watchlist', '/hud', '/runtime', '/ask', '/codex', '/quant', '/exit'];

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
  if (command === 'data') {
    if (parts.length <= 2) return ['download', 'watchlist', 'list'];
    if (parts[1] === 'download') return ['--period', '--start', '--end', '--interval', '--source', '--provider-symbol'];
    if (parts[1] === 'watchlist') return ['--period', '--start', '--end', '--interval', '--source'];
    return [];
  }
  if (command === 'discover') return parts.length <= 2 ? ['trending', 'most-active', 'gainers', 'losers', 'etf', 'semiconductor'] : [];
  if (command === 'sources') return parts.length <= 2 ? ['list', 'stooq', 'tossctl', 'yahoo', 'nasdaq', 'vendor'] : [];
  if (command === 'symbol') return parts.length <= 2 ? ['search', 'info'] : [];
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

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)));
  const line = (cols: string[]) => cols.map((col, index) => col.padEnd(widths[index] ?? col.length)).join('  ').trimEnd();
  return [line(headers), line(headers.map((header, index) => '-'.repeat(Math.max(3, widths[index] ?? header.length)))), ...rows.map(line)].join('\n');
}

function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function periodToDateRange(period: string, now = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  const normalized = period.trim().toLowerCase();
  if (normalized === 'ytd') {
    start.setUTCMonth(0, 1);
  } else {
    const match = normalized.match(/^(\d+)(d|w|mo|m|y)$/);
    if (!match) throw new Error(`unsupported period: ${period}`);
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit === 'd') start.setUTCDate(start.getUTCDate() - amount);
    if (unit === 'w') start.setUTCDate(start.getUTCDate() - amount * 7);
    if (unit === 'mo' || unit === 'm') start.setUTCMonth(start.getUTCMonth() - amount);
    if (unit === 'y') start.setUTCFullYear(start.getUTCFullYear() - amount);
  }
  return { start: dateString(start), end: dateString(end) };
}

function expandDataArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const item = args[i]!;
    if (item === '--json') continue;
    if (item === '--period') {
      const period = args[++i];
      if (!period) throw new Error('--period requires a value such as 1y, 6mo, 30d, or ytd');
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

function formatDownloadResult(result: any): string {
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
    result.ok ? '✅ watchlist 다운로드 완료' : '⚠️ watchlist 다운로드 일부 실패',
    '',
    table(['symbol', 'status', 'source', 'provider', 'rows', 'new', 'detail'], rows),
    '',
    `downloaded ${result.downloaded ?? 0}, failed ${result.failed ?? 0}`,
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

function formatDataOutput(sub: string, stdout: string): string {
  let parsed: any;
  try { parsed = JSON.parse(stdout); } catch { return stdout; }
  if (sub === 'download') return formatDownloadResult(parsed);
  if (sub === 'watchlist') return formatWatchlistDownloadResult(parsed);
  if (sub === 'list') return formatDataList(parsed);
  return stdout;
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

function commandPythonStats(dataDir: string, symbol?: string, tail: string[] = []): number {
  if (!symbol) { warn('usage: stats <SYMBOL>'); return 2; }
  const command = ['-m', 'tossquant_cli.cli', '--data-dir', dataDir, 'stats', symbol, ...tail];
  const result = spawnSync('python3', command, { encoding: 'utf8', cwd: process.cwd() });
  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();
  if (stdout) {
    if (INTERACTIVE_CHAT_UI) emitChat(stdout);
    else console.log(stdout);
  }
  if (stderr) warn(stderr);
  if (result.error) warn(result.error.message);
  return result.status ?? (result.error ? 127 : 1);
}

function commandPythonData(dataDir: string, sub?: string, tail: string[] = []): number {
  if (!sub) { warn('usage: data [download <SYMBOL>|watchlist|list]'); return 2; }
  const json = tail.includes('--json');
  let expandedTail: string[];
  try {
    expandedTail = expandDataArgs(tail);
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const command = ['-m', 'tossquant_cli.cli', '--data-dir', dataDir, 'data', sub, ...expandedTail];
  const result = spawnSync('python3', command, { encoding: 'utf8', cwd: process.cwd() });
  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();
  if (stdout) {
    const text = json ? stdout : formatDataOutput(sub, stdout);
    if (INTERACTIVE_CHAT_UI) emitChat(text);
    else console.log(text);
  }
  if (stderr) warn(stderr);
  if (result.error) warn(result.error.message);
  return result.status ?? (result.error ? 127 : 1);
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

function commandDiscover(parts: string[]): number {
  const category = parts.join(' ') || 'trending';
  const result = discover(category);
  printText([
    `Discover: ${result.category}`,
    result.note,
    '',
    table(['symbol', 'type', 'category', 'source', 'next'], result.items.map(formatSymbol)),
  ].join('\n'));
  return 0;
}

function commandSymbol(action = 'search', query = ''): number {
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
  const results = searchSymbols(query);
  printText([
    `Symbol search: ${query || 'all'}`,
    '',
    table(['symbol', 'type', 'category', 'source', 'next'], results.map(formatSymbol)),
  ].join('\n'));
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

function runCodexPrompt(prompt: string): number {
  if (!prompt.trim()) { warn('usage: /ask <QUESTION>'); return 2; }
  const hasCodex = spawnSync('sh', ['-lc', 'command -v codex'], { encoding: 'utf8' });
  if (hasCodex.status !== 0) { warn('codex CLI not found in PATH'); return 127; }
  const codex = hasCodex.stdout.trim();
  const result = spawnSync(codex, ['exec', '--sandbox', 'read-only', '--cd', process.cwd(), prompt], { encoding: 'utf8' });
  const visible = filteredCodexOutput(result.stdout ?? '', result.stderr ?? '');
  if (visible) {
    if (INTERACTIVE_CHAT_UI) emitChat(visible);
    else console.log(visible);
  }
  return result.status ?? 1;
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
    'start       /watchlist add AAPL  →  /data download AAPL  →  /stats AAPL  →  /classify AAPL',
    'discover    /sources · /discover trending · /symbol search SOX',
    'commands    /status · /collect plan|quote|watchlist · /data download --period 1y · /data list · /stats <SYMBOL> · /exit',
    'codex       /ask <question> · /codex · /quant',
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
  const rl = createInterface({ input, output, completer: (line: string) => completeLine(line, mode) });
  const lines = rl[Symbol.asyncIterator]();
  for (;;) {
    recordRuntime({ base: dataDir, mode, lastAction });
    rl.setPrompt(interactivePrompt(mode));
    rl.prompt();
    const answer = await lines.next();
    if (answer.done) { output.write(RESET); rl.close(); return 0; }
    output.write(RESET);
    const line = answer.value.trim();
    if (!line) continue;
    if (line === '/exit') {
      rl.close();
      shutdownManagedTmuxRuntime();
      return 0;
    }
    if (['exit', '/quit', 'quit', '/:q', ':q'].includes(line)) {
      warn('Use /exit to close TossQuant and its managed tmux session.');
      lastAction = 'exit-help';
      continue;
    }
    const parts = line.split(/\s+/);
    if (line === '/codex') { mode = 'codex'; lastAction = '/codex'; console.log(inputHintBox(mode)); continue; }
    if (line === '/quant') { mode = 'quant'; lastAction = '/quant'; console.log(inputHintBox(mode)); continue; }
    if (line === '/status') { printStatus(dataDir); lastAction = '/status'; continue; }
    if (line.startsWith('/watchlist')) { handleWatchlist(parts, dataDir); lastAction = '/watchlist'; continue; }
    if (line === '/hud') { emitChat(runtimeLine(dataDir, mode, lastAction)); lastAction = '/hud'; continue; }
    if (line === '/hud tmux') { const r = launchTmuxHud(dataDir); r.code === 0 ? ok(r.message) : warn(r.message); lastAction = '/hud'; continue; }
    if (line.startsWith('/runtime')) { emitChat(runtimeLine(dataDir, mode, '/runtime')); lastAction = '/runtime'; continue; }
    if (line.startsWith('/ask ')) { runCodexPrompt(line.slice(5)); lastAction = '/ask'; continue; }
    if (mode === 'codex') { runCodexPrompt(line); lastAction = 'codex'; continue; }
    if (!line.startsWith('/')) {
      warn('slash commands only: try /status, /watchlist add AAPL, /collect plan AAPL, /quote history AAPL, or /exit');
      lastAction = 'slash-required';
      continue;
    }
    const commandParts = line.slice(1).split(/\s+/);
    const code = runOnce(['--data-dir', dataDir, ...commandParts], { quietUnknown: true });
    lastAction = commandParts.slice(0, 2).join(' ');
    if (code === 2) warn('unknown slash command: try /status, /watchlist add AAPL, /collect plan AAPL, /quote history AAPL, or /exit');
  }
}

export function runOnce(argv: string[], opts: { quietUnknown?: boolean } = {}): number {
  const { dataDir, rest } = dataDirFrom(argv);
  const [cmd, sub, ...tail] = rest;
  if (!cmd) return 2;
  if (cmd === 'status') { printStatus(dataDir); return 0; }
  if (cmd === 'doctor') return commandDoctor(dataDir);
  if (cmd === 'collect') return commandCollect(dataDir, sub, tail);
  if (cmd === 'data') return commandPythonData(dataDir, sub, tail);
  if (cmd === 'sources') return commandSources(sub ?? 'list');
  if (cmd === 'discover') return commandDiscover([sub, ...tail].filter(Boolean));
  if (cmd === 'symbol') return commandSymbol(sub ?? 'search', tail.join(' '));
  if (cmd === 'stats') return commandPythonStats(dataDir, sub, tail);
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
