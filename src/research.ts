import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { auditAll, type AuditFinding } from './audit.ts';
import { listDatasets } from './data.ts';
import { marketStats } from './marketAnalysis.ts';
import { appendJsonl, redact, type JsonObject, type JsonValue, utcNow } from './storage.ts';
import { symbolInfo } from './discovery.ts';

export type ResearchOptions = {
  base?: string;
  topic?: string;
  source?: string;
  interval?: string;
  providerSymbol?: string;
  save?: boolean;
  now?: string;
};

export type ResearchCodexResult = {
  ok: boolean;
  text?: string;
  error?: string;
  returncode?: number;
};

export type ResearchCodexRunner = (prompt: string) => ResearchCodexResult;

export type ResearchLocalContext = {
  ticker: string;
  topic: string;
  created_at: string;
  dataset: JsonObject;
  stats: JsonObject;
  audit_findings: AuditFinding[];
  symbol?: JsonObject;
};

export type ResearchReport = {
  ok: boolean;
  ticker: string;
  created_at: string;
  missing_data?: boolean;
  message?: string;
  next_command?: string;
  local_context?: ResearchLocalContext;
  prompt?: string;
  codex?: ResearchCodexResult;
  report: string;
  saved_to?: string;
};

function normalizeTicker(symbol: string): string {
  const ticker = symbol.trim().toUpperCase();
  if (!ticker) throw new Error('symbol is required');
  return ticker;
}

function datasetMatches(dataset: JsonObject, ticker: string): boolean {
  const wanted = ticker.toLowerCase();
  return [dataset.provider_symbol, dataset.name]
    .map((value) => String(value ?? '').toLowerCase())
    .some((value) => value === wanted || value.startsWith(`${wanted}.`) || value.startsWith(`${wanted}_`));
}

function chooseDataset(ticker: string, options: ResearchOptions): JsonObject | undefined {
  const datasets = listDatasets(options.base ?? 'data')
    .filter((dataset) => datasetMatches(dataset, ticker))
    .filter((dataset) => !options.source || String(dataset.source ?? '') === options.source)
    .filter((dataset) => !options.interval || String(dataset.interval ?? '') === options.interval)
    .sort((a, b) => String(b.latest_date ?? '').localeCompare(String(a.latest_date ?? '')) || Number(b.rows ?? 0) - Number(a.rows ?? 0));
  return datasets[0];
}

function datasetProviderSymbol(dataset: JsonObject, ticker: string): string {
  return String(dataset.provider_symbol || dataset.name || ticker);
}

function compactStats(stats: JsonObject): JsonObject {
  const keys = [
    'ok', 'ticker', 'provider_symbol', 'source', 'interval', 'rows', 'start_date', 'end_date', 'latest_close',
    'total_return', 'average_return', 'volatility', 'annualized_volatility', 'max_drawdown', 'best_return',
    'worst_return', 'moving_average_20', 'moving_average_50', 'latest_volume', 'volume_ratio_20', 'regime', 'readiness',
    'error', 'next_command',
  ];
  return Object.fromEntries(keys.filter((key) => key in stats).map((key) => [key, stats[key] as JsonValue]));
}

function formatPercent(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

function buildDeterministicSummary(context: ResearchLocalContext, codex?: ResearchCodexResult): string {
  const stats = context.stats;
  const warnings = context.audit_findings.filter((finding) => finding.severity === 'error' || finding.severity === 'warn');
  const lines = [
    `Research context for ${context.ticker}`,
    '',
    'Local data readiness',
    `- Dataset: ${String(context.dataset.source ?? 'unknown')} ${String(context.dataset.interval ?? 'd')} with ${String(context.dataset.rows ?? 0)} rows (${String(stats.start_date ?? '?')} to ${String(stats.end_date ?? '?')}).`,
    `- Regime: ${String(stats.regime ?? 'unknown')}; readiness: ${JSON.stringify(stats.readiness ?? {})}.`,
    '',
    'Recent price/stat summary',
    `- Latest close: ${formatNumber(stats.latest_close)}; total return over saved window: ${formatPercent(stats.total_return)}.`,
    `- Annualized volatility: ${formatPercent(stats.annualized_volatility)}; max drawdown: ${formatPercent(stats.max_drawdown)}.`,
    '',
    'External event/news timeline',
    codex?.ok && codex.text?.trim()
      ? codex.text.trim()
      : `- Codex/web summary was unavailable${codex?.error ? `: ${codex.error}` : ''}. Use the prompt saved with this report to run external research later.`,
    '',
    'Uncertainty / source boundaries',
    '- This report compares local market movement with public-event context and does not claim hard causality.',
    '- It intentionally avoids buy/sell/hold advice, trading mutations, and any single buy/sell score.',
    ...(warnings.length ? ['', 'Data-quality warnings', ...warnings.map((item) => `- ${item.severity}: ${item.code} — ${item.message}`)] : []),
    '',
    'Follow-up research questions',
    `- Which dated company, macro, product, filing, or earnings events overlap ${context.ticker}'s largest up/down sessions?`,
    '- Are multiple independent sources consistent, or is the event link speculative?',
    '',
    'Next QuantOps commands',
    `- stats ${context.ticker}`,
    `- audit ${context.ticker}`,
    `- data download ${context.ticker} --period 1y`,
  ];
  return lines.join('\n');
}

export function researchReportPath(ticker: string, base = 'data'): string {
  return join(base, 'research', `${normalizeTicker(ticker)}.jsonl`);
}

export function buildResearchContext(symbol: string, options: ResearchOptions = {}): ResearchLocalContext | null {
  const ticker = normalizeTicker(symbol);
  const dataset = options.source || options.providerSymbol || options.interval
    ? undefined
    : chooseDataset(ticker, options);
  const source = options.source || String(dataset?.source ?? 'yahoo');
  const interval = options.interval || String(dataset?.interval ?? 'd');
  const providerSymbol = options.providerSymbol || (dataset ? datasetProviderSymbol(dataset, ticker) : undefined);
  const stats = marketStats(ticker, { base: options.base, source, interval, providerSymbol });
  if (!stats.ok) return null;
  const resolvedDataset = dataset ?? chooseDataset(ticker, { ...options, source, interval });
  return {
    ticker,
    topic: options.topic || 'general external factors',
    created_at: options.now ?? utcNow(),
    dataset: resolvedDataset ?? { source, interval, provider_symbol: providerSymbol ?? ticker, rows: stats.rows, first_date: stats.start_date, latest_date: stats.end_date },
    stats: compactStats(stats),
    audit_findings: auditAll(options.base ?? 'data', ticker),
    ...(symbolInfo(ticker) ? { symbol: symbolInfo(ticker) as unknown as JsonObject } : {}),
  };
}

export function buildResearchPrompt(context: ResearchLocalContext): string {
  const safeContext = redact(context as unknown as JsonValue);
  return [
    `You are helping a beginner research ${context.ticker} price movement using public web/event context plus local QuantOps data.`,
    `Research focus/topic: ${context.topic}.`,
    '',
    'Use web/current public information if available. Summarize recent news, earnings, filings, product/company events, sector/macro events, or other public context that may loosely line up with the saved price movement.',
    '',
    'Safety and scope rules:',
    '- Do not provide buy/sell/hold advice or a recommendation.',
    '- Do not produce a single numeric buy/sell score or trading signal.',
    '- Do not suggest or perform order placement, portfolio mutation, or trading mutations.',
    '- Do not claim hard causality unless the evidence is explicitly strong; default to contextual/uncertain wording.',
    '- Distinguish local data facts from web/event summary and note missing data.',
    '',
    'Return sections:',
    '1. Local data readiness',
    '2. Recent price/stat summary',
    '3. Event/news timeline',
    '4. Loose context links between events and price movement',
    '5. Uncertainty / missing-data warnings',
    '6. Follow-up research questions',
    '7. Next QuantOps commands',
    '',
    'Redacted local context JSON:',
    JSON.stringify(safeContext, null, 2),
  ].join('\n');
}

export function runResearch(symbol: string, options: ResearchOptions = {}, codexRunner?: ResearchCodexRunner): ResearchReport {
  const ticker = normalizeTicker(symbol);
  const createdAt = options.now ?? utcNow();
  const context = buildResearchContext(ticker, { ...options, now: createdAt });
  if (!context) {
    const next = `data download ${ticker} --period 1y`;
    const report = [
      `No saved market dataset found for ${ticker}.`,
      `Run ${next} before external research so QuantOps can line up events with local price movement.`,
    ].join('\n');
    return { ok: false, ticker, created_at: createdAt, missing_data: true, message: 'missing local market data', next_command: next, report };
  }
  const prompt = buildResearchPrompt(context);
  const codex = codexRunner ? codexRunner(prompt) : { ok: false, error: 'codex runner not configured' };
  const report = buildDeterministicSummary(context, codex);
  const result: ResearchReport = { ok: true, ticker, created_at: createdAt, local_context: context, prompt, codex, report };
  if (options.save !== false) {
    const path = researchReportPath(ticker, options.base ?? 'data');
    appendJsonl(path, redact({ ...result, saved_to: path } as unknown as JsonObject) as JsonObject);
    if (existsSync(path)) result.saved_to = path;
  }
  return result;
}

export function formatResearchReport(result: ResearchReport): string {
  if (result.missing_data) return `${result.report}\nnext  /${result.next_command}`;
  return [
    result.report,
    result.saved_to ? `\nsaved_to: ${result.saved_to}` : '',
  ].join('\n').trimEnd();
}
