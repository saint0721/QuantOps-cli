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

export function commandPaneTarget(session: string): string {
  return `${session}:main.0`;
}

export function hudPaneTarget(session: string): string {
  return `${session}:main.1`;
}

export function clampedHudHeight(requested: number, windowHeight?: number): number {
  const height = Math.max(1, Math.floor(requested));
  if (!Number.isFinite(windowHeight) || !windowHeight) return height;
  const maxHudHeight = Math.max(1, Math.floor(windowHeight) - 8);
  return Math.min(height, maxHudHeight);
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
  spawnSync(tmux, ['select-pane', '-t', commandPaneTarget(session)], { encoding: 'utf8' });
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
      applyTmuxRuntimeOptions(tmux, session);
      selectCommandPane(tmux, session);
      const attachExisting = spawnSync(tmux, ['attach-session', '-t', session], { encoding: 'utf8', stdio: 'inherit' });
      return { code: attachExisting.status ?? 0, message: 'attached existing QuantOps tmux session' };
    }
    return { code: create.status ?? 1, message: (create.stderr || create.stdout || 'failed to create tmux session').trim() };
  }
  applyTmuxRuntimeOptions(tmux, session);
  const target = `${session}:main`;
  spawnSync(tmux, ['select-pane', '-t', commandPaneTarget(session), '-T', 'QuantOps command'], { encoding: 'utf8' });
  const hudHeight = clampedHudHeight(height, tmuxWindowHeight(tmux, target));
  const split = spawnSync(tmux, ['split-window', '-t', target, '-v', '-l', String(hudHeight), '-c', cwd, hudWatchCommand(base, interval)], { encoding: 'utf8' });
  if (split.status !== 0) return { code: split.status ?? 1, message: (split.stderr || split.stdout || 'failed to create HUD pane').trim() };
  spawnSync(tmux, ['select-pane', '-t', hudPaneTarget(session), '-T', 'QuantOps HUD'], { encoding: 'utf8' });
  selectCommandPane(tmux, session);
  const attach = spawnSync(tmux, ['attach-session', '-t', session], { encoding: 'utf8', stdio: 'inherit' });
  return { code: attach.status ?? 0, message: 'QuantOps tmux runtime closed' };
}
