import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listCodexSkills, skillInvocationCandidates } from '../skills.ts';

function writeSkill(root: string, name: string, description: string) {
  const dir = join(root, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`, 'utf8');
}

test('codex skills are discovered from CODEX_HOME with invocation candidates', () => {
  const codexHome = mkdtempSync(join(tmpdir(), 'tq-codex-home-'));
  writeSkill(codexHome, 'tossquant-idea-coach', 'Beginner idea coaching');
  writeSkill(codexHome, 'tossquant-research-lab', 'Research lab workflow');

  const skills = listCodexSkills({ CODEX_HOME: codexHome });

  assert.deepEqual(skills.map((skill) => skill.name), ['tossquant-idea-coach', 'tossquant-research-lab']);
  assert.match(skills[0]!.description, /Beginner/);
  assert.deepEqual(skillInvocationCandidates({ CODEX_HOME: codexHome }), ['$tossquant-idea-coach', '$tossquant-research-lab']);
});
