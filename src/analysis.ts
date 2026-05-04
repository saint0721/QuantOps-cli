import type { JsonObject } from './storage.ts';

export type HistoryRow = { fetched_at?: string; price: number | null; change: number | null };

export function extractPrice(record: JsonObject): number | null {
  const payload = record.payload as JsonObject | undefined;
  const raw = payload?.price ?? payload?.last ?? payload?.close ?? record.price;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

export function historyRows(records: JsonObject[]): HistoryRow[] {
  let previous: number | null = null;
  return records.map((record) => {
    const price = extractPrice(record);
    const change = price === null || previous === null || previous === 0 ? null : price / previous - 1;
    if (price !== null) previous = price;
    return { fetched_at: String(record.fetched_at ?? ''), price, change };
  });
}

export function classify(records: JsonObject[]): { classification: string; samples: number; total_change: number | null } {
  const rows = historyRows(records).filter((row) => row.price !== null) as Array<HistoryRow & { price: number }>;
  if (rows.length < 3) return { classification: 'insufficient-data', samples: rows.length, total_change: null };
  const first = rows[0]?.price ?? 0;
  const last = rows.at(-1)?.price ?? first;
  const total = first === 0 ? null : last / first - 1;
  if (total !== null && total >= 0.03) return { classification: 'momentum-candidate', samples: rows.length, total_change: total };
  if (total !== null && total <= -0.03) return { classification: 'mean-reversion-watch', samples: rows.length, total_change: total };
  return { classification: 'watch', samples: rows.length, total_change: total };
}
