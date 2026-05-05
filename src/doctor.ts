import { spawnSync } from 'node:child_process';
import { rustBacktestStatus } from './rustBacktest.ts';
import { rustEventStatus } from './rustEvent.ts';
import { rustStatsStatus } from './rustStats.ts';
import { rustValidateStatus } from './rustValidate.ts';
import { authStatus, version } from './toss.ts';
import { pathHint } from './setup.ts';
import { tmuxInstallHint, tmuxPath } from './hud.ts';
import type { JsonObject } from './storage.ts';

export type DoctorOptions = { app: string; version: string };

function commandPath(name: string): string | null {
  const found = spawnSync('sh', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return found.status === 0 && found.stdout.trim() ? found.stdout.trim() : null;
}

function nodeStatus(): JsonObject {
  const major = Number(process.versions.node.split('.')[0] ?? 0);
  return {
    ok: major >= 24,
    version: process.versions.node,
    required: '>=24.0.0',
  };
}

function launcherStatus(): JsonObject {
  const launchers = ['rtk', 'quantops', 'quant'].map((name) => ({ name, path: commandPath(name) }));
  return {
    preferred: 'rtk',
    aliases: launchers,
    preferred_available: Boolean(launchers.find((item) => item.name === 'rtk')?.path),
    any_available: launchers.some((item) => item.path),
    setup_command: 'node ./src/cli.ts setup bin',
    path_hint: pathHint(),
  };
}

function brokerStatus(): JsonObject {
  const ver = version();
  const auth = authStatus();
  return {
    optional: true,
    trading_mutations: 'disabled',
    tossctl_version_ok: ver.ok,
    tossctl_version: (ver.stdout || ver.stderr).trim(),
    auth_status_ok: auth.ok,
    auth_status: (auth.stdout || auth.stderr).trim(),
    note: 'Broker/tossctl is optional for research harness usage; failed broker checks should not block rtk data/stats/research/backtest commands.',
  };
}

function rustStatus(): JsonObject {
  return {
    stats: rustStatsStatus(),
    backtest: rustBacktestStatus(),
    event: rustEventStatus(),
    validate: rustValidateStatus(),
  };
}

export function doctorPayload(dataDir: string, options: DoctorOptions): JsonObject {
  const node = nodeStatus();
  const launcher = launcherStatus();
  const tmux = tmuxPath();
  const rust = rustStatus();
  const warnings: string[] = [];
  if (!launcher.preferred_available) warnings.push('rtk launcher not found on PATH; run setup bin or use node ./src/cli.ts as a fallback');
  if (!tmux) warnings.push('tmux not found; Codex conversation still works, but tmux HUD/runtime panes are unavailable');
  return {
    ok: Boolean(node.ok),
    app: options.app,
    version: options.version,
    data_dir: dataDir,
    interface: 'shell-cli-json',
    human_surface: 'Codex conversation',
    node,
    launcher,
    warnings,
    tmux_path: tmux,
    tmux_available: Boolean(tmux),
    tmux_install_hint: tmux ? 'ok' : tmuxInstallHint(),
    rust,
    rust_stats: rust.stats,
    rust_backtest: rust.backtest,
    rust_event: rust.event,
    rust_validate: rust.validate,
    broker: brokerStatus(),
  };
}
