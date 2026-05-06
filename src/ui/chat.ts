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
    `${NEOFETCH_ACCENT}프로젝트${RESET} QuantOps-cli — 에이전트 기반 퀀트 리서치 실행 도구`,
    `${NEOFETCH_ACCENT}런타임${RESET}   TypeScript CLI + Rust TUI + tmux HUD`,
    `${NEOFETCH_ACCENT}안전${RESET}     기본은 읽기 전용 데이터 · 실제 매매 변경 비활성화`,
    '',
    `${NEOFETCH_ACCENT}채팅${RESET}     그냥 입력: NVDA 실적 모멘텀을 검증하고 싶어`,
    `${NEOFETCH_ACCENT}처음${RESET}     /start · /next · /idea · /lab · /skills · /download <SYMBOL> · /research <SYMBOL>`,
    `${NEOFETCH_ACCENT}흐름${RESET}     자연어 채팅 → 에이전트 도구 실행/제안 → /idea 또는 /lab 저장 → /backtest`,
    `${NEOFETCH_ACCENT}고급${RESET}     /tools · /discover · /data info · /stats <SYMBOL> · /strategy list`,
    `${NEOFETCH_ACCENT}도구${RESET}     /skills · /tools · /model · $quantops-idea-coach · /hud · /codex · /quant · /exit`,
    `${NEOFETCH_ACCENT}키${RESET}       Tab 자동완성 · ↑/↓ 기록 · ←/→ 커서 이동`,
    '',
    `${NEOFETCH_ACCENT}추천${RESET}     /start`,
  ].join('\n');
}
