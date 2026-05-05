import { runTool, type ToolResult } from './tools.ts';
import { providerStatus, runProviderPrompt } from './providers.ts';
import { ensureQuantSession, recordSessionEvent, sessionHandoff, redactSessionText, type QuantSession } from './session.ts';
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
  if (run.steps.some((step) => step.tool === 'lab.workflow')) {
    return [
      '- lab discuss latest --no-codex',
      '- lab verify latest --no-codex',
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
      '제공자 요약',
      run.provider_response?.ok && run.provider_response.text?.trim()
        ? redactSessionText(run.provider_response.text.trim())
        : `- 제공자 요약을 실행하지 않았습니다${run.provider_response?.error ? `: ${redactSessionText(run.provider_response.error)}` : ''}. 로컬 도구 실행은 완료되었습니다.`,
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
    'Provider synthesis',
    run.provider_response?.ok && run.provider_response.text?.trim()
      ? redactSessionText(run.provider_response.text.trim())
      : `- Provider synthesis not run${run.provider_response?.error ? `: ${redactSessionText(run.provider_response.error)}` : ''}. Local tool loop still completed.`,
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

  const partial: Omit<AgentRun, 'provider_response' | 'report'> = { ok: true, request: requestPreview, session, provider, language, symbols, steps, skipped };
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
