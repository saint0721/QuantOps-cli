import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildRuntimeSnapshot, readRuntimeSnapshot, recordRuntime, renderRuntimeLine, writeRuntimeSnapshot } from './runtime.ts';
import { hudColor } from './ui/hud.ts';

export const DEFAULT_SESSION = 'quantops';

export function sessionHash(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 8);
}

export function defaultTmuxSession(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const source = env.QUANTOPS_SESSION || env.CODEX_SESSION_ID || env.OMX_SESSION_ID || env.OMX_SESSION || env.TMUX_PANE || cwd;
  return `${DEFAULT_SESSION}-${sessionHash(source)}`;
}

export function tmuxPath(): string | null {
  const result = spawnSync('sh', ['-lc', 'command -v tmux'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}
export function tmuxInstallHint(): string { return 'install tmux with your OS package manager, e.g. apt install tmux, brew install tmux, or pacman -S tmux'; }
export function inTmux(): boolean { return Boolean(process.env.TMUX); }
export function shellCommand(parts: string[]): string { return parts.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(' '); }
export function managedTmuxSession(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.QUANTOPS_TMUX_MANAGED === '1' && env.QUANTOPS_TMUX_SESSION ? env.QUANTOPS_TMUX_SESSION : null;
}
export function hudWatchCommand(base = 'data', interval = 1): string {
  return shellCommand([process.execPath, new URL('./cli.ts', import.meta.url).pathname, '--data-dir', base, 'hud', '--watch', '--interval', String(interval)]);
}
export function interactiveCommand(base = 'data', session?: string): string {
  const envPrefix = session ? ['env', 'QUANTOPS_TMUX_MANAGED=1', `QUANTOPS_TMUX_SESSION=${session}`] : [];
  return shellCommand([...envPrefix, process.execPath, new URL('./cli.ts', import.meta.url).pathname, '--no-tmux', '--data-dir', base]);
}

export function tmuxRuntimeOptions(session: string): string[][] {
  const target = `${session}:main`;
  return [
    ['set-option', '-t', session, 'mouse', 'on'],
    ['set-option', '-t', session, 'history-limit', '50000'],
    ['set-option', '-t', session, 'status-keys', 'vi'],
    ['set-option', '-t', session, 'renumber-windows', 'on'],
    ['set-window-option', '-t', target, 'mode-keys', 'vi'],
  ];
}

export function commandPaneTarget(session: string, paneIndex = 0): string {
  return `${session}:main.${paneIndex}`;
}

export function hudPaneTarget(session: string, paneIndex = 1): string {
  return `${session}:main.${paneIndex}`;
}

function paneTarget(session: string, pane: TmuxPaneSnapshot): string {
  return `${session}:main.${pane.index}`;
}

export type TmuxPaneSnapshot = {
  index: number;
  dead: boolean;
  title: string;
  currentCommand: string;
  startCommand: string;
};

const PANE_FIELD_SEPARATOR = '\t';
const PANE_FORMAT = [
  '#{pane_index}',
  '#{pane_dead}',
  '#{pane_title}',
  '#{pane_current_command}',
  '#{pane_start_command}',
].join(PANE_FIELD_SEPARATOR);

export function clampedHudHeight(requested: number, windowHeight?: number): number {
  const height = Math.max(1, Math.floor(requested));
  if (!Number.isFinite(windowHeight) || !windowHeight) return height;
  const maxHudHeight = Math.max(1, Math.floor(windowHeight) - 8);
  return Math.min(height, maxHudHeight);
}

export function parseTmuxPaneSnapshot(line: string): TmuxPaneSnapshot | null {
  const [index, dead, title, currentCommand, startCommand] = line.split(PANE_FIELD_SEPARATOR);
  const parsedIndex = Number(index);
  if (!Number.isInteger(parsedIndex)) return null;
  return {
    index: parsedIndex,
    dead: dead === '1',
    title: title ?? '',
    currentCommand: currentCommand ?? '',
    startCommand: startCommand ?? '',
  };
}

function paneRunsHudWatch(pane: TmuxPaneSnapshot): boolean {
  return pane.startCommand.includes("'hud' '--watch'")
    || pane.startCommand.includes(' hud --watch')
    || (pane.startCommand.includes("'hud'") && pane.startCommand.includes("'--watch'"));
}

function paneRunsInteractiveCommand(pane: TmuxPaneSnapshot): boolean {
  return pane.startCommand.includes('--no-tmux')
    || pane.startCommand.includes('QUANTOPS_TMUX_MANAGED=1')
    || pane.currentCommand.includes('quantops-tui')
    || pane.title === 'QuantOps command';
}

function findCommandPane(panes: TmuxPaneSnapshot[]): TmuxPaneSnapshot | undefined {
  return panes.find((pane) => !pane.dead && paneRunsInteractiveCommand(pane) && !paneRunsHudWatch(pane));
}

function findHudPane(panes: TmuxPaneSnapshot[]): TmuxPaneSnapshot | undefined {
  return panes.find((pane) => !pane.dead && paneRunsHudWatch(pane))
    ?? panes.find((pane) => !pane.dead && pane.title === 'QuantOps HUD' && !paneRunsInteractiveCommand(pane));
}

export function tmuxRuntimeHasUsableCommandPane(panes: TmuxPaneSnapshot[]): boolean {
  return Boolean(findCommandPane(panes));
}

export function tmuxRuntimeHasHudPane(panes: TmuxPaneSnapshot[]): boolean {
  return Boolean(findHudPane(panes));
}

function applyTmuxRuntimeOptions(tmux: string, session: string): void {
  for (const args of tmuxRuntimeOptions(session)) {
    spawnSync(tmux, args, { encoding: 'utf8' });
  }
}

function tmuxWindowHeight(tmux: string, target: string): number | undefined {
  const result = spawnSync(tmux, ['display-message', '-p', '-t', target, '#{window_height}'], { encoding: 'utf8' });
  const parsed = Number(result.stdout.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function selectCommandPane(tmux: string, session: string): void {
  const target = `${session}:main`;
  spawnSync(tmux, ['select-window', '-t', target], { encoding: 'utf8' });
  const commandPane = findCommandPane(listRuntimePanes(tmux, session));
  if (commandPane) spawnSync(tmux, ['select-pane', '-t', paneTarget(session, commandPane)], { encoding: 'utf8' });
}

function listRuntimePanes(tmux: string, session: string): TmuxPaneSnapshot[] {
  const result = spawnSync(tmux, ['list-panes', '-t', `${session}:main`, '-F', PANE_FORMAT], { encoding: 'utf8' });
  if ((result.status ?? 1) !== 0) return [];
  return result.stdout.split(/\r?\n/).map(parseTmuxPaneSnapshot).filter((pane): pane is TmuxPaneSnapshot => Boolean(pane));
}

function renamePane(tmux: string, session: string, pane: TmuxPaneSnapshot | undefined, title: string): void {
  if (!pane || pane.title === title) return;
  spawnSync(tmux, ['select-pane', '-t', paneTarget(session, pane), '-T', title], { encoding: 'utf8' });
}

function syncRuntimePaneTitles(tmux: string, session: string): void {
  const panes = listRuntimePanes(tmux, session);
  renamePane(tmux, session, findCommandPane(panes), 'QuantOps command');
  renamePane(tmux, session, findHudPane(panes), 'QuantOps HUD');
}

function ensureHudPane(tmux: string, session: string, base: string, height: number, interval: number, cwd: string): void {
  const panes = listRuntimePanes(tmux, session);
  const commandPane = findCommandPane(panes);
  if (!commandPane) return;
  if (findHudPane(panes)) {
    syncRuntimePaneTitles(tmux, session);
    return;
  }
  const target = `${session}:main`;
  const hudHeight = clampedHudHeight(height, tmuxWindowHeight(tmux, target));
  const split = spawnSync(tmux, [
    'split-window',
    '-P',
    '-F',
    '#{pane_index}',
    '-t',
    paneTarget(session, commandPane),
    '-v',
    '-l',
    String(hudHeight),
    '-c',
    cwd,
    hudWatchCommand(base, interval),
  ], { encoding: 'utf8' });
  if ((split.status ?? 1) === 0) {
    const paneIndex = Number(split.stdout.trim());
    const hudPane = Number.isInteger(paneIndex)
      ? { ...commandPane, index: paneIndex, title: '' }
      : findHudPane(listRuntimePanes(tmux, session));
    renamePane(tmux, session, hudPane, 'QuantOps HUD');
  }
  syncRuntimePaneTitles(tmux, session);
}

export function shutdownManagedTmuxRuntime(env: NodeJS.ProcessEnv = process.env): { code: number; message: string; skipped: boolean } {
  const session = managedTmuxSession(env);
  if (!session) return { code: 0, message: 'not a QuantOps-managed tmux runtime', skipped: true };
  const tmux = tmuxPath();
  if (!tmux) return { code: 127, message: `tmux not found in PATH; ${tmuxInstallHint()}`, skipped: true };
  const result = spawnSync(tmux, ['kill-session', '-t', session], { encoding: 'utf8' });
  return { code: result.status ?? 0, message: (result.stderr || result.stdout || `closed QuantOps tmux session ${session}`).trim(), skipped: false };
}

export function printHudOnce(base = 'data', mode = 'quant', lastAction = 'ready'): string {
  const line = renderRuntimeLine(recordRuntime({ base, mode, lastAction }));
  console.log(hudColor(line));
  return line;
}

export async function watchHud(base = 'data', interval = 1): Promise<never> {
  for (;;) {
    let snapshot = readRuntimeSnapshot(base);
    if (!snapshot) { snapshot = buildRuntimeSnapshot({ base }); writeRuntimeSnapshot(snapshot, base); }
    process.stdout.write(`\u001b[?25l\u001b[2J\u001b[H${hudColor(renderRuntimeLine(snapshot))}\u001b[0K`);
    await new Promise((resolve) => setTimeout(resolve, Math.max(interval, 0.2) * 1000));
  }
}

export function launchTmuxHud(base = 'data', height = 3, interval = 1): { code: number; message: string } {
  const tmux = tmuxPath();
  if (!tmux) return { code: 127, message: `tmux not found in PATH; ${tmuxInstallHint()}` };
  if (!inTmux()) return { code: 2, message: 'not inside a tmux session; run quantops with no arguments or start tmux first' };
  const result = spawnSync(tmux, ['split-window', '-v', '-l', String(Math.max(1, height)), hudWatchCommand(base, interval)], { encoding: 'utf8' });
  return { code: result.status ?? 1, message: (result.stderr || result.stdout || 'tmux HUD launched').trim() };
}

export function launchTmuxRuntime(base = 'data', session = DEFAULT_SESSION, height = 3, interval = 1, cwd = process.cwd()): { code: number; message: string } {
  const tmux = tmuxPath();
  if (!tmux) return { code: 127, message: `tmux not found in PATH; ${tmuxInstallHint()}` };
  if (inTmux()) return { code: 2, message: 'already inside tmux; use /hud tmux to add the QuantOps HUD pane' };
  const create = spawnSync(tmux, ['new-session', '-d', '-s', session, '-n', 'main', '-c', cwd, interactiveCommand(base, session)], { encoding: 'utf8' });
  if (create.status !== 0) {
    const exists = spawnSync(tmux, ['has-session', '-t', session], { encoding: 'utf8' });
    if (exists.status === 0) {
      const panes = listRuntimePanes(tmux, session);
      if (tmuxRuntimeHasUsableCommandPane(panes)) {
        applyTmuxRuntimeOptions(tmux, session);
        ensureHudPane(tmux, session, base, height, interval, cwd);
        selectCommandPane(tmux, session);
        const attachExisting = spawnSync(tmux, ['attach-session', '-t', session], { encoding: 'utf8', stdio: 'inherit' });
        return { code: attachExisting.status ?? 0, message: 'attached existing QuantOps tmux session' };
      }
      spawnSync(tmux, ['kill-session', '-t', session], { encoding: 'utf8' });
      return launchTmuxRuntime(base, session, height, interval, cwd);
    }
    return { code: create.status ?? 1, message: (create.stderr || create.stdout || 'failed to create tmux session').trim() };
  }
  applyTmuxRuntimeOptions(tmux, session);
  const target = `${session}:main`;
  syncRuntimePaneTitles(tmux, session);
  const commandPane = findCommandPane(listRuntimePanes(tmux, session));
  if (!commandPane) return { code: 1, message: 'failed to locate QuantOps command pane after creating tmux session' };
  const hudHeight = clampedHudHeight(height, tmuxWindowHeight(tmux, target));
  const split = spawnSync(tmux, [
    'split-window',
    '-P',
    '-F',
    '#{pane_index}',
    '-t',
    paneTarget(session, commandPane),
    '-v',
    '-l',
    String(hudHeight),
    '-c',
    cwd,
    hudWatchCommand(base, interval),
  ], { encoding: 'utf8' });
  if (split.status !== 0) return { code: split.status ?? 1, message: (split.stderr || split.stdout || 'failed to create HUD pane').trim() };
  const paneIndex = Number(split.stdout.trim());
  if (Number.isInteger(paneIndex)) renamePane(tmux, session, { ...commandPane, index: paneIndex, title: '' }, 'QuantOps HUD');
  syncRuntimePaneTitles(tmux, session);
  selectCommandPane(tmux, session);
  const attach = spawnSync(tmux, ['attach-session', '-t', session], { encoding: 'utf8', stdio: 'inherit' });
  return { code: attach.status ?? 0, message: 'QuantOps tmux runtime closed' };
}
