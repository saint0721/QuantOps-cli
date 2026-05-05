import { spawnSync } from 'node:child_process';
import { filteredCodexOutput } from './codex.ts';
import type { JsonObject } from './storage.ts';

export type LlmProviderName = 'none' | 'codex' | 'claude' | 'openai' | 'anthropic';

export type ProviderStatus = {
  name: LlmProviderName;
  available: boolean;
  auth: 'not-required' | 'cli' | 'env' | 'missing' | 'planned';
  detail: string;
};

function hasCommand(command: string): string | null {
  const result = spawnSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function listProviders(env: NodeJS.ProcessEnv = process.env): ProviderStatus[] {
  const codex = hasCommand('codex');
  const claude = hasCommand('claude');
  return [
    { name: 'none', available: true, auth: 'not-required', detail: 'deterministic local TossQuant tool loop only' },
    { name: 'codex', available: Boolean(codex), auth: codex ? 'cli' : 'missing', detail: codex ? `Codex CLI: ${codex}` : 'codex CLI not found in PATH' },
    { name: 'claude', available: Boolean(claude), auth: claude ? 'cli' : 'missing', detail: claude ? `Claude CLI: ${claude}` : 'claude CLI not found in PATH' },
    { name: 'openai', available: Boolean(env.OPENAI_API_KEY), auth: env.OPENAI_API_KEY ? 'env' : 'planned', detail: env.OPENAI_API_KEY ? 'OPENAI_API_KEY is set; direct API adapter is scaffolded for future tool-calling support' : 'set OPENAI_API_KEY or use Codex CLI adapter' },
    { name: 'anthropic', available: Boolean(env.ANTHROPIC_API_KEY), auth: env.ANTHROPIC_API_KEY ? 'env' : 'planned', detail: env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY is set; direct API adapter is scaffolded for future tool-calling support' : 'set ANTHROPIC_API_KEY or use Claude CLI adapter' },
  ];
}

export function providerStatus(name: string, env: NodeJS.ProcessEnv = process.env): ProviderStatus {
  return listProviders(env).find((provider) => provider.name === name) ?? { name: name as LlmProviderName, available: false, auth: 'missing', detail: `unknown provider: ${name}` };
}

export function runProviderPrompt(provider: string, prompt: string): { ok: boolean; provider: string; text?: string; error?: string; returncode?: number } {
  if (!prompt.trim()) return { ok: false, provider, error: 'empty prompt', returncode: 2 };
  if (provider === 'none') return { ok: true, provider, text: '' };
  if (provider === 'codex') {
    const command = hasCommand('codex');
    if (!command) return { ok: false, provider, error: 'codex CLI not found in PATH', returncode: 127 };
    const result = spawnSync(command, ['exec', '--sandbox', 'read-only', '--cd', process.cwd(), prompt], { encoding: 'utf8' });
    const text = filteredCodexOutput(result.stdout ?? '', result.stderr ?? '');
    const code = result.status ?? 1;
    return code === 0 ? { ok: true, provider, text, returncode: code } : { ok: false, provider, text, error: text || result.stderr || result.stdout || `codex exited ${code}`, returncode: code };
  }
  if (provider === 'claude') {
    const command = hasCommand('claude');
    if (!command) return { ok: false, provider, error: 'claude CLI not found in PATH', returncode: 127 };
    const result = spawnSync(command, ['-p', prompt], { encoding: 'utf8' });
    const text = `${result.stdout ?? ''}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
    const code = result.status ?? 1;
    return code === 0 ? { ok: true, provider, text, returncode: code } : { ok: false, provider, text, error: text || `claude exited ${code}`, returncode: code };
  }
  return { ok: false, provider, error: `${provider} direct API/OAuth adapter is not enabled yet; use provider list for setup status`, returncode: 2 };
}

export function providersJson(env: NodeJS.ProcessEnv = process.env): JsonObject {
  return { ok: true, providers: listProviders(env) as unknown as JsonObject[] };
}
