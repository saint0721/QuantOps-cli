const RESET = '\u001b[0m';
const TOSS_BLUE = '\u001b[38;2;0;100;255m';
const BLACK = '\u001b[30m';
const CHAT_INPUT_BG = '\u001b[48;2;245;247;250m';
const PROMPT_LABEL = `${CHAT_INPUT_BG}\u001b[1m${TOSS_BLUE}`;
const CHAT_INPUT_TEXT = `${CHAT_INPUT_BG}${BLACK}`;
const CHAT_FRAME = BLACK;
const NEOFETCH_ACCENT = `\u001b[1m${TOSS_BLUE}`;
const CLEAR_TO_END = '\u001b[K';

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

export function chatBox(lines: string[], width = 76): string {
  const wrapped = (lines.length ? lines : ['']).flatMap((line) => wrapChatLine(line, width));
  return chatColor(wrapped.join('\n'));
}

export function interactivePrompt(_mode: string): string {
  return `${PROMPT_LABEL} ❯ ${CHAT_INPUT_TEXT}${CLEAR_TO_END}`;
}

export function inputHintBox(mode: string): string {
  return [
    `${NEOFETCH_ACCENT} _____              ____                  _   ${RESET}`,
    `${NEOFETCH_ACCENT}|_   _|__  ___ ___ / ___| _   _  __ _ _ __ | |_ ${RESET}`,
    `${NEOFETCH_ACCENT}  | |/ _ \\/ __/ __| |  _| | | |/ _\` | '_ \\| __|${RESET}`,
    `${NEOFETCH_ACCENT}  | | (_) \\__ \\__ \\ |_| | |_| | (_| | | | | |_ ${RESET}`,
    `${NEOFETCH_ACCENT}  |_|\\___/|___/___/\\____|\\__,_|\\__,_|_| |_|\\__|${RESET}`,
    '',
    `${NEOFETCH_ACCENT}TossQuant@${mode}${RESET}`,
    `${NEOFETCH_ACCENT}project${RESET}  TossQuant-cli — terminal-first quant runtime around tossctl`,
    `${NEOFETCH_ACCENT}runtime${RESET}  TypeScript CLI + Rust TUI + tmux HUD when available`,
    `${NEOFETCH_ACCENT}safety${RESET}   read-only data by default · trading mutations disabled`,
    '',
    `${NEOFETCH_ACCENT}beginner${RESET} /start · /next · /find · /download <SYMBOL> · /analyze <SYMBOL> · /research <SYMBOL> · /list`,
    `${NEOFETCH_ACCENT}flow${RESET}     /find → /download NVDA → /analyze NVDA → /research NVDA → /next`,
    `${NEOFETCH_ACCENT}advanced${RESET} /discover · /data info · /data refresh <SYMBOL> · /stats <SYMBOL> · /sources`,
    `${NEOFETCH_ACCENT}tools${RESET}    /hud · /ask <question> · /codex · /quant · /exit`,
    `${NEOFETCH_ACCENT}keys${RESET}     Tab completes · ↑/↓ history · ←/→ cursor`,
    '',
    `${NEOFETCH_ACCENT}try${RESET}      /start`,
  ].join('\n');
}
