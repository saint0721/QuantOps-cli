import type { JsonObject } from './storage.ts';

export function codexRuntimeGuide(): JsonObject {
  return {
    ok: true,
    product: 'QuantOps',
    role: 'headless agent-native quant research runtime for Codex',
    primary_interface: 'shell-cli-json',
    preferred_launcher: 'rtk',
    launcher_aliases: ['rtk', 'quantops', 'quant'],
    primary_user: 'Codex/Claude-style coding or research workflow',
    human_interface: 'Talk to Codex; let Codex call rtk commands through the shell with --json.',
    principles: [
      'Prefer --json for machine-readable outputs.',
      'Use QuantOps for deterministic local execution, artifacts, and safe quant workflows.',
      'Keep human-facing interpretation in Codex, not in a QuantOps-local conversation loop.',
      'Do not provide buy/sell/hold advice or mutate live trading state.',
      'Treat terminal dashboards and compatibility shortcuts as secondary debugging surfaces.',
    ],
    workflow: [
      'codex-guide/runtime: discover the command contract and local readiness',
      'symbol: resolve user language into tickers',
      'data: inspect, download, refresh, and validate OHLCV datasets',
      'stats/compare: compute local quantitative context',
      'research/event: structure context into testable hypotheses and event windows',
      'backtest: validate strategy ideas against saved data',
      'session: persist redacted handoff material for later Codex turns',
    ],
    minimal_commands: [
      'rtk codex-guide --json',
      'rtk runtime info --json',
      'rtk symbol search <query> --json',
      'rtk data info <SYMBOL> --json',
      'rtk data download <SYMBOL> --start YYYY-MM-DD --end YYYY-MM-DD --json',
      'rtk data validate <SYMBOL> --json',
      'rtk stats <SYMBOL> --json',
      'rtk compare <SYMBOL> <BENCHMARK_OR_PEER...> --json',
      'rtk research <SYMBOL> --topic "<topic>" --json',
      'rtk event define --type <type> --target-symbol <SYMBOL> --json',
      'rtk event study <SYMBOL> --event-date YYYY-MM-DD --benchmark <SYMBOL> --json',
      'rtk backtest strategies --json',
      'rtk backtest run <SYMBOL> --strategy ma-cross --json',
      'rtk session current --json',
    ],
    secondary_surfaces: [
      'interactive launcher for debugging only',
      'terminal dashboard/status views for local inspection only',
      'compatibility aliases that should not replace rtk ... --json automation',
    ],
  };
}

export function formatCodexRuntimeGuide(): string {
  const guide = codexRuntimeGuide();
  const humanCommands = (guide.minimal_commands as string[]).map((command) => command.replace(/^rtk\s+/, ''));
  return [
    'QuantOps Codex runtime guide',
    '',
    `Role: ${guide.role}`,
    `Primary user: ${guide.primary_user}`,
    '',
    'Use this pattern:',
    '1. User talks to Codex.',
    '2. Codex calls QuantOps CLI commands with --json.',
    '3. QuantOps returns data, validation, research, backtest, session, and artifact outputs.',
    '4. Codex explains the result with uncertainty and without trading advice.',
    '',
    'Minimal command sequence:',
    ...(humanCommands.map((command) => `- ${command}`)),
    '',
    'Secondary surfaces:',
    ...((guide.secondary_surfaces as string[]).map((item) => `- ${item}`)),
  ].join('\n');
}
