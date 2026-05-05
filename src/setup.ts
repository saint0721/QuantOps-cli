import { lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type InstallBinOptions = { dir?: string; force?: boolean };
export type InstallBinResult = { ok: boolean; links: Array<{ name: string; path: string; target: string; action: string }>; error?: string };
export type RustHelperBuildOptions = { release?: boolean; dryRun?: boolean };
export type RustHelperBuildResult = { ok: boolean; helpers: Array<{ name: string; command: string[]; code: number | null; stdout: string; stderr: string; skipped?: boolean }>; error?: string };

export const RUST_HELPERS = ['quantops-stats', 'quantops-backtest', 'quantops-event'] as const;

function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

function defaultBinDir(): string {
  const home = process.env.HOME || process.cwd();
  return resolve(home, '.local', 'bin');
}

function installOne(name: string, target: string, dir: string, force: boolean): { name: string; path: string; target: string; action: string } {
  const linkPath = resolve(dir, name);
  let stat: ReturnType<typeof lstatSync> | null = null;
  try {
    stat = lstatSync(linkPath);
  } catch {
    stat = null;
  }
  if (stat) {
    if (stat.isSymbolicLink()) {
      const current = resolve(dirname(linkPath), readlinkSync(linkPath));
      if (current === target) return { name, path: linkPath, target, action: 'exists' };
      if (!force) throw new Error(`${linkPath} already points to ${current}; rerun with --force to replace it`);
      unlinkSync(linkPath);
    } else {
      if (!force) throw new Error(`${linkPath} already exists and is not a symlink; rerun with --force only if you want to replace it`);
      unlinkSync(linkPath);
    }
  }
  symlinkSync(target, linkPath);
  return { name, path: linkPath, target, action: 'linked' };
}

export function installLocalBins(options: InstallBinOptions = {}): InstallBinResult {
  const dir = resolve(options.dir || defaultBinDir());
  mkdirSync(dir, { recursive: true });
  const force = Boolean(options.force);
  const links = [
    installOne('rtk', repoPath('src/cli.ts'), dir, force),
    installOne('quant', repoPath('src/cli.ts'), dir, force),
    installOne('quantops', repoPath('src/cli.ts'), dir, force),
  ];
  return { ok: true, links };
}

export function pathHint(dir = defaultBinDir()): string {
  return `Make sure ${dir} is on PATH. Example: export PATH="${dir}:$PATH"`;
}

export function buildRustHelpers(options: RustHelperBuildOptions = {}): RustHelperBuildResult {
  const manifest = repoPath('tui/Cargo.toml');
  const helpers = RUST_HELPERS.map((name) => {
    const command = ['cargo', 'build', '--manifest-path', manifest, '--bin', name];
    if (options.release) command.push('--release');
    if (options.dryRun) return { name, command, code: 0, stdout: '', stderr: '', skipped: true };
    const result = spawnSync(command[0]!, command.slice(1), { encoding: 'utf8', cwd: repoPath('.') });
    return {
      name,
      command,
      code: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  });
  return { ok: helpers.every((helper) => helper.code === 0), helpers };
}
