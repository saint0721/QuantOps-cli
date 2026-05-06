import { buildRuntimeSnapshot, renderRuntimeLine } from './runtime.ts';
import { codexRuntimeGuide } from './guide.ts';
import type { JsonObject } from './storage.ts';

export function runtimeInfoPayload(dataDir: string): JsonObject {
  const snapshot = buildRuntimeSnapshot({ base: dataDir, lastAction: 'runtime.info' });
  const guide = codexRuntimeGuide();
  return {
    ok: true,
    command: 'runtime.info',
    runtime: snapshot as unknown as JsonObject,
    contract: {
      primary_interface: 'shell-cli-json',
      preferred_launcher: 'rtk',
      launcher_aliases: ['rtk', 'quantops', 'quant'],
      human_primary_surface: 'shell CLI',
      quantops_role: guide.role,
      protocol_adapters: 'future only; shell CLI JSON is the stable contract',
      engines: {
        cli_contract: 'TypeScript dispatcher',
        fast_kernels: 'Rust stats/backtest/event/data-validate helpers when built or explicitly requested',
        quant_analysis_reference: 'Python compatibility module for quant-analysis experiments',
      },
      trading_mutations: 'disabled by default',
    },
    recommended_start: guide.minimal_commands,
  };
}

export function formatRuntimeInfo(payload: JsonObject): string {
  return [
    renderRuntimeLine(payload.runtime as any),
    '',
    'Headless runtime contract',
    '- Primary interface: shell CLI with --json',
    '- Preferred launcher: rtk',
    '- Call rtk/quantops commands directly from the shell',
    '- Protocol adapters can be added later after CLI JSON contracts stay stable',
  ].join('\n');
}
