import { runTool, type ToolResult } from './tools.ts';
import { providerStatus, runProviderPrompt } from './providers.ts';
import { ensureQuantSession, recordSessionEvent, sessionEvents, sessionHandoff, redactSessionText, type QuantSession } from './session.ts';
import type { JsonObject } from './storage.ts';
import { normalizeAgentLanguage, type AgentLanguage } from './preferences.ts';

export type AgentOptions = {
  base?: string;
  provider?: string;
  allowDownloads?: boolean;
  sessionId?: string;
  sessionRoot?: string;
  language?: AgentLanguage;
  now?: string;
};

export type AgentRun = {
  ok: boolean;
  request: string;
  session: QuantSession;
  provider: string;
  language: 'ko' | 'en';
  symbols: string[];
  steps: ToolResult[];
  skipped: JsonObject[];
  local_response: string;
  provider_response?: { ok: boolean; provider: string; text?: string; error?: string; returncode?: number };
  report: string;
};

const COMMON_WORDS = new Set(['THE', 'AND', 'FOR', 'WITH', 'FROM', 'THIS', 'THAT', 'WHAT', 'WHY', 'HOW', 'WHEN', 'DATA', 'NEWS', 'IDEA', 'LAB', 'ETF', 'USA', 'API', 'CLI', 'LLM', 'AI']);
const COMPANY_SYMBOL_ALIASES: Array<[RegExp, string]> = [
  [/\bTSMC\b|Taiwan\s+Semiconductor/i, 'TSM'],
  [/삼성전자|Samsung\s+Electronics/i, '005930.KS'],
];

export function extractSymbols(text: string): string[] {
  const aliases = COMPANY_SYMBOL_ALIASES
    .filter(([pattern]) => pattern.test(text))
    .map(([, symbol]) => symbol);
  const candidates = text.match(/\b[A-Z][A-Z0-9.\-]{1,9}\b/g) ?? [];
  return [...new Set([...aliases, ...candidates.filter((item) => !COMMON_WORDS.has(item) && item !== 'TSMC')])].slice(0, 5);
}

function wantsIdea(text: string): boolean {
  return /(?:idea|hypothesis)\s+(?:new|create|add|register)|(?:create|register|save)\s+(?:an?\s+)?(?:idea|hypothesis)|아이디어.*(?:등록|생성|만들|추가|저장)|가설.*(?:등록|생성|만들|추가|저장)/i.test(text);
}

function wantsResearch(text: string): boolean {
  return /research|news|event|earnings|momentum|검증|뉴스|리서치|실적|모멘텀/i.test(text);
}

function wantsLabWorkflow(text: string): boolean {
  return /lab\s+workflow|workflow|worflow|워크플로우/i.test(text);
}

function wantsStrategy(text: string): boolean {
  return /strategy\s+list|list\s+strategies|strategies|전략\s*(?:목록|리스트|종류)|백테스트\s*전략.*(?:보여|알려)/i.test(text);
}

function wantsBacktest(text: string): boolean {
  return /backtest|백테스트|검증 실행/i.test(text);
}

function resolveLanguage(request: string, language: AgentLanguage | undefined): 'ko' | 'en' {
  const preference = normalizeAgentLanguage(language ?? 'auto');
  if (preference === 'ko' || preference === 'en') return preference;
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(request) ? 'ko' : 'en';
}

function ideaReferenceFromText(text: string): string {
  const ideaId = text.match(/\bidea-[a-zA-Z0-9-]+\b/)?.[0];
  if (ideaId) return ideaId;
  if (/\blatest\b|최근|방금|지금/i.test(text)) return 'latest';
  return 'latest';
}

function toolObservation(step: ToolResult): string {
  const text = step.text.trim();
  if (!text) return `- ${step.tool}: ${step.ok ? 'ok' : 'blocked'}`;
  const shortened = text.length > 1600 ? `${text.slice(0, 1599)}…` : text;
  return [`### ${step.tool}`, shortened].join('\n');
}

function nextSafeCommands(run: AgentRun): string[] {
  const blockedWithNext = run.steps.find((step) => !step.ok && typeof step.output.next_command === 'string');
  if (blockedWithNext && typeof blockedWithNext.output.next_command === 'string') return [`- ${blockedWithNext.output.next_command}`];
  const blockedWorkflow = run.steps.find((step) => step.tool === 'lab.workflow' && !step.ok);
  if (blockedWorkflow) {
    return ['- idea list', '- idea new "<your strategy idea>"'];
  }
  if (run.steps.some((step) => step.tool === 'strategy.list')) {
    return ['- backtest run <SYMBOL> --strategy ma-cross'];
  }
  if (run.steps.some((step) => step.tool === 'lab.workflow' && step.ok)) {
    return [
      '- lab discuss latest',
      '- lab verify latest',
      '- lab backtest latest --prompt',
    ];
  }
  if (run.symbols.length) {
    return run.symbols.flatMap((symbol) => [
      `- data info ${symbol}`,
      `- stats ${symbol}`,
      `- research ${symbol} --topic "${run.request.replaceAll('"', '\\"')}"`,
    ]);
  }
  return [];
}

function summarizeRecentEvents(session: QuantSession, language: 'ko' | 'en'): string[] {
  const events = sessionEvents(session)
    .filter((event) => !['agent.run', 'user.request'].includes(String(event.type)))
    .slice(-4);
  if (!events.length) return [];
  return events.map((event) => {
    const type = String(event.type);
    const summary = String(event.summary ?? '').trim();
    const payload = event.payload && typeof event.payload === 'object' ? event.payload as JsonObject : {};
    if (type === 'agent.reply' && typeof payload.request_preview === 'string') {
      return language === 'ko'
        ? `- 이전 에이전트 답변: ${payload.request_preview}`
        : `- previous agent reply to: ${payload.request_preview}`;
    }
    const rawFocus = typeof payload.focus === 'string' ? payload.focus.trim() : '';
    const focus = rawFocus && rawFocus !== summary ? ` · ${rawFocus}` : '';
    return `- ${type}${summary ? `: ${summary}` : ''}${focus}`;
  });
}

function localAgentResponse(run: Omit<AgentRun, 'provider_response' | 'report'>): string {
  const asksNext = /next|what now|뭐해|다음|이제|어떻게/i.test(run.request);
  const asksCounterEvidence = /반례|반증|falsif|counter|disprove/i.test(run.request);
  const asksDiscussion = /논의|대화|discuss|talk/i.test(run.request);
  const asksIdea = /아이디어|가설|idea|hypothesis/i.test(run.request);
  const asksData = /데이터|download|다운|가져오|받|수집|history|price/i.test(run.request);
  const hasWorkflow = run.steps.some((step) => step.tool === 'lab.workflow' && step.ok);
  const hasStrategyList = run.steps.some((step) => step.tool === 'strategy.list' && step.ok);
  const hasMissingData = run.steps.some((step) => !step.ok && typeof step.output.next_command === 'string' && String(step.output.next_command).includes('data download'));

  if (run.language === 'ko') {
    const contextNotes = [
      ...(run.symbols.length && hasMissingData
        ? [`${run.symbols.join(', ')} 로컬 가격 데이터는 아직 준비되지 않았어요. 자동 다운로드는 사용자가 원할 때만 실행하는 쪽이 안전합니다.`]
        : []),
      ...(run.symbols.length && asksData
        ? ['기간은 목적별로 나누면 좋아요: 빠른 이벤트 검증은 1년, 기본 백테스트는 5년 일봉, 장기 사이클 비교는 10년 이상을 추천합니다. 처음이면 5년 일봉부터 시작하세요.']
        : []),
      ...(hasWorkflow
        ? ['workflow latest는 최근 아이디어를 `논의(discuss) → 반례/검증(verify) → 백테스트 설계(backtest)` 순서로 밀어주는 흐름입니다.']
        : []),
      ...(hasStrategyList
        ? ['현재 기본 전략 템플릿은 이동평균 교차, 모멘텀, 평균회귀, 단순 보유 비교처럼 “검증 기준선”으로 쓰는 용도입니다.']
        : []),
    ];
    const guidance = asksCounterEvidence
      ? [
        '반례부터 보면 이렇게 잡을 수 있어요:',
        '- 가격 움직임이 실적/뉴스가 아니라 시장 전체나 섹터 움직임으로 설명되는 경우',
        '- 이벤트 전에 이미 기대가 선반영되어 발표 뒤에는 오히려 평균회귀하는 경우',
        '- 같은 조건을 다른 기간/비슷한 종목에 적용했을 때 효과가 사라지는 경우',
        '- 진입/청산 규칙을 조금만 바꿔도 결과가 뒤집히는 경우',
      ]
      : asksDiscussion || asksIdea
        ? [
          '논의는 이 순서가 좋아요:',
          '- 주장: 어떤 현상이 반복된다고 보는지 한 문장으로 적기',
          '- 데이터: 어떤 종목/기간/가격 데이터를 볼지 정하기',
          '- 대안 설명: 시장/섹터/금리/실적 기대 같은 다른 원인 적기',
          '- 반례: 언제 이 아이디어가 틀렸다고 볼지 정하기',
          '- 검증: 그 다음에만 필요한 명령을 하나씩 실행하기',
        ]
        : [];
    return [
      run.steps.length
        ? '좋아요. 필요한 로컬 상태만 조용히 확인하고, 사람이 읽을 수 있게 정리할게요.'
        : '응. 이 요청은 명령어 가이드가 아니라 agent-chat 대화로 이어서 받을게.',
      '',
      ...(contextNotes.length ? [...contextNotes, ''] : []),
      ...(guidance.length ? [...guidance, ''] : []),
      asksNext
        ? '지금은 새 명령을 많이 따라가기보다, 먼저 “무엇을 검증할지”를 한 문장 가설로 좁히는 게 좋아요. 이어서 자연어로 목표나 걱정되는 부분을 말해주면 그 흐름에 맞춰 필요한 명령만 제안할게.'
        : '계속 자연어로 말해도 됩니다. 필요한 순간에만 데이터 확인, 리서치, 백테스트 같은 실제 명령으로 좁혀서 제안할게.',
    ].join('\n');
  }

  const contextNotes = [
    ...(run.symbols.length && hasMissingData
      ? [`Local price data for ${run.symbols.join(', ')} is not ready yet. Automatic downloads stay off unless you explicitly allow them.`]
      : []),
    ...(run.symbols.length && asksData
      ? ['For periods: use 1y for event checks, 5y daily as the default first backtest window, and 10y+ for long-cycle comparisons. Start with 5y daily if unsure.']
      : []),
    ...(hasWorkflow
      ? ['`workflow latest` means: discuss the idea, verify/falsify it, then turn it into a backtest plan.']
      : []),
    ...(hasStrategyList
      ? ['The built-in strategy templates are baseline checks: moving-average cross, momentum, mean reversion, and buy-hold.']
      : []),
  ];
  const guidance = asksCounterEvidence
    ? [
      'Useful counter-evidence to check:',
      '- the move is explained by the broad market or sector instead of the event',
      '- expectations were priced in before the event and price mean-reverts afterward',
      '- the effect disappears in other periods or comparable symbols',
      '- small entry/exit rule changes flip the result',
    ]
    : asksDiscussion || asksIdea
      ? [
        'A good discussion order is:',
        '- claim: state the repeated behavior in one sentence',
        '- data: choose symbols, dates, and price inputs',
        '- alternatives: list market, sector, rates, and expectation explanations',
        '- falsification: decide what would make the idea wrong',
        '- verification: run only the next command that answers the current uncertainty',
      ]
      : [];
  return [
    run.steps.length
      ? 'Got it. I checked only the local state needed and will keep the answer readable.'
      : 'Got it. I will continue this as an agent-chat conversation, not as a command checklist.',
    '',
    ...(contextNotes.length ? [...contextNotes, ''] : []),
    ...(guidance.length ? [...guidance, ''] : []),
    asksNext
      ? 'Before adding more commands, narrow what you want to verify into one testable hypothesis. Keep speaking naturally and I will suggest only the next useful command when it is needed.'
      : 'You can keep speaking naturally. I will translate the discussion into data, research, or backtest commands only when useful.',
  ].join('\n');
}

function safeProviderPrompt(run: Omit<AgentRun, 'provider_response' | 'report'>): string {
  const languageInstruction = run.language === 'ko'
    ? 'Return Korean beginner guidance. Keep command names exactly as QuantOps commands.'
    : 'Return English beginner guidance. Keep command names exactly as QuantOps commands.';
  return [
    'You are inside QuantOps-cli as a safe quant research assistant.',
    'Use the local tool observations below. Do not give buy/sell/hold advice, do not produce a single trade score, and do not suggest live trading mutations.',
    `${languageInstruction} Continue the conversation naturally first. Suggest only the minimum next QuantOps command when it is truly useful; do not dump a generic checklist.`,
    '',
    'Session handoff:',
    sessionHandoff(run.session),
    '',
    'User request preview:',
    run.request,
    '',
    'Tool observations JSON:',
    JSON.stringify({ symbols: run.symbols, steps: run.steps.map((step) => ({ tool: step.tool, ok: step.ok, output: step.output })), skipped: run.skipped }, null, 2),
  ].join('\n');
}

function formatAgentReport(run: AgentRun): string {
  const reply = run.provider_response?.ok && run.provider_response.text?.trim()
    ? redactSessionText(run.provider_response.text.trim())
    : redactSessionText(run.local_response);
  if (run.language === 'ko') {
    const lines = [
      reply,
      ...(run.provider_response?.error ? ['', '제공자 상태', `- ${redactSessionText(run.provider_response.error)}`] : []),
    ];
    return lines.join('\n');
  }
  const lines = [
    reply,
    ...(run.provider_response?.error ? ['', 'Provider status', `- ${redactSessionText(run.provider_response.error)}`] : []),
  ];
  return lines.join('\n');
}

export async function runAgent(request: string, options: AgentOptions = {}): Promise<AgentRun> {
  const cleaned = request.trim();
  if (!cleaned) throw new Error('agent request is required');
  const provider = options.provider || 'none';
  const requestPreview = redactSessionText(cleaned).slice(0, 160);
  const language = resolveLanguage(requestPreview, options.language);
  const session = ensureQuantSession({ id: options.sessionId, title: requestPreview.slice(0, 80), root: options.sessionRoot, now: options.now });
  recordSessionEvent(session, { at: options.now, type: 'user.request', summary: requestPreview, payload: { provider, language, allow_downloads: Boolean(options.allowDownloads) } });
  const symbols = extractSymbols(requestPreview);
  const steps: ToolResult[] = [];
  const skipped: JsonObject[] = [];

  if (wantsIdea(cleaned)) {
    const idea = await runTool('idea.create', { title: requestPreview, ...(symbols[0] ? { symbol: symbols[0] } : {}) }, { base: options.base });
    steps.push(idea);
  }

  if (wantsLabWorkflow(cleaned)) {
    steps.push(await runTool('lab.workflow', { idea: ideaReferenceFromText(cleaned) }, { base: options.base }));
  }

  if (wantsStrategy(cleaned) && !symbols.length) {
    steps.push(await runTool('strategy.list', {}, { base: options.base }));
  }

  for (const symbol of symbols) {
    const info = await runTool('data.info', { symbol }, { base: options.base });
    steps.push(info);
    if (!info.ok && options.allowDownloads) {
      steps.push(await runTool('data.download', { symbol, source: 'yahoo' }, { base: options.base }));
    } else if (!info.ok) {
      skipped.push({ tool: 'data.download', symbol, reason: 'not run without --download because it writes local files and may use the network' });
    }
    steps.push(await runTool('data.validate', { symbol }, { base: options.base }));
    steps.push(await runTool('stats.run', { symbol, source: 'yahoo' }, { base: options.base }));
    if (wantsResearch(cleaned)) steps.push(await runTool('research.run', { symbol, topic: requestPreview }, { base: options.base }));
    if (wantsBacktest(cleaned)) steps.push(await runTool('backtest.run', { symbol, strategy: 'ma-cross', source: 'yahoo' }, { base: options.base }));
  }

  const partialWithoutResponse: Omit<AgentRun, 'local_response' | 'provider_response' | 'report'> = { ok: true, request: requestPreview, session, provider, language, symbols, steps, skipped };
  const localResponse = localAgentResponse({ ...partialWithoutResponse, local_response: '' });
  const partial: Omit<AgentRun, 'provider_response' | 'report'> = { ...partialWithoutResponse, local_response: localResponse };
  const status = providerStatus(provider);
  const rawProviderResponse = provider !== 'none' && status.available ? runProviderPrompt(provider, safeProviderPrompt(partial)) : undefined;
  const providerResponse = rawProviderResponse ? { ...rawProviderResponse, text: rawProviderResponse.text ? redactSessionText(rawProviderResponse.text) : undefined, error: rawProviderResponse.error ? redactSessionText(rawProviderResponse.error) : undefined } : undefined;
  const run: AgentRun = { ...partial, ok: true, provider_response: providerResponse, report: '' };
  run.report = formatAgentReport(run);
  recordSessionEvent(session, {
    at: options.now,
    type: 'agent.run',
    summary: `${symbols.join(', ') || 'no-symbol'} · ${steps.length} tools · ${skipped.length} skipped`,
    payload: { request_preview: requestPreview, provider, symbols, steps: steps.map((step) => ({ tool: step.tool, ok: step.ok })), skipped },
  });
  const providerReply = providerResponse?.ok && providerResponse.text?.trim() ? providerResponse.text.trim() : '';
  const replySummary = providerReply
    ? providerReply.replace(/\s+/g, ' ').slice(0, 180)
    : (language === 'ko' ? `대화 응답: ${requestPreview}` : `conversation reply: ${requestPreview}`);
  recordSessionEvent(session, {
    at: options.now,
    type: 'agent.reply',
    summary: redactSessionText(replySummary),
    payload: {
      provider,
      source: providerReply ? 'provider' : 'local',
      request_preview: requestPreview,
    },
  });
  return run;
}
