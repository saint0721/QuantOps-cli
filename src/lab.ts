import { join } from 'node:path';
import { ideaStatus, type IdeaStatusReport } from './idea.ts';
import { appendJsonl, redact, utcNow, type JsonObject, type JsonValue } from './storage.ts';
import type { ResearchCodexResult, ResearchCodexRunner } from './research.ts';

export type LabStage = 'discuss' | 'verify' | 'backtest';

export type LabOptions = {
  base?: string;
  save?: boolean;
  now?: string;
};

export type LabRun = {
  ok: boolean;
  stage: LabStage;
  created_at: string;
  idea: IdeaStatusReport['idea'];
  readiness: IdeaStatusReport['readiness'];
  prompt: string;
  report: string;
  codex?: ResearchCodexResult;
  saved_to?: string;
};

const STAGE_LABELS: Record<LabStage, string> = {
  discuss: 'discussion and research planning',
  verify: 'critical verification and falsification',
  backtest: 'backtest implementation brief',
};

export function labReportPath(ideaId: string, base = 'data'): string {
  return join(base, 'lab', `${ideaId}.jsonl`);
}

function safetyRules(): string[] {
  return [
    '- Do not provide buy/sell/hold advice.',
    '- Do not produce a single numeric trade score.',
    '- Do not place, preview, or suggest live order mutations.',
    '- Keep claims probabilistic; separate evidence from inference.',
    '- Treat this as beginner education and research workflow design.',
  ];
}

function ideaContextJson(status: IdeaStatusReport): JsonObject {
  return redact({
    idea: status.idea,
    readiness: status.readiness,
    next_commands: status.next_commands,
  } as unknown as JsonValue) as JsonObject;
}

export function buildLabPrompt(status: IdeaStatusReport, stage: LabStage): string {
  const context = ideaContextJson(status);
  const stageInstructions: Record<LabStage, string[]> = {
    discuss: [
      'Act as a quant research discussion swarm lead.',
      'Turn the idea into concrete research questions, missing evidence, search terms, and a safe investigation sequence.',
      'Recommend which TossQuant commands should be run next and what each command is expected to prove or disprove.',
    ],
    verify: [
      'Act as a skeptical quant verifier swarm lead.',
      'Challenge the hypothesis, identify confounders, data leakage risks, survivorship bias, cherry-picking, and missing controls.',
      'Return a pass/block/needs-data checklist. Do not approve any live trading action.',
    ],
    backtest: [
      'Act as a backtest implementation swarm lead.',
      'Write a coding brief for a future deterministic backtest module using the local TossQuant data model.',
      'Include inputs, strategy rules to parameterize, metrics, leakage checks, fixtures, and tests. Do not write live trading code.',
    ],
  };
  return [
    `You are helping TossQuant-cli run the "${STAGE_LABELS[stage]}" stage for a saved quant idea.`,
    '',
    'Safety rules:',
    ...safetyRules(),
    '',
    'Stage instructions:',
    ...stageInstructions[stage].map((item) => `- ${item}`),
    '',
    'Return sections:',
    '1. What we know from local state',
    '2. Missing evidence / blockers',
    '3. Agent-swarm task split',
    '4. Verification criteria',
    '5. Next TossQuant commands',
    '',
    'Redacted TossQuant idea context JSON:',
    JSON.stringify(context, null, 2),
  ].join('\n');
}

function readinessLine(item: IdeaStatusReport['readiness'][number]): string {
  const gates = [
    `market=${item.market_data}`,
    `validation=${item.validation}`,
    `research=${item.research}`,
  ].join(' ');
  return `- ${item.symbol}: ${gates}`;
}

function deterministicReport(status: IdeaStatusReport, stage: LabStage, codex?: ResearchCodexResult): string {
  const idea = status.idea;
  const hasSymbols = idea.symbols.length > 0;
  const hasHypotheses = idea.hypotheses.length > 0;
  const blocked = [
    hasSymbols ? null : 'Add at least one symbol.',
    hasHypotheses ? null : 'Add at least one hypothesis.',
    ...status.readiness.flatMap((item) => [
      item.market_data === 'ready' ? null : `Download market data for ${item.symbol}.`,
      item.validation === 'pass' ? null : `Validate/fix market data for ${item.symbol}.`,
      item.research === 'saved' ? null : `Run external-factor research for ${item.symbol}.`,
    ]),
  ].filter(Boolean) as string[];
  const stageNext: Record<LabStage, string[]> = {
    discuss: [
      `lab verify ${idea.id} --no-codex`,
      ...status.next_commands,
    ],
    verify: [
      `lab backtest ${idea.id} --no-codex`,
      ...status.next_commands,
    ],
    backtest: [
      `stats ${idea.symbols[0] ?? 'AAPL'}`,
      `audit ${idea.symbols[0] ?? 'AAPL'}`,
    ],
  };
  return [
    `Lab ${stage}: ${idea.title}`,
    `id: ${idea.id}`,
    '',
    'Idea state',
    `- status: ${idea.status}`,
    `- symbols: ${idea.symbols.join(', ') || 'none'}`,
    `- hypotheses: ${idea.hypotheses.length ? idea.hypotheses.length : 'none'}`,
    '',
    'Readiness gates',
    ...(status.readiness.length ? status.readiness.map(readinessLine) : ['- no symbols yet']),
    '',
    'Blocking gaps',
    ...(blocked.length ? blocked.map((item) => `- ${item}`) : ['- none detected in local state']),
    '',
    `${STAGE_LABELS[stage]} output`,
    codex?.ok && codex.text?.trim()
      ? codex.text.trim()
      : `- Codex discussion was not run${codex?.error ? `: ${codex.error}` : ''}. Use --prompt to copy the exact prompt into Codex/Claude, or rerun without --no-codex.`,
    '',
    'Next TossQuant commands',
    ...[...new Set(stageNext[stage])].map((cmd) => `- ${cmd}`),
  ].join('\n');
}

export function runLabStage(stage: LabStage, ideaRef: string, options: LabOptions = {}, codexRunner?: ResearchCodexRunner): LabRun {
  const base = options.base ?? 'data';
  const createdAt = options.now ?? utcNow();
  const status = ideaStatus(base, ideaRef);
  const prompt = buildLabPrompt(status, stage);
  const codex = codexRunner ? codexRunner(prompt) : { ok: false, error: 'codex runner not configured' };
  const report = deterministicReport(status, stage, codex);
  const run: LabRun = {
    ok: true,
    stage,
    created_at: createdAt,
    idea: status.idea,
    readiness: status.readiness,
    prompt,
    report,
    codex,
  };
  if (options.save !== false) {
    const path = labReportPath(status.idea.id, base);
    appendJsonl(path, redact(run as unknown as JsonValue) as JsonObject);
    run.saved_to = path;
  }
  return run;
}

export function formatLabRun(run: LabRun, options: { promptOnly?: boolean } = {}): string {
  if (options.promptOnly) return run.prompt;
  return [
    run.report,
    run.saved_to ? ['', `saved_to: ${run.saved_to}`].join('\n') : '',
  ].filter(Boolean).join('\n');
}

export function formatLabWorkflow(status: IdeaStatusReport): string {
  const idea = status.idea;
  return [
    `Lab workflow: ${idea.title}`,
    `id: ${idea.id}`,
    '',
    '1. discuss',
    `   quant lab discuss ${idea.id} --no-codex`,
    '   Turn the idea into research questions, search tasks, and evidence requirements.',
    '',
    '2. verify',
    `   quant lab verify ${idea.id} --no-codex`,
    '   Challenge the hypothesis, check blockers, and define pass/fail gates.',
    '',
    '3. backtest',
    `   quant lab backtest ${idea.id} --no-codex`,
    '   Produce a safe coding brief for a future deterministic backtest module.',
    '',
    'Current readiness',
    ...(status.readiness.length ? status.readiness.map(readinessLine) : ['- no symbols yet']),
    '',
    'Next data/research commands',
    ...status.next_commands.map((cmd) => `- ${cmd}`),
  ].join('\n');
}
