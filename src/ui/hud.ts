const RESET = '\u001b[0m';
const HUD_FRAME = '\u001b[30m\u001b[48;2;238;238;238m';

export function hudColor(text: string, ansi = HUD_FRAME): string {
  return `${ansi}${text}${RESET}`;
}
