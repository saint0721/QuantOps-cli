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
    `${NEOFETCH_ACCENT}  ___                  _    ___             ${RESET}`,
    `${NEOFETCH_ACCENT} / _ \\ _   _  __ _ _ __ | |_ / _ \\ _ __  ___ ${RESET}`,
    `${NEOFETCH_ACCENT}| | | | | | |/ _\` | '_ \\| __| | | | '_ \\/ __|${RESET}`,
    `${NEOFETCH_ACCENT}| |_| | |_| | (_| | | | | |_| |_| | |_) \\__ \\${RESET}`,
    `${NEOFETCH_ACCENT} \\__\\_\\\\__,_|\\__,_|_| |_|\\__|\\___/| .__/|___/${RESET}`,
    `${NEOFETCH_ACCENT}                                  |_|        ${RESET}`,
    '',
    `${NEOFETCH_ACCENT}QuantOps@${mode}${RESET}`,
    `${NEOFETCH_ACCENT}project${RESET}  QuantOps-cli — agentic quant research and execution workflows`,
    `${NEOFETCH_ACCENT}runtime${RESET}  TypeScript CLI + Rust TUI + tmux HUD when available`,
    `${NEOFETCH_ACCENT}safety${RESET}   read-only data by default · trading mutations disabled`,
    '',
    `${NEOFETCH_ACCENT}chat${RESET}     그냥 입력: NVDA 실적 모멘텀을 검증하고 싶어`,
    `${NEOFETCH_ACCENT}beginner${RESET} /start · /next · /idea · /lab · /skills · /download <SYMBOL> · /research <SYMBOL>`,
    `${NEOFETCH_ACCENT}flow${RESET}     자연어 채팅 → agent tool 실행/제안 → /idea 또는 /lab 저장 → /backtest`,
    `${NEOFETCH_ACCENT}advanced${RESET} /tools · /discover · /data info · /stats <SYMBOL> · /strategy list`,
    `${NEOFETCH_ACCENT}tools${RESET}    /skills · /tools · $quantops-idea-coach · /hud · /codex · /quant · /exit`,
    `${NEOFETCH_ACCENT}keys${RESET}     Tab completes · ↑/↓ history · ←/→ cursor`,
    '',
    `${NEOFETCH_ACCENT}try${RESET}      /start`,
  ].join('\n');
}
