from __future__ import annotations

from typing import Any

PRICE_KEYS = ("price", "currentPrice", "current_price", "last", "lastPrice", "close", "Close")


def extract_price(payload: Any) -> float | None:
    if isinstance(payload, dict):
        for key in PRICE_KEYS:
            if key in payload:
                try:
                    return float(str(payload[key]).replace(",", ""))
                except (TypeError, ValueError):
                    pass
        for item in payload.values():
            found = extract_price(item)
            if found is not None:
                return found
    if isinstance(payload, list):
        for item in payload:
            found = extract_price(item)
            if found is not None:
                return found
    return None


def history_rows(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    previous = None
    for record in records:
        price = extract_price(record.get("payload"))
        change = None if previous in (None, 0) or price is None else price / previous - 1.0
        rows.append({"fetched_at": record.get("fetched_at"), "ticker": record.get("ticker"), "price": price, "change": change})
        if price is not None:
            previous = price
    return rows


def classify(records: list[dict[str, Any]]) -> dict[str, Any]:
    rows = [row for row in history_rows(records) if row["price"] is not None]
    if len(rows) < 3:
        return {"classification": "insufficient-data", "reason": "quote history needs at least 3 priced snapshots"}
    first, last = rows[0]["price"], rows[-1]["price"]
    total = last / first - 1.0 if first else 0.0
    last_change = rows[-1]["change"] or 0.0
    if total >= 0.03 and last_change >= 0:
        label = "momentum-candidate"
        reason = "price history is rising and latest change is non-negative"
    elif total <= -0.03 and last_change > 0:
        label = "mean-reversion-candidate"
        reason = "price fell over the stored window but latest quote bounced"
    else:
        label = "watch"
        reason = "history does not show a clean momentum or mean-reversion setup yet"
    return {"classification": label, "total_change": total, "last_change": last_change, "samples": len(rows), "reason": reason}
