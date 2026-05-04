import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildRuntimeSnapshot, readRuntimeSnapshot, recordRuntime, renderRuntimeLine, writeRuntimeSnapshot } from './runtime.ts';

const RESET = '\u001b[0m';
const HUD = '\u001b[2m\u001b[94m';
export const DEFAULT_SESSION = 'tossquant';

export function sessionHash(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 8);
}

export function defaultTmuxSession(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const source = env.TOSSQUANT_SESSION || env.CODEX_SESSION_ID || env.OMX_SESSION_ID || env.OMX_SESSION || env.TMUX_PANE || cwd;
  return `${DEFAULT_SESSION}-${sessionHash(source)}`;
}

export function color(text: string, ansi = HUD): string { return `${ansi}${text}${RESET}`; }
export function tmuxPath(): string | null {
  const result = spawnSync('sh', ['-lc', 'command -v tmux'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}
export function tmuxInstallHint(): string { return 'install tmux with your OS package manager, e.g. apt install tmux, brew install tmux, or pacman -S tmux'; }
export function inTmux(): boolean { return Boolean(process.env.TMUX); }
export function shellCommand(parts: string[]): string { return parts.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(' '); }
export function hudWatchCommand(base = 'data', interval = 1): string {
  return shellCommand([process.execPath, new URL('./cli.ts', import.meta.url).pathname, '--data-dir', base, 'hud', '--watch', '--interval', String(interval)]);
}
export function interactiveCommand(): string { return shellCommand([process.execPath, new URL('./cli.ts', import.meta.url).pathname, '--no-tmux']); }

export function printHudOnce(base = 'data', mode = 'quant', lastAction = 'ready'): string {
  const line = renderRuntimeLine(recordRuntime({ base, mode, lastAction }));
  console.log(color(line));
  return line;
}

export async function watchHud(base = 'data', interval = 1): Promise<never> {
  for (;;) {
    let snapshot = readRuntimeSnapshot(base);
    if (!snapshot) { snapshot = buildRuntimeSnapshot({ base }); writeRuntimeSnapshot(snapshot, base); }
    console.log(`\u001b[2J\u001b[H${color(renderRuntimeLine(snapshot))}`);
    await new Promise((resolve) => setTimeout(resolve, Math.max(interval, 0.2) * 1000));
  }
}

export function launchTmuxHud(base = 'data', height = 3, interval = 1): { code: number; message: string } {
  const tmux = tmuxPath();
  if (!tmux) return { code: 127, message: `tmux not found in PATH; ${tmuxInstallHint()}` };
  if (!inTmux()) return { code: 2, message: 'not inside a tmux session; run tossquant with no arguments or start tmux first' };
  const result = spawnSync(tmux, ['split-window', '-v', '-l', String(Math.max(1, height)), hudWatchCommand(base, interval)], { encoding: 'utf8' });
  return { code: result.status ?? 1, message: (result.stderr || result.stdout || 'tmux HUD launched').trim() };
}

export function launchTmuxRuntime(base = 'data', session = DEFAULT_SESSION, height = 3, interval = 1, cwd = process.cwd()): { code: number; message: string } {
  const tmux = tmuxPath();
  if (!tmux) return { code: 127, message: `tmux not found in PATH; ${tmuxInstallHint()}` };
  if (inTmux()) return { code: 2, message: 'already inside tmux; use /hud tmux to add the TossQuant HUD pane' };
  const create = spawnSync(tmux, ['new-session', '-d', '-s', session, '-n', 'main', '-c', cwd, interactiveCommand()], { encoding: 'utf8' });
  if (create.status !== 0) {
    const exists = spawnSync(tmux, ['has-session', '-t', session], { encoding: 'utf8' });
    if (exists.status === 0) {
      const attachExisting = spawnSync(tmux, ['attach-session', '-t', session], { encoding: 'utf8', stdio: 'inherit' });
      return { code: attachExisting.status ?? 0, message: 'attached existing TossQuant tmux session' };
    }
    return { code: create.status ?? 1, message: (create.stderr || create.stdout || 'failed to create tmux session').trim() };
  }
  const target = `${session}:main`;
  const split = spawnSync(tmux, ['split-window', '-t', target, '-v', '-l', String(Math.max(1, height)), '-c', cwd, hudWatchCommand(base, interval)], { encoding: 'utf8' });
  if (split.status !== 0) return { code: split.status ?? 1, message: (split.stderr || split.stdout || 'failed to create HUD pane').trim() };
  spawnSync(tmux, ['select-pane', '-t', `${target}.0`], { encoding: 'utf8' });
  const attach = spawnSync(tmux, ['attach-session', '-t', session], { encoding: 'utf8', stdio: 'inherit' });
  return { code: attach.status ?? 0, message: 'TossQuant tmux runtime closed' };
}
