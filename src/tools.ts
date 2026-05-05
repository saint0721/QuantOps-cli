import { downloadHistory, dataInfo, validateData, type DownloadRequest } from './data.ts';
import { marketStatsRuntime } from './rustStats.ts';
import { runResearch, formatResearchReport } from './research.ts';
import { defineEvent, parseEventWindows } from './events.ts';
import { runEventStudyRuntime } from './rustEvent.ts';
import { createIdea, addIdeaSymbol, addIdeaHypothesis, ideaStatus } from './idea.ts';
import { formatLabWorkflow, runLabStage, formatLabRun, type LabStage } from './lab.ts';
import { formatBacktestResult, formatStrategyList, listBacktestStrategies } from './backtest.ts';
import { runBacktestRuntime } from './rustBacktest.ts';
import { redact, type JsonObject, type JsonValue } from './storage.ts';
import { redactSessionText } from './session.ts';
import { rtkCommandForTool, toolWindows } from './toolCommands.ts';

export type ToolContext = {
  base?: string;
};

export type ToolResult = {
  ok: boolean;
  tool: string;
  rtk_command?: string;
  output: JsonObject;
  text: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: JsonObject;
  read_only: boolean;
  local_writes: boolean;
  sensitive: boolean;
  mutates_trading: false;
  rtk_command: string;
  run: (input: JsonObject, context: ToolContext) => Promise<ToolResult>;
};

function stringArg(input: JsonObject, key: string, fallback = ''): string {
  const value = input[key];
  return value === undefined || value === null ? fallback : String(value);
}

function numberArg(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function schema(properties: JsonObject, required: string[] = []): JsonObject {
  return { type: 'object', properties, required, additionalProperties: false };
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function redactUrlSecretText(value: string): string {
  return value.replace(/([?&](?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|session[_-]?id|session|token|secret|password)=)[^&#\s]+/gi, '$1<redacted>');
}

export function redactToolText(value: string): string {
  return redactUrlSecretText(redactSessionText(value));
}

export function redactToolOutput<T extends JsonValue>(value: T): T | JsonValue {
  const redacted = redact(value) as JsonValue;
  if (typeof redacted === 'string') return redactToolText(redacted);
  if (Array.isArray(redacted)) return redacted.map((item) => redactToolOutput(item)) as JsonValue;
  if (redacted && typeof redacted === 'object') return Object.fromEntries(Object.entries(redacted).map(([key, item]) => [key, redactToolOutput(item as JsonValue)]));
  return redacted;
}

function result(tool: string, output: JsonObject, text?: string, input: JsonObject = {}): ToolResult {
  const safeOutput = redactToolOutput(output as unknown as JsonValue) as JsonObject;
  const rtkCommand = redactToolText(rtkCommandForTool(tool, input));
  return { ok: output.ok !== false, tool, rtk_command: rtkCommand, output: safeOutput, text: redactToolText(text ?? jsonText(safeOutput)) };
}

function downloadRequest(input: JsonObject): DownloadRequest {
  return {
    symbol: stringArg(input, 'symbol').toUpperCase(),
    source: stringArg(input, 'source', 'yahoo'),
    interval: stringArg(input, 'interval', 'd'),
    start: stringArg(input, 'start') || undefined,
    end: stringArg(input, 'end') || undefined,
    providerSymbol: stringArg(input, 'provider_symbol') || undefined,
  };
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'data.info',
    description: 'Inspect saved OHLCV datasets for a symbol without downloading data.',
    input_schema: schema({ symbol: { type: 'string' }, source: { type: 'string' }, interval: { type: 'string' } }),
    read_only: true,
    local_writes: false,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('data.info'),
    async run(input, context) {
      const output = dataInfo(context.base, stringArg(input, 'symbol') || undefined, {
        source: stringArg(input, 'source') || undefined,
        interval: stringArg(input, 'interval') || undefined,
      });
      return result('data.info', output, undefined, input);
    },
  },
  {
    name: 'data.download',
    description: 'Download read-only OHLCV market data for a symbol into local data/ storage.',
    input_schema: schema({ symbol: { type: 'string' }, source: { type: 'string', enum: ['yahoo', 'stooq'] }, interval: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, provider_symbol: { type: 'string' } }, ['symbol']),
    read_only: false,
    local_writes: true,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('data.download'),
    async run(input, context) {
      const output = await downloadHistory(downloadRequest(input), { base: context.base });
      return result('data.download', output, undefined, input);
    },
  },
  {
    name: 'data.validate',
    description: 'Validate saved OHLCV data quality for a symbol.',
    input_schema: schema({ symbol: { type: 'string' }, max_stale_days: { type: 'number' } }),
    read_only: true,
    local_writes: false,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('data.validate'),
    async run(input, context) {
      const max = Number(input.max_stale_days);
      const output = validateData(context.base, stringArg(input, 'symbol') || undefined, { maxStaleDays: Number.isFinite(max) ? max : undefined });
      return result('data.validate', output, undefined, input);
    },
  },
  {
    name: 'stats.run',
    description: 'Compute deterministic local market stats, readiness, and regime for a symbol.',
    input_schema: schema({ symbol: { type: 'string' }, source: { type: 'string' }, interval: { type: 'string' }, provider_symbol: { type: 'string' } }, ['symbol']),
    read_only: true,
    local_writes: false,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('stats.run'),
    async run(input, context) {
      const output = marketStatsRuntime(stringArg(input, 'symbol'), {
        base: context.base,
        source: stringArg(input, 'source', 'yahoo'),
        interval: stringArg(input, 'interval', 'd'),
        providerSymbol: stringArg(input, 'provider_symbol') || undefined,
      });
      return result('stats.run', output, undefined, input);
    },
  },
  {
    name: 'research.run',
    description: 'Build a safe external-factor research report from local data context; provider synthesis happens in the agent layer.',
    input_schema: schema({ symbol: { type: 'string' }, topic: { type: 'string' }, source: { type: 'string' }, interval: { type: 'string' }, provider_symbol: { type: 'string' } }, ['symbol']),
    read_only: false,
    local_writes: true,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('research.run'),
    async run(input, context) {
      const report = runResearch(stringArg(input, 'symbol'), {
        base: context.base,
        topic: stringArg(input, 'topic') || undefined,
        source: stringArg(input, 'source') || undefined,
        interval: stringArg(input, 'interval') || undefined,
        providerSymbol: stringArg(input, 'provider_symbol') || undefined,
      });
      return result('research.run', report as unknown as JsonObject, formatResearchReport(report), input);
    },
  },
  {
    name: 'event.define',
    description: 'Turn a news or market event thesis into a structured event-study definition.',
    input_schema: schema({ type: { type: 'string' }, target_symbol: { type: 'string' }, source_symbol: { type: 'string' }, benchmark: { type: 'string' }, topic: { type: 'string' }, thesis: { type: 'string' }, windows: { type: 'array', items: { type: 'string' } } }),
    read_only: true,
    local_writes: false,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('event.define'),
    async run(input) {
      const output = defineEvent({
        type: stringArg(input, 'type') || undefined,
        targetSymbol: stringArg(input, 'target_symbol') || stringArg(input, 'symbol') || undefined,
        sourceSymbol: stringArg(input, 'source_symbol') || undefined,
        benchmark: stringArg(input, 'benchmark') || undefined,
        topic: stringArg(input, 'topic') || undefined,
        thesis: stringArg(input, 'thesis') || undefined,
        windows: parseEventWindows(toolWindows(input)),
      });
      return result('event.define', output, undefined, input);
    },
  },
  {
    name: 'event.study',
    description: 'Run a deterministic target/benchmark event study against saved OHLCV data.',
    input_schema: schema({ symbol: { type: 'string' }, event_date: { type: 'string' }, benchmark: { type: 'string' }, windows: { type: 'array', items: { type: 'string' } }, source: { type: 'string' }, interval: { type: 'string' }, provider_symbol: { type: 'string' } }, ['symbol', 'event_date']),
    read_only: true,
    local_writes: false,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('event.study'),
    async run(input, context) {
      const output = runEventStudyRuntime(stringArg(input, 'symbol'), {
        base: context.base,
        eventDate: stringArg(input, 'event_date') || undefined,
        benchmark: stringArg(input, 'benchmark') || undefined,
        windows: parseEventWindows(toolWindows(input)),
        source: stringArg(input, 'source', 'yahoo'),
        interval: stringArg(input, 'interval', 'd'),
        providerSymbol: stringArg(input, 'provider_symbol') || undefined,
      });
      return result('event.study', output, undefined, input);
    },
  },
  {
    name: 'idea.create',
    description: 'Create a local QuantOps idea record.',
    input_schema: schema({ title: { type: 'string' }, symbol: { type: 'string' }, hypothesis: { type: 'string' } }, ['title']),
    read_only: false,
    local_writes: true,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('idea.create'),
    async run(input, context) {
      const idea = createIdea(context.base ?? 'data', stringArg(input, 'title'));
      if (stringArg(input, 'symbol')) addIdeaSymbol(context.base ?? 'data', idea.id, stringArg(input, 'symbol'));
      if (stringArg(input, 'hypothesis')) addIdeaHypothesis(context.base ?? 'data', idea.id, stringArg(input, 'hypothesis'));
      const output = ideaStatus(context.base ?? 'data', idea.id) as unknown as JsonObject;
      return result('idea.create', output, undefined, input);
    },
  },
  {
    name: 'idea.add-symbol',
    description: 'Attach a symbol to a saved QuantOps idea.',
    input_schema: schema({ idea: { type: 'string' }, symbol: { type: 'string' } }, ['idea', 'symbol']),
    read_only: false,
    local_writes: true,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('idea.add-symbol'),
    async run(input, context) {
      const idea = addIdeaSymbol(context.base ?? 'data', stringArg(input, 'idea'), stringArg(input, 'symbol')) as unknown as JsonObject;
      return result('idea.add-symbol', { ok: true, idea }, undefined, input);
    },
  },
  {
    name: 'lab.workflow',
    description: 'Show the discuss → verify → backtest workflow for a saved idea.',
    input_schema: schema({ idea: { type: 'string' } }, ['idea']),
    read_only: true,
    local_writes: false,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('lab.workflow'),
    async run(input, context) {
      const status = ideaStatus(context.base ?? 'data', stringArg(input, 'idea'));
      return result('lab.workflow', status as unknown as JsonObject, formatLabWorkflow(status), input);
    },
  },
  {
    name: 'lab.stage',
    description: 'Run a safe lab stage for a saved idea: discuss, verify, or backtest.',
    input_schema: schema({ idea: { type: 'string' }, stage: { type: 'string', enum: ['discuss', 'verify', 'backtest'] } }, ['idea', 'stage']),
    read_only: false,
    local_writes: true,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('lab.stage'),
    async run(input, context) {
      const stage = stringArg(input, 'stage', 'discuss') as LabStage;
      const run = runLabStage(stage, stringArg(input, 'idea'), { base: context.base, save: true });
      return result('lab.stage', run as unknown as JsonObject, formatLabRun(run), input);
    },
  },
  {
    name: 'strategy.list',
    description: 'List deterministic backtest strategies available in QuantOps.',
    input_schema: schema({}),
    read_only: true,
    local_writes: false,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('strategy.list'),
    async run() {
      return result('strategy.list', { ok: true, strategies: listBacktestStrategies() as unknown as JsonValue } as JsonObject, formatStrategyList());
    },
  },
  {
    name: 'backtest.run',
    description: 'Run a deterministic local backtest for a saved OHLCV symbol. This never mutates trading accounts.',
    input_schema: schema({
      symbol: { type: 'string' },
      strategy: { type: 'string', enum: ['buy-hold', 'ma-cross', 'momentum', 'mean-reversion'] },
      fast: { type: 'number' },
      slow: { type: 'number' },
      lookback: { type: 'number' },
      threshold: { type: 'number' },
      source: { type: 'string' },
      interval: { type: 'string' },
      provider_symbol: { type: 'string' },
    }, ['symbol']),
    read_only: false,
    local_writes: true,
    sensitive: false,
    mutates_trading: false,
    rtk_command: rtkCommandForTool('backtest.run'),
    async run(input, context) {
      const run = runBacktestRuntime(stringArg(input, 'symbol'), {
        base: context.base,
        source: stringArg(input, 'source', 'yahoo'),
        interval: stringArg(input, 'interval', 'd'),
        providerSymbol: stringArg(input, 'provider_symbol') || undefined,
        strategy: stringArg(input, 'strategy', 'ma-cross'),
        fast: numberArg(input, 'fast'),
        slow: numberArg(input, 'slow'),
        lookback: numberArg(input, 'lookback'),
        threshold: numberArg(input, 'threshold'),
      });
      return result('backtest.run', run as unknown as JsonObject, formatBacktestResult(run), input);
    },
  },
];

export function listTools(): ToolDefinition[] {
  return [...TOOL_DEFINITIONS].sort((a, b) => a.name.localeCompare(b.name));
}

export function toolByName(name: string): ToolDefinition | undefined {
  return listTools().find((tool) => tool.name === name);
}

export function toolSummaries(): JsonObject[] {
  return listTools().map(({ name, description, input_schema, read_only, local_writes, sensitive, mutates_trading, rtk_command }) => ({ name, description, input_schema, rtk_command, read_only, local_writes, sensitive, mutates_trading }));
}

export async function runTool(name: string, input: JsonObject = {}, context: ToolContext = {}): Promise<ToolResult> {
  const tool = toolByName(name);
  if (!tool) {
    const safeName = redactToolText(name);
    const message = redactToolText(`unknown tool: ${name}`);
    return { ok: false, tool: safeName, output: { ok: false, error: message }, text: message };
  }
  try {
    return await tool.run(input, context);
  } catch (error) {
    const message = redactToolText(error instanceof Error ? error.message : String(error));
    return { ok: false, tool: name, output: { ok: false, error: message }, text: message };
  }
}
