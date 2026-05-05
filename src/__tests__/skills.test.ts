import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listQuantSkills, quantSkillInvocationCandidates } from '../skills.ts';

function writeSkill(root: string, name: string, description: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`, 'utf8');
}

test('TossQuant local skills are discovered from TOSSQUANT_SKILLS_DIR with invocation candidates', () => {
  const skillsRoot = mkdtempSync(join(tmpdir(), 'tq-local-skills-'));
  writeSkill(skillsRoot, 'tossquant-idea-coach', 'Beginner idea coaching');
  writeSkill(skillsRoot, 'tossquant-research-lab', 'Research lab workflow');

  const skills = listQuantSkills({ TOSSQUANT_SKILLS_DIR: skillsRoot });

  assert.deepEqual(skills.map((skill) => skill.name), ['tossquant-idea-coach', 'tossquant-research-lab']);
  assert.match(skills[0]!.description, /Beginner/);
  assert.deepEqual(quantSkillInvocationCandidates({ TOSSQUANT_SKILLS_DIR: skillsRoot }), ['$tossquant-idea-coach', '$tossquant-research-lab']);
});
