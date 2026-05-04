#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { classify, historyRows } from './analysis.ts';
import { filteredCodexOutput } from './codex.ts';
import { launchTmuxHud, launchTmuxRuntime, printHudOnce, tmuxInstallHint, tmuxPath, watchHud } from './hud.ts';
import { recordRuntime, renderRuntimeLine, statusSummary } from './runtime.ts';
import { appendJsonl, quoteHistoryPath, readJsonl, readWatchlist, redact, snapshotPath, utcNow, writeWatchlist } from './storage.ts';
import { accountSummary, authStatus, orderPreview, portfolioPositions, quote, version } from './toss.ts';

const APP = 'TossQuant';
const VERSION = '0.1.0';
const GREEN = '\u001b[92m';
const CYAN = '\u001b[96m';
const YELLOW = '\u001b[93m';
const RESET = '\u001b[0m';

function ok(text: string) { console.log(`  ${GREEN}ok${RESET}    ${text}`); }
function warn(text: string) { console.log(`  ${YELLOW}warn${RESET}  ${text}`); }
function printJson(value: unknown) { console.log(JSON.stringify(value, null, 2)); }
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
  const result = quote(ticker);
  if (!result.ok) { printJson({ ok: false, command: result.command, error: result.stderr || result.stdout }); return result.returncode || 1; }
  const payload = parseJsonOrRaw(result.stdout, result.stderr, result.returncode) as object;
  const record = { ticker: ticker.toUpperCase(), fetched_at: utcNow(), source: 'tossctl quote get', payload: redact(payload as never) };
  const path = quoteHistoryPath(ticker, dataDir);
  appendJsonl(path, record as never);
  printJson({ ok: true, saved_to: path, ticker: ticker.toUpperCase(), fetched_at: record.fetched_at });
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
  if (result.ok) { console.log(result.stdout.trim()); return 0; }
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
  if (visible) console.log(visible);
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

async function runInteractive(dataDir: string): Promise<number> {
  console.log(`${CYAN}${APP}${RESET} ${VERSION} · TypeScript runtime · trading mutations disabled`);
  const rl = createInterface({ input, output });
  let mode = 'quant';
  let lastAction = 'ready';
  for (;;) {
    const prompt = `${runtimeLine(dataDir, mode, lastAction)}\nTossQuant ${mode} ❯ `;
    const line = (await rl.question(prompt)).trim();
    if (!line) continue;
    if (['exit', 'quit', ':q'].includes(line)) { rl.close(); return 0; }
    const parts = line.split(/\s+/);
    if (line === '/codex') { mode = 'codex'; lastAction = '/codex'; continue; }
    if (line === '/quant') { mode = 'quant'; lastAction = '/quant'; continue; }
    if (line === '/status') { printStatus(dataDir); lastAction = '/status'; continue; }
    if (line.startsWith('/watchlist')) { handleWatchlist(parts, dataDir); lastAction = '/watchlist'; continue; }
    if (line === '/hud') { printHudOnce(dataDir, mode, lastAction); lastAction = '/hud'; continue; }
    if (line === '/hud tmux') { const r = launchTmuxHud(dataDir); r.code === 0 ? ok(r.message) : warn(r.message); lastAction = '/hud'; continue; }
    if (line.startsWith('/runtime')) { console.log(runtimeLine(dataDir, mode, '/runtime')); lastAction = '/runtime'; continue; }
    if (line.startsWith('/ask ')) { runCodexPrompt(line.slice(5)); lastAction = '/ask'; continue; }
    if (mode === 'codex') { runCodexPrompt(line); lastAction = 'codex'; continue; }
    const code = runOnce(['--data-dir', dataDir, ...parts]);
    lastAction = parts.slice(0, 2).join(' ');
    if (code === 2) warn('try /status, /watchlist add AAPL, quote fetch AAPL, runtime line, or exit');
  }
}

export function runOnce(argv: string[]): number {
  const { dataDir, rest } = dataDirFrom(argv);
  const [cmd, sub, ...tail] = rest;
  if (!cmd) return 2;
  if (cmd === 'doctor') return commandDoctor(dataDir);
  if (cmd === 'quote' && sub === 'fetch') return commandQuoteFetch(dataDir, tail[0]);
  if (cmd === 'quote' && sub === 'history') return commandQuoteHistory(dataDir, tail[0]);
  if (cmd === 'quote' && sub) return commandQuoteFetch(dataDir, sub);
  if (cmd === 'history') return commandQuoteHistory(dataDir, sub);
  if (cmd === 'classify') return commandClassify(dataDir, sub);
  if (cmd === 'portfolio' && (sub === 'snapshot' || !sub)) return commandPortfolioSnapshot(dataDir);
  if (cmd === 'order' && sub === 'preview') return commandOrderPreview(tail);
  if (cmd === 'runtime' && sub === 'snapshot') { printJson(recordRuntime({ base: dataDir, lastAction: 'snapshot' })); return 0; }
  if (cmd === 'runtime' && sub === 'line') { console.log(runtimeLine(dataDir)); return 0; }
  if (cmd === 'hud' && rest.includes('--watch')) { void watchHud(dataDir, Number(rest[rest.indexOf('--interval') + 1] ?? 1)); return 0; }
  if (cmd === 'hud' && rest.includes('--tmux')) { const r = launchTmuxHud(dataDir); r.code === 0 ? ok(r.message) : warn(r.message); return r.code; }
  if (cmd === 'hud') { printHudOnce(dataDir); return 0; }
  if (cmd === 'tmux' && sub === 'start') { const r = launchTmuxRuntime(dataDir); r.code === 0 ? ok(r.message) : warn(r.message); return r.code; }
  if (cmd === 'brief') return runCodexPrompt('Create a concise TossQuant session brief from local redacted data. Do not give buy/sell/hold advice.');
  warn(`unknown command: ${cmd}`);
  return 2;
}

export function shouldAutoStartTmux(noTmux: boolean): boolean {
  return !noTmux && !process.env.TOSSQUANT_NO_TMUX && !process.env.TMUX && input.isTTY && output.isTTY && Boolean(tmuxPath());
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { dataDir, rest, noTmux } = dataDirFrom(argv);
  if (rest.length === 0) {
    if (shouldAutoStartTmux(noTmux)) {
      const r = launchTmuxRuntime(dataDir);
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
