import { spawnSync } from 'node:child_process';

export type TossResult = { ok: boolean; returncode: number; stdout: string; stderr: string; command: string[] };

export function tossctlPath(): string {
  if (process.env.QUANT_TOSSCTL) return process.env.QUANT_TOSSCTL;
  const found = spawnSync('sh', ['-lc', 'command -v tossctl'], { encoding: 'utf8' });
  return found.status === 0 && found.stdout.trim() ? found.stdout.trim() : 'tossctl';
}

export function runToss(args: string[]): TossResult {
  const command = [tossctlPath(), ...args, '--output', 'json'];
  const completed = spawnSync(command[0]!, command.slice(1), { encoding: 'utf8' });
  return {
    ok: completed.status === 0,
    returncode: completed.status ?? 1,
    stdout: completed.stdout ?? '',
    stderr: completed.stderr ?? String(completed.error?.message ?? ''),
    command,
  };
}

export const quote = (ticker: string) => runToss(['quote', 'get', ticker]);
export const accountSummary = () => runToss(['account', 'summary']);
export const portfolioPositions = () => runToss(['portfolio', 'positions']);
export const authStatus = () => runToss(['auth', 'status']);
export const version = () => runToss(['--version']);
export const orderPreview = (flags: string[]) => runToss(['order', 'preview', ...flags]);
