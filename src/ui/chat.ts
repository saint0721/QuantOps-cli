const RESET = '\u001b[0m';
const PROMPT_FRAME = '\u001b[30m\u001b[48;2;238;238;238m';
const CHAT_FRAME = '\u001b[30m\u001b[48;2;238;238;238m';

export function chatColor(text: string): string {
  return `${CHAT_FRAME}${text}${RESET}`;
}

export function chatDivider(width = 64): string {
  return chatColor('─'.repeat(width));
}

function wrapChatLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += width) chunks.push(line.slice(index, index + width));
  return chunks;
}

export function chatBox(title: string, lines: string[], width = 76): string {
  const contentWidth = Math.max(width, title.length + 8);
  const topFill = '─'.repeat(Math.max(1, contentWidth - title.length - 4));
  const bodyWidth = Math.max(1, contentWidth - 2);
  const wrapped = (lines.length ? lines : ['']).flatMap((line) => wrapChatLine(line, bodyWidth - 2));
  const body = wrapped.map((line) => `│ ${line.padEnd(bodyWidth - 2)} │`);
  return chatColor([
    `╭─ ${title} ${topFill}╮`,
    ...body,
    `╰${'─'.repeat(contentWidth)}╯`,
  ].join('\n'));
}

export function interactivePrompt(mode: string): string {
  return `${PROMPT_FRAME}TossQuant ${mode} ❯${RESET} `;
}

export function inputHintBox(mode: string): string {
  return chatBox(`TossQuant · ${mode}`, [
    'Type a command, /ask, /codex, /watchlist, or press Tab.',
    'HUD status lives in the bottom tmux pane.',
  ]);
}

export function commandEchoBox(command: string): string {
  return chatBox('You · command', [command]);
}
