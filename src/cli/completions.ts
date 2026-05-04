export const ROOT_COMPLETIONS = ['doctor', 'quote', 'history', 'classify', 'portfolio', 'order', 'brief', 'runtime', 'hud', 'tmux', 'setup', 'exit', 'quit'];
export const SLASH_COMPLETIONS = ['/help', '/status', '/watchlist', '/hud', '/runtime', '/ask', '/codex', '/quant'];

export function completionCandidates(line: string, mode = 'quant'): string[] {
  const trimmed = line.trimStart();
  if (mode === 'codex') return SLASH_COMPLETIONS;
  if (!trimmed) return [...ROOT_COMPLETIONS, ...SLASH_COMPLETIONS].sort();
  const parts = trimmed.endsWith(' ') ? [...trimmed.split(/\s+/), ''] : trimmed.split(/\s+/);
  if (parts.length <= 1) return [...ROOT_COMPLETIONS, ...SLASH_COMPLETIONS].sort();
  const first = parts[0];
  if (first === '/watchlist') return ['add', 'fetch', 'list', 'remove'];
  if (first === '/hud') return ['tmux'];
  if (first === '/runtime') return ['line', 'snapshot'];
  if (first === 'quote') return ['fetch', 'history'];
  if (first === 'portfolio') return ['snapshot'];
  if (first === 'order') return ['preview'];
  if (first === 'runtime') return ['line', 'snapshot'];
  if (first === 'hud') return ['--tmux', '--watch'];
  if (first === 'tmux') return parts[1] === 'start' ? ['--session', '--height', '--interval'] : ['start'];
  if (first === 'setup') return ['bin'];
  return [];
}

export function completeLine(line: string, mode = 'quant'): [string[], string] {
  const token = line.endsWith(' ') ? '' : (line.split(/\s+/).at(-1) ?? '');
  const matches = completionCandidates(line, mode).filter((candidate) => candidate.startsWith(token));
  return [matches.length ? matches : completionCandidates(line, mode), token];
}
