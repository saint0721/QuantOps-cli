import type { JsonObject } from './storage.ts';

function value(input: JsonObject, key: string, fallback = ''): string {
  const raw = input[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw);
}

function symbol(input: JsonObject): string {
  return value(input, 'symbol', '<SYMBOL>').toUpperCase();
}

function quote(text: string): string {
  if (/^[A-Za-z0-9._:/=,<>-]+$/.test(text)) return text;
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function pushOption(parts: string[], flag: string, raw: unknown): void {
  if (raw === undefined || raw === null || raw === '') return;
  parts.push(flag, quote(String(raw)));
}

function json(parts: string[]): string {
  return [...parts, '--json'].join(' ');
}

export function rtkCommandForTool(name: string, input: JsonObject = {}): string {
  switch (name) {
    case 'data.info':
      return json(['rtk', 'data', 'info', symbol(input)]);
    case 'data.download': {
      const parts = ['rtk', 'data', 'download', symbol(input)];
      pushOption(parts, '--source', input.source);
      pushOption(parts, '--interval', input.interval);
      pushOption(parts, '--start', input.start);
      pushOption(parts, '--end', input.end);
      pushOption(parts, '--provider-symbol', input.provider_symbol);
      return json(parts);
    }
    case 'data.validate': {
      const parts = ['rtk', 'data', 'validate', symbol(input)];
      pushOption(parts, '--max-stale-days', input.max_stale_days);
      return json(parts);
    }
    case 'stats.run': {
      const parts = ['rtk', 'stats', symbol(input)];
      pushOption(parts, '--source', input.source);
      pushOption(parts, '--interval', input.interval);
      pushOption(parts, '--provider-symbol', input.provider_symbol);
      return json(parts);
    }
    case 'research.run': {
      const parts = ['rtk', 'research', symbol(input)];
      pushOption(parts, '--topic', input.topic);
      pushOption(parts, '--source', input.source);
      pushOption(parts, '--interval', input.interval);
      pushOption(parts, '--provider-symbol', input.provider_symbol);
      return json(parts);
    }
    case 'event.define': {
      const parts = ['rtk', 'event', 'define'];
      pushOption(parts, '--type', input.type);
      pushOption(parts, '--target-symbol', input.target_symbol ?? input.symbol ?? '<SYMBOL>');
      pushOption(parts, '--source-symbol', input.source_symbol);
      pushOption(parts, '--benchmark', input.benchmark);
      pushOption(parts, '--topic', input.topic);
      pushOption(parts, '--thesis', input.thesis);
      for (const window of toolWindows(input)) parts.push('--window', quote(window));
      return json(parts);
    }
    case 'event.study': {
      const parts = ['rtk', 'event', 'study', symbol(input)];
      pushOption(parts, '--event-date', input.event_date ?? '<YYYY-MM-DD>');
      pushOption(parts, '--benchmark', input.benchmark);
      pushOption(parts, '--source', input.source);
      pushOption(parts, '--interval', input.interval);
      pushOption(parts, '--provider-symbol', input.provider_symbol);
      for (const window of toolWindows(input)) parts.push('--window', quote(window));
      return json(parts);
    }
    case 'idea.create': {
      const parts = ['rtk', 'idea', 'new', quote(value(input, 'title', '<TITLE>'))];
      return parts.join(' ');
    }
    case 'idea.add-symbol':
      return ['rtk', 'idea', 'add-symbol', quote(value(input, 'idea', '<IDEA_REF>')), symbol(input)].join(' ');
    case 'lab.workflow':
      return json(['rtk', 'lab', 'workflow', quote(value(input, 'idea', 'latest'))]);
    case 'lab.stage': {
      const stage = value(input, 'stage', 'discuss');
      return json(['rtk', 'lab', stage, quote(value(input, 'idea', 'latest'))]);
    }
    case 'strategy.list':
      return json(['rtk', 'backtest', 'strategies']);
    case 'backtest.run': {
      const parts = ['rtk', 'backtest', 'run', symbol(input)];
      pushOption(parts, '--strategy', input.strategy);
      pushOption(parts, '--fast', input.fast);
      pushOption(parts, '--slow', input.slow);
      pushOption(parts, '--lookback', input.lookback);
      pushOption(parts, '--threshold', input.threshold);
      pushOption(parts, '--source', input.source);
      pushOption(parts, '--interval', input.interval);
      pushOption(parts, '--provider-symbol', input.provider_symbol);
      return json(parts);
    }
    default:
      return `rtk tools run ${quote(name)} --json`;
  }
}

export function toolWindows(input: JsonObject): string[] {
  const raw = input.windows ?? input.window;
  if (Array.isArray(raw)) return raw.map((item) => String(item)).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return raw.split(';').map((item) => item.trim()).filter(Boolean);
  return [];
}
