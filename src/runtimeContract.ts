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
      human_primary_surface: 'Codex conversation',
      quantops_role: guide.role,
      mcp: 'optional integration layer after CLI JSON contracts are stable',
      tui: 'de-emphasized; dashboard/debug/report browser only',
      trading_mutations: 'disabled by default',
    },
    recommended_start: guide.minimal_commands,
  };
}

export function formatRuntimeInfo(payload: JsonObject): string {
  return [
    renderRuntimeLine(payload.runtime as any),
    '',
    'Agent runtime contract',
    '- Primary interface: shell CLI with --json',
    '- Human talks to Codex; Codex calls quantops commands',
    '- MCP is optional later; TUI is not the primary UX',
  ].join('\n');
}
