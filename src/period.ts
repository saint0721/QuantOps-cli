function dateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function periodToDateRange(period: string, now = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  const normalized = period.trim().toLowerCase();
  if (normalized === 'ytd') {
    start.setUTCMonth(0, 1);
  } else {
    const match = normalized.match(/^(\d+)(d|w|mo|m|y)$/);
    if (!match) throw new Error(`unsupported period: ${period}`);
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit === 'd') start.setUTCDate(start.getUTCDate() - amount);
    if (unit === 'w') start.setUTCDate(start.getUTCDate() - amount * 7);
    if (unit === 'mo' || unit === 'm') start.setUTCMonth(start.getUTCMonth() - amount);
    if (unit === 'y') start.setUTCFullYear(start.getUTCFullYear() - amount);
  }
  return { start: dateString(start), end: dateString(end) };
}
