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

const APP = 'TossQuant';
const VERSION = '0.1.0';
const GREEN = '\u001b[92m';
const CYAN = '\u001b[96m';
const YELLOW = '\u001b[93m';
const RESET = '\u001b[0m';
let INTERACTIVE_CHAT_UI = false;

export const ROOT_COMPLETIONS = ['doctor', 'collect', 'data', 'stats', 'quote', 'history', 'classify', 'portfolio', 'order', 'brief', 'runtime', 'hud', 'tmux', 'setup'];
export const SLASH_COMPLETIONS = ['/help', '/status', '/collect', '/data', '/stats', '/quote', '/history', '/classify', '/portfolio', '/order', '/brief', '/watchlist', '/hud', '/runtime', '/ask', '/codex', '/quant', '/exit'];

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
  if (command === 'data') return parts.length <= 2 ? ['download', 'watchlist', 'list'] : [];
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
  const command = ['-m', 'tossquant_cli.cli', '--data-dir', dataDir, 'data', sub, ...tail];
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
    'commands    /status · /collect plan|quote|watchlist · /data download|watchlist|list · /stats <SYMBOL> · /runtime line · /hud · /doctor · /exit',
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
