import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, type JsonObject } from './storage.ts';

export type AgentLanguage = 'auto' | 'ko' | 'en';
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export type AgentPreferences = {
  language: AgentLanguage;
  codex_model?: string;
  codex_effort?: CodexReasoningEffort;
};

const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
  language: 'auto',
};

export const CODEX_MODEL_CHOICES = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2'] as const;
export const CODEX_EFFORT_CHOICES: CodexReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];

export function agentPreferencesPath(base = 'data'): string {
  return join(dataDir(base), 'agent-preferences.json');
}

export function normalizeAgentLanguage(value: string | undefined): AgentLanguage {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'ko' || normalized === 'kr' || normalized === 'korean' || normalized === '한국어') return 'ko';
  if (normalized === 'en' || normalized === 'eng' || normalized === 'english' || normalized === '영어') return 'en';
  if (normalized === 'auto' || normalized === '자동' || normalized === '') return 'auto';
  throw new Error('agent language must be one of: auto, ko, en');
}

export function normalizeCodexModel(value: string | undefined): string | undefined {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized === 'default' || normalized === '기본') return undefined;
  return normalized;
}

export function normalizeCodexEffort(value: string | undefined): CodexReasoningEffort | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'default' || normalized === '기본') return undefined;
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh') return normalized;
  throw new Error('codex effort must be one of: low, medium, high, xhigh');
}

export function readAgentPreferences(base = 'data'): AgentPreferences {
  const path = agentPreferencesPath(base);
  if (!existsSync(path)) return { ...DEFAULT_AGENT_PREFERENCES };
  const payload = JSON.parse(readFileSync(path, 'utf8')) as JsonObject;
  return {
    language: normalizeAgentLanguage(String(payload.language ?? DEFAULT_AGENT_PREFERENCES.language)),
    codex_model: normalizeCodexModel(typeof payload.codex_model === 'string' ? payload.codex_model : undefined),
    codex_effort: normalizeCodexEffort(typeof payload.codex_effort === 'string' ? payload.codex_effort : undefined),
  };
}

export function writeAgentPreferences(base: string, prefs: AgentPreferences): AgentPreferences {
  const normalized: AgentPreferences = {
    language: normalizeAgentLanguage(prefs.language),
    codex_model: normalizeCodexModel(prefs.codex_model),
    codex_effort: normalizeCodexEffort(prefs.codex_effort),
  };
  writeFileSync(agentPreferencesPath(base), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export function writeAgentLanguage(base: string, language: AgentLanguage): AgentPreferences {
  const prefs = { ...readAgentPreferences(base), language };
  return writeAgentPreferences(base, prefs);
}

export function writeCodexModel(base: string, model: string | undefined): AgentPreferences {
  const prefs = { ...readAgentPreferences(base), codex_model: normalizeCodexModel(model) };
  return writeAgentPreferences(base, prefs);
}

export function writeCodexEffort(base: string, effort: string | undefined): AgentPreferences {
  const prefs = { ...readAgentPreferences(base), codex_effort: normalizeCodexEffort(effort) };
  return writeAgentPreferences(base, prefs);
}

export function writeCodexModelAndEffort(base: string, model: string | undefined, effort: string | undefined): AgentPreferences {
  const prefs = { ...readAgentPreferences(base), codex_model: normalizeCodexModel(model), codex_effort: normalizeCodexEffort(effort) };
  return writeAgentPreferences(base, prefs);
}

export function formatAgentLanguagePreference(prefs: AgentPreferences): string {
  const label = prefs.language === 'auto' ? 'auto (Korean input → Korean, otherwise English)' : prefs.language;
  return [
    'Agent language preference',
    `current: ${label}`,
    '',
    'Set with:',
    '- agent ko',
    '- agent en',
    '- agent auto',
    '- interactive shortcut still works: /agent ko',
    '',
    'In interactive mode, plain chat text is automatically handled by the shared agent-chat session.',
  ].join('\n');
}

export function formatCodexModelPreference(prefs: AgentPreferences): string {
  return [
    'Codex 모델 설정',
    `현재 모델: ${prefs.codex_model ?? '기본값(config.toml)'}`,
    `현재 effort: ${prefs.codex_effort ?? '기본값(config.toml)'}`,
    '',
    '모델 선택:',
    `- /model ${CODEX_MODEL_CHOICES.join('|')}`,
    '- /model default',
    '',
    'effort 선택:',
    `- /model effort ${CODEX_EFFORT_CHOICES.join('|')}`,
    '- /model <MODEL> <EFFORT>',
    '',
    '적용 범위: /agent --provider codex, /codex 모드, $스킬 Codex 호출',
  ].join('\n');
}
