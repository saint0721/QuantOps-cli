export const NOISE_PREFIXES = [
  'hook:', 'warning: Codex could not find bubblewrap', 'OpenAI Codex ', 'workdir:', 'model:', 'provider:', 'approval:',
  'sandbox:', 'reasoning effort:', 'reasoning summaries:', 'session id:', 'Reading additional input from stdin',
];

export function filteredCodexOutput(stdout: string, stderr = ''): string {
  const visible: string[] = [];
  let skipUser = false;
  let skipToken = false;
  for (const raw of `${stdout}\n${stderr}`.split(/\r?\n/)) {
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
    visible.push(line);
  }
  while (visible[0] === '') visible.shift();
  while (visible.at(-1) === '') visible.pop();
  return visible.join('\n');
}
