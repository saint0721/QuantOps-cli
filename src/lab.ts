import { join } from 'node:path';
import { ideaStatus, type IdeaStatusReport } from './idea.ts';
import { appendJsonl, redact, utcNow, type JsonObject, type JsonValue } from './storage.ts';


export type LabStage = 'discuss' | 'verify' | 'backtest';

export type LabOptions = {
  base?: string;
  save?: boolean;
  focus?: string;
  now?: string;
};

export type LabRun = {
  ok: boolean;
  stage: LabStage;
  created_at: string;
  idea: IdeaStatusReport['idea'];
  readiness: IdeaStatusReport['readiness'];
  focus?: string;
  prompt: string;
  report: string;
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

export function buildLabPrompt(status: IdeaStatusReport, stage: LabStage, focus = ''): string {
  const context = ideaContextJson(status);
  const stageInstructions: Record<LabStage, string[]> = {
    discuss: [
      'Act as a quant research discussion swarm lead.',
      'Turn the idea into concrete research questions, missing evidence, search terms, and a safe investigation sequence.',
      'Recommend which QuantOps commands should be run next and what each command is expected to prove or disprove.',
    ],
    verify: [
      'Act as a skeptical quant verifier swarm lead.',
      'Challenge the hypothesis, identify confounders, data leakage risks, survivorship bias, cherry-picking, and missing controls.',
      'Return a pass/block/needs-data checklist. Do not approve any live trading action.',
    ],
    backtest: [
      'Act as a backtest implementation swarm lead.',
      'Write a coding brief for a future deterministic backtest module using the local QuantOps data model.',
      'Include inputs, strategy rules to parameterize, metrics, leakage checks, fixtures, and tests. Do not write live trading code.',
    ],
  };
  return [
    `You are helping QuantOps-cli run the "${STAGE_LABELS[stage]}" stage for a saved quant idea.`,
    '',
    'Safety rules:',
    ...safetyRules(),
    '',
    'Stage instructions:',
    ...stageInstructions[stage].map((item) => `- ${item}`),
    ...(focus.trim() ? ['', 'User discussion focus:', focus.trim()] : []),
    '',
    'Return sections:',
    '1. What we know from local state',
    '2. Missing evidence / blockers',
    '3. Agent-swarm task split',
    '4. Verification criteria',
    '5. Next QuantOps commands',
    '',
    'Redacted QuantOps idea context JSON:',
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

function discussionOutput(status: IdeaStatusReport, focus: string): string[] {
  const idea = status.idea;
  const target = focus.trim();
  if (!target) {
    return [
      '- 아직 논의 주제가 없습니다.',
      '- Codex에게 자연어로 논의한 뒤, 필요한 순간 아래처럼 rtk 명령으로 프롬프트/검증 재료를 꺼내세요:',
      `  rtk lab discuss ${idea.id} "NVDA 실적 모멘텀이 가격에 반영되는지 검증하고 싶어"`,
      `  rtk lab discuss latest "뉴스 이벤트와 이동평균 백테스트를 연결해서 보고 싶어"`,
      '- 이 결과를 Codex가 읽고 다음 rtk ... --json 명령으로 검증을 이어갑니다.',
    ];
  }
  return [
    `- 논의 주제: ${target}`,
    '- 먼저 이 주제를 가설/데이터/검증 기준으로 나눠 봅니다.',
    `- 가설화: "${target}"를 숫자로 확인 가능한 조건으로 바꿔야 합니다.`,
    '- 필요한 증거: 저장된 OHLCV 데이터, 이벤트/뉴스 맥락, 비교 기준, 실패 조건.',
    '- 주의점: 매수/매도 결론이 아니라 검증 가능한 연구 질문으로 유지합니다.',
    '',
    'Next rtk commands',
    `- rtk lab verify ${idea.id} --prompt`,
    `- rtk backtest run ${idea.symbols[0] ?? 'latest'} --strategy ma-cross --json`,
  ];
}

function deterministicReport(status: IdeaStatusReport, stage: LabStage, focus: string): string {
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
      `lab verify ${idea.id}`,
      ...status.next_commands,
    ],
    verify: [
      `lab backtest ${idea.id}`,
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
    ...(focus.trim() ? [`- discussion_focus: ${focus.trim()}`] : []),
    '',
    'Readiness gates',
    ...(status.readiness.length ? status.readiness.map(readinessLine) : ['- no symbols yet']),
    '',
    'Blocking gaps',
    ...(blocked.length ? blocked.map((item) => `- ${item}`) : ['- none detected in local state']),
    '',
    `${STAGE_LABELS[stage]} output`,
    stage === 'discuss'
      ? discussionOutput(status, focus).join('\n')
      : '- Use the prompt form with Codex, then feed any chosen next step back through rtk ... --json.',
    '',
    'Next QuantOps commands',
    ...[...new Set(stageNext[stage])].map((cmd) => `- rtk ${cmd}${cmd.includes('--json') ? '' : ' --json'}`),
  ].join('\n');
}

export function runLabStage(stage: LabStage, ideaRef: string, options: LabOptions = {}): LabRun {
  const base = options.base ?? 'data';
  const createdAt = options.now ?? utcNow();
  const focus = options.focus?.trim() ?? '';
  const status = ideaStatus(base, ideaRef);
  const prompt = buildLabPrompt(status, stage, focus);
  const report = deterministicReport(status, stage, focus);
  const run: LabRun = {
    ok: true,
    stage,
    created_at: createdAt,
    idea: status.idea,
    readiness: status.readiness,
    focus: focus || undefined,
    prompt,
    report,
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
    `   rtk lab discuss ${idea.id} --prompt`,
    '   Turn the idea into research questions, search tasks, and evidence requirements.',
    '',
    '2. verify',
    `   rtk lab verify ${idea.id} --prompt`,
    '   Challenge the hypothesis, check blockers, and define pass/fail gates.',
    '',
    '3. backtest',
    `   rtk lab backtest ${idea.id} --prompt`,
    '   Produce a safe coding brief for a future deterministic backtest module.',
    '',
    'Current readiness',
    ...(status.readiness.length ? status.readiness.map(readinessLine) : ['- no symbols yet']),
    '',
    'Next data/research commands',
    ...status.next_commands.map((cmd) => `- rtk ${cmd}`),
  ].join('\n');
}
