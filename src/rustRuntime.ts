import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { JsonObject } from './storage.ts';

export function repoRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

export function commandExists(command: string): boolean {
  return (spawnSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).status ?? 1) === 0;
}

export function rustHelperCandidates(binary: string, envVar: string): string[] {
  const root = repoRoot();
  return [
    process.env[envVar],
    resolve(root, 'tui', 'target', 'release', binary),
    resolve(root, 'tui', 'target', 'debug', binary),
  ].filter((item): item is string => Boolean(item));
}

export function rustHelperStatus(binary: string, envVar: string, engineEnv: string, buildHint: string): JsonObject {
  const helper = rustHelperCandidates(binary, envVar).find((candidate) => existsSync(candidate));
  return {
    available: Boolean(helper) || process.env[engineEnv] === 'rust-cargo',
    helper: helper || null,
    cargo_available: commandExists('cargo'),
    engine_env: process.env[engineEnv] || 'auto',
    build_hint: buildHint,
  };
}

export function runRustJsonHelper(binary: string, envVar: string, engineEnv: string, args: string[]): JsonObject | null {
  const helper = rustHelperCandidates(binary, envVar).find((candidate) => existsSync(candidate));
  const engine = process.env[engineEnv] || 'auto';
  let result: ReturnType<typeof spawnSync>;
  if (helper) {
    result = spawnSync(helper, args, { encoding: 'utf8', cwd: repoRoot() });
  } else if (engine === 'rust-cargo') {
    result = spawnSync('cargo', ['run', '--quiet', '--manifest-path', resolve(repoRoot(), 'tui', 'Cargo.toml'), '--bin', binary, '--', ...args], { encoding: 'utf8', cwd: repoRoot() });
  } else {
    return null;
  }
  if ((result.status ?? 1) !== 0 || !result.stdout.trim()) return null;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}
