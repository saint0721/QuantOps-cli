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

export function extractSymbols(text: string): string[] {
  const candidates = text.match(/\b[A-Z][A-Z0-9.\-]{1,9}\b/g) ?? [];
  return [...new Set(candidates.filter((item) => !COMMON_WORDS.has(item)))].slice(0, 5);
}

function wantsIdea(text: string): boolean {
  return /idea|hypothesis|아이디어|가설/i.test(text);
}

function wantsResearch(text: string): boolean {
  return /research|news|event|earnings|momentum|검증|뉴스|리서치|실적|모멘텀/i.test(text);
}

function wantsLabWorkflow(text: string): boolean {
  return /lab\s+workflow|workflow|worflow|워크플로우|흐름/i.test(text);
}

function wantsStrategy(text: string): boolean {
  return /strategy|strategies|전략/i.test(text);
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
    return ['- backtest run <SYMBOL> --strategy ma-cross', '- idea new "<your strategy idea>"'];
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
  return ['- idea new "<your strategy idea>"'];
}

function summarizeRecentEvents(session: QuantSession): string[] {
  const events = sessionEvents(session)
    .filter((event) => !['agent.run', 'user.request'].includes(String(event.type)))
    .slice(-4);
  if (!events.length) return [];
  return events.map((event) => {
    const type = String(event.type);
    const summary = String(event.summary ?? '').trim();
    const payload = event.payload && typeof event.payload === 'object' ? event.payload as JsonObject : {};
    const rawFocus = typeof payload.focus === 'string' ? payload.focus.trim() : '';
    const focus = rawFocus && rawFocus !== summary ? ` · ${rawFocus}` : '';
    return `- ${type}${summary ? `: ${summary}` : ''}${focus}`;
  });
}

function localAgentResponse(run: Omit<AgentRun, 'provider_response' | 'report'>): string {
  const recent = summarizeRecentEvents(run.session);
  const commandExamples = nextSafeCommands({ ...run, ok: true, provider_response: undefined, report: '' });
  const toolSummary = run.steps.length
    ? run.steps.map((step) => `- ${step.tool}: ${step.ok ? (run.language === 'ko' ? '완료' : 'ok') : (run.language === 'ko' ? '차단됨' : 'blocked')}`)
    : [];
  const asksNext = /next|what now|뭐해|다음|이제|어떻게/i.test(run.request);

  if (run.language === 'ko') {
    return [
      run.steps.length
        ? '좋아. 로컬 도구 결과를 바탕으로 대화를 이어갈게.'
        : '좋아. 이 요청은 도구 실행 없이 agent-chat 대화로 이어갈게.',
      '',
      ...(recent.length ? ['최근 이어받은 맥락', ...recent, ''] : ['최근 이어받은 맥락', '- 아직 저장된 논의 맥락이 많지 않습니다. 지금 질문부터 agent-chat 세션에 계속 누적할게.', '']),
      ...(toolSummary.length ? ['이번에 확인한 것', ...toolSummary, ''] : []),
      asksNext
        ? '다음 단계는 아이디어를 검증 가능한 가설로 좁히고, 필요한 데이터/전략/백테스트 명령으로 연결하는 것입니다.'
        : '자연어로 계속 말해도 됩니다. 내가 필요한 경우 아이디어, 리서치, 데이터 확인, 백테스트 명령으로 바꿔서 안내할게.',
      '',
      '바로 이어서 이렇게 물어볼 수 있어요:',
      '- /agent 이 논의 주제를 검증 가능한 가설로 바꿔줘',
      '- /agent 필요한 데이터와 백테스트 전략을 추천해줘',
      ...commandExamples.slice(0, 3),
    ].join('\n');
  }

  return [
    run.steps.length
      ? 'Got it. I will continue the conversation from the local tool results.'
      : 'Got it. I will treat this as an agent-chat conversation even though no local tools were needed.',
    '',
    ...(recent.length ? ['Recent carried context', ...recent, ''] : ['Recent carried context', '- There is not much saved discussion context yet. I will keep adding from this agent-chat session.', '']),
    ...(toolSummary.length ? ['What I checked this turn', ...toolSummary, ''] : []),
    asksNext
      ? 'A useful next step is to narrow the idea into a testable hypothesis, then connect it to data, strategy choice, and a backtest command.'
      : 'You can keep speaking naturally. I will translate the discussion into idea, research, data-check, or backtest commands when useful.',
    '',
    'Try next:',
    '- /agent turn this discussion into a testable hypothesis',
    '- /agent recommend the data and backtest strategy I need',
    ...commandExamples.slice(0, 3),
  ].join('\n');
}

function safeProviderPrompt(run: Omit<AgentRun, 'provider_response' | 'report'>): string {
  const languageInstruction = run.language === 'ko'
    ? 'Return Korean beginner guidance. Keep command names exactly as TossQuant commands.'
    : 'Return English beginner guidance. Keep command names exactly as TossQuant commands.';
  return [
    'You are inside TossQuant-cli as a safe quant research assistant.',
    'Use the local tool observations below. Do not give buy/sell/hold advice, do not produce a single trade score, and do not suggest live trading mutations.',
    `${languageInstruction} Include: local evidence, missing evidence, next TossQuant commands, and verification cautions.`,
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
  if (run.language === 'ko') {
    const lines = [
      `에이전트 실행: ${run.request}`,
      `세션: ${run.session.id}`,
      `제공자: ${run.provider}`,
      `언어: ko`,
      `감지된 종목: ${run.symbols.join(', ') || '없음'}`,
      '',
      '도구 실행',
      ...(run.steps.length ? run.steps.map((step, index) => `${index + 1}. ${step.tool}: ${step.ok ? '완료' : '차단됨'}`) : ['- 없음']),
      ...(run.steps.length ? ['', '로컬 도구 출력', ...run.steps.map(toolObservation)] : []),
      ...(run.skipped.length ? ['', '건너뜀 / 권한 필요', ...run.skipped.map((item) => `- ${String(item.tool)}: ${String(item.reason)}`)] : []),
      '',
      '에이전트 답변',
      run.provider_response?.ok && run.provider_response.text?.trim()
        ? redactSessionText(run.provider_response.text.trim())
        : redactSessionText(run.local_response),
      ...(run.provider_response?.error ? ['', '제공자 상태', `- ${redactSessionText(run.provider_response.error)}`] : []),
      '',
      '다음 안전 명령',
      ...nextSafeCommands(run),
    ];
    return lines.join('\n');
  }
  const lines = [
    `Agent run: ${run.request}`,
    `session: ${run.session.id}`,
    `provider: ${run.provider}`,
    `language: en`,
    `symbols: ${run.symbols.join(', ') || 'none detected'}`,
    '',
    'Tool steps',
    ...(run.steps.length ? run.steps.map((step, index) => `${index + 1}. ${step.tool}: ${step.ok ? 'ok' : 'blocked'}`) : ['- none']),
    ...(run.steps.length ? ['', 'Local tool output', ...run.steps.map(toolObservation)] : []),
    ...(run.skipped.length ? ['', 'Skipped / needs permission', ...run.skipped.map((item) => `- ${String(item.tool)}: ${String(item.reason)}`)] : []),
    '',
    'Agent reply',
    run.provider_response?.ok && run.provider_response.text?.trim()
      ? redactSessionText(run.provider_response.text.trim())
      : redactSessionText(run.local_response),
    ...(run.provider_response?.error ? ['', 'Provider status', `- ${redactSessionText(run.provider_response.error)}`] : []),
    '',
    'Next safe commands',
    ...nextSafeCommands(run),
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
  return run;
}
