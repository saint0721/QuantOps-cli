import type { JsonObject } from './storage.ts';

export function codexRuntimeGuide(): JsonObject {
  return {
    ok: true,
    product: 'QuantOps',
    role: 'agent-native quant research runtime',
    primary_interface: 'shell-cli-json',
    primary_user: 'Codex/Claude-style coding or research agent',
    human_interface: 'Talk to Codex; let Codex call quantops CLI commands through the shell.',
    principles: [
      'Prefer --json for machine-readable outputs.',
      'Use QuantOps for deterministic local execution, artifacts, and safe quant workflows.',
      'Do not use QuantOps as a standalone chat agent.',
      'Do not provide buy/sell/hold advice or mutate live trading state.',
      'Treat MCP as an optional future integration layer; shell CLI is the stable first contract.',
    ],
    workflow: [
      'doctor: verify local runtime and safety state',
      'symbol: resolve user language into tickers',
      'data: inspect, download, refresh, and validate OHLCV datasets',
      'stats/compare: compute local quantitative context',
      'research/event: structure news into testable hypotheses and event windows',
      'backtest: validate strategy ideas against saved data',
      'session/report/artifact: persist handoff material for later Codex turns',
    ],
    minimal_commands: [
      'quantops doctor --json',
      'quantops runtime info --json',
      'quantops symbol search <query> --json',
      'quantops data info <SYMBOL> --json',
      'quantops data download <SYMBOL> --start YYYY-MM-DD --end YYYY-MM-DD --json',
      'quantops data validate <SYMBOL> --json',
      'quantops stats <SYMBOL> --json',
      'quantops compare <SYMBOL> <BENCHMARK_OR_PEER...> --json',
      'quantops research <SYMBOL> --topic "<topic>" --json',
      'quantops event define --type <type> --target-symbol <SYMBOL> --json',
      'quantops event study <SYMBOL> --event-date YYYY-MM-DD --benchmark <SYMBOL> --json',
      'quantops backtest strategies --json',
      'quantops backtest run <SYMBOL> --strategy ma-cross --json',
    ],
    de_emphasized: [
      'interactive TUI as primary UX',
      '/agent and fake local chat loops',
      'calling Codex from inside QuantOps as the default path',
      'MCP-first implementation before CLI JSON contracts are stable',
    ],
  };
}

export function formatCodexRuntimeGuide(): string {
  const guide = codexRuntimeGuide();
  return [
    'QuantOps Codex runtime guide',
    '',
    `Role: ${guide.role}`,
    `Primary user: ${guide.primary_user}`,
    '',
    'Use this pattern:',
    '1. User talks to Codex.',
    '2. Codex calls quantops commands with --json.',
    '3. QuantOps returns data, validation, research, backtest, and artifact outputs.',
    '4. Codex explains the result with uncertainty and without trading advice.',
    '',
    'Minimal command sequence:',
    ...((guide.minimal_commands as string[]).map((command) => `- ${command}`)),
    '',
    'De-emphasized:',
    ...((guide.de_emphasized as string[]).map((item) => `- ${item}`)),
  ].join('\n');
}
