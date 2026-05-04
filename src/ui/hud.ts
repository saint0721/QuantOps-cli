const RESET = '\u001b[0m';
const HUD_TEXT = '\u001b[30m';
const HUD_ACCENT = '\u001b[38;2;0;100;255m';

export function hudColor(text: string): string {
  const highlighted = text.replace(
    /\b(mode|watchlist|quotes|classify-ready|codex|last|updated):/g,
    `${HUD_ACCENT}$1:${HUD_TEXT}`,
  );
  return `${HUD_TEXT}${highlighted}${RESET}`;
}
