import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, type JsonObject } from './storage.ts';

export type AgentLanguage = 'auto' | 'ko' | 'en';

export type AgentPreferences = {
  language: AgentLanguage;
};

const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
  language: 'auto',
};

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

export function readAgentPreferences(base = 'data'): AgentPreferences {
  const path = agentPreferencesPath(base);
  if (!existsSync(path)) return { ...DEFAULT_AGENT_PREFERENCES };
  const payload = JSON.parse(readFileSync(path, 'utf8')) as JsonObject;
  return {
    language: normalizeAgentLanguage(String(payload.language ?? DEFAULT_AGENT_PREFERENCES.language)),
  };
}

export function writeAgentLanguage(base: string, language: AgentLanguage): AgentPreferences {
  const prefs = { ...readAgentPreferences(base), language };
  writeFileSync(agentPreferencesPath(base), `${JSON.stringify(prefs, null, 2)}\n`, 'utf8');
  return prefs;
}

export function formatAgentLanguagePreference(prefs: AgentPreferences): string {
  const label = prefs.language === 'auto' ? 'auto (Korean input → Korean, otherwise English)' : prefs.language;
  return [
    'Agent language preference',
    `current: ${label}`,
    '',
    'Set with:',
    '- /agent lang ko',
    '- /agent lang en',
    '- /agent lang auto',
    '',
    'Per request override:',
    '- /agent "workflow latest가 뭐야" --lang ko',
  ].join('\n');
}
