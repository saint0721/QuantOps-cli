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

test('QuantOps local skills are discovered from QUANTOPS_SKILLS_DIR with invocation candidates', () => {
  const skillsRoot = mkdtempSync(join(tmpdir(), 'tq-local-skills-'));
  writeSkill(skillsRoot, 'quantops-idea-coach', 'Beginner idea coaching');
  writeSkill(skillsRoot, 'quantops-research-lab', 'Research lab workflow');

  const skills = listQuantSkills({ QUANTOPS_SKILLS_DIR: skillsRoot });

  assert.deepEqual(skills.map((skill) => skill.name), ['quantops-idea-coach', 'quantops-research-lab']);
  assert.match(skills[0]!.description, /Beginner/);
  assert.deepEqual(quantSkillInvocationCandidates({ QUANTOPS_SKILLS_DIR: skillsRoot }), ['$quantops-idea-coach', '$quantops-research-lab']);
});

test('repository QuantOps skills cover agent runtime and backtest readiness workflows', () => {
  const skills = listQuantSkills({});
  const names = skills.map((skill) => skill.name);

  assert.ok(names.includes('quantops-agent-runtime'));
  assert.ok(names.includes('quantops-data-backtest-check'));
  assert.ok(names.includes('quantops-idea-coach'));
  assert.ok(names.includes('quantops-research-lab'));
  assert.match(skills.find((skill) => skill.name === 'quantops-agent-runtime')!.description, /rtk-based CLI harness/);
  assert.match(skills.find((skill) => skill.name === 'quantops-data-backtest-check')!.description, /before backtesting/);
  assert.ok(quantSkillInvocationCandidates({}).includes('$quantops-agent-runtime'));
  assert.ok(quantSkillInvocationCandidates({}).includes('$quantops-data-backtest-check'));
});
