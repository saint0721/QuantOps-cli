import type { JsonObject } from './storage.ts';

export function codexRuntimeGuide(): JsonObject {
  return {
    ok: true,
    product: 'QuantOps',
    role: 'headless quant research runtime',
    primary_interface: 'shell-cli-json',
    preferred_launcher: 'rtk',
    launcher_aliases: ['rtk', 'quantops', 'quant'],
    primary_user: 'shell caller or automation harness',
    human_interface: 'Run rtk/quantops CLI commands directly through the shell.',
    principles: [
      'Prefer --json for machine-readable outputs.',
      'Use QuantOps for deterministic local execution, artifacts, and safe quant workflows.',
      'Do not use QuantOps as a standalone conversational or local TUI-first app.',
      'Do not provide buy/sell/hold advice or mutate live trading state.',
      'Treat MCP or other tool protocols as later adapters after the shell CLI JSON contract is stable.',
    ],
    workflow: [
      'runtime/doctor: verify local runtime and safety state',
      'symbol: resolve user language into tickers',
      'data: inspect, download, refresh, and validate OHLCV datasets',
      'stats/compare: compute local quantitative context',
      'research/event: structure news into testable hypotheses and event windows',
      'backtest: validate strategy ideas against saved data',
      'session: persist handoff material for later CLI runs',
    ],
    minimal_commands: [
      'rtk codex-guide --json',
      'rtk doctor --json',
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
    removed_or_deemphasized: [
      'QuantOps-local conversational/TUI surface as primary UX',
      'local conversational command loops',
      'calling an LLM from inside QuantOps by default',
      'MCP-first implementation before CLI JSON contracts are stable',
      'tmux/HUD runtime as default interface',
    ],
  };
}

export function formatCodexRuntimeGuide(): string {
  const guide = codexRuntimeGuide();
  const humanCommands = (guide.minimal_commands as string[]).map((command) => command.replace(/^rtk\s+/, ''));
  return [
    'QuantOps runtime guide',
    '',
    `Role: ${guide.role}`,
    `Primary user: ${guide.primary_user}`,
    '',
    'Use this pattern:',
    '1. Run an rtk command with --json.',
    '2. QuantOps returns data, validation, research, backtest, and artifact outputs.',
    '3. Interpret the result with uncertainty and without trading advice.',
    '',
    'Minimal command sequence:',
    ...humanCommands.map((command) => `- ${command}`),
    '',
    'Removed/de-emphasized:',
    ...(guide.removed_or_deemphasized as string[]).map((item) => `- ${item}`),
  ].join('\n');
}
