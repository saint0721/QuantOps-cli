import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type InstallBinOptions = { dir?: string; force?: boolean };
export type InstallBinResult = { ok: boolean; links: Array<{ name: string; path: string; target: string; action: string }>; error?: string };

function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

function defaultBinDir(): string {
  const home = process.env.HOME || process.cwd();
  return resolve(home, '.local', 'bin');
}

function installOne(name: string, target: string, dir: string, force: boolean): { name: string; path: string; target: string; action: string } {
  const linkPath = resolve(dir, name);
  if (existsSync(linkPath)) {
    const stat = lstatSync(linkPath);
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
    installOne('quant', repoPath('bin/quant'), dir, force),
    installOne('tossquant', repoPath('bin/tossquant'), dir, force),
  ];
  return { ok: true, links };
}

export function pathHint(dir = defaultBinDir()): string {
  return `Make sure ${dir} is on PATH. Example: export PATH="${dir}:$PATH"`;
}
