export const NOISE_PREFIXES = [
  'hook:', 'warning: Codex could not find bubblewrap', 'OpenAI Codex ', 'workdir:', 'model:', 'provider:', 'approval:',
  'sandbox:', 'reasoning effort:', 'reasoning summaries:', 'session id:', 'Reading additional input from stdin',
];

function filterCodexStream(text: string): string {
  const visible: string[] = [];
  let skipUser = false;
  let skipToken = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const stripped = line.trim();
    if (!stripped) { if (visible.length && visible.at(-1) !== '') visible.push(''); continue; }
    if (skipToken) { skipToken = false; if (/^[\d,]+$/.test(stripped)) continue; }
    if (stripped === 'user') { skipUser = true; continue; }
    if (stripped === 'codex') { skipUser = false; continue; }
    if (skipUser) continue;
    if (stripped === '--------') continue;
    if (stripped === 'tokens used') { skipToken = true; continue; }
    if (NOISE_PREFIXES.some((prefix) => stripped.startsWith(prefix))) continue;
    if (stripped.includes('[OMX_TMUX_INJECT]')) continue;
    if (stripped === 'Continue from current mode state.') continue;
    visible.push(line);
  }
  while (visible[0] === '') visible.shift();
  while (visible.at(-1) === '') visible.pop();
  return visible.join('\n');
}

function normalizedOutput(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function filteredCodexOutput(stdout: string, stderr = ''): string {
  const out = filterCodexStream(stdout);
  const err = filterCodexStream(stderr);
  if (!out) return err;
  if (!err) return out;
  if (normalizedOutput(out) === normalizedOutput(err)) return out;
  return `${out}\n${err}`;
}
