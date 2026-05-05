import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type CodexSkill = {
  name: string;
  description: string;
  path: string;
};

function unquoteYamlString(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSkillFile(path: string): CodexSkill | null {
  const text = readFileSync(path, 'utf8');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const metadata = new Map<string, string>();
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) metadata.set(match[1]!, unquoteYamlString(match[2] ?? ''));
  }
  const name = metadata.get('name')?.trim();
  if (!name) return null;
  return { name, description: metadata.get('description')?.trim() ?? '', path };
}

function skillRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const codexHome = env.CODEX_HOME || join(homedir(), '.codex');
  return [join(codexHome, 'skills'), join(codexHome, 'skills', '.system')];
}

export function listCodexSkills(env: NodeJS.ProcessEnv = process.env): CodexSkill[] {
  const seen = new Set<string>();
  const skills: CodexSkill[] = [];
  for (const root of skillRoots(env)) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name, 'SKILL.md');
      if (!existsSync(path)) continue;
      try {
        const skill = parseSkillFile(path);
        if (skill && !seen.has(skill.name)) {
          skills.push(skill);
          seen.add(skill.name);
        }
      } catch {
        // Invalid skills should not break the TossQuant CLI skills list.
      }
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function skillInvocationCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  return listCodexSkills(env).map((skill) => `$${skill.name}`);
}
