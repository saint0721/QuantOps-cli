export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)));
  const line = (cols: string[]) => cols.map((col, index) => col.padEnd(widths[index] ?? col.length)).join('  ').trimEnd();
  return [line(headers), line(headers.map((header, index) => '-'.repeat(Math.max(3, widths[index] ?? header.length)))), ...rows.map(line)].join('\n');
}
