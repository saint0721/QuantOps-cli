from __future__ import annotations

import csv
import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable
from typing import Any

from .storage import append_jsonl, data_dir, read_jsonl, read_watchlist, utc_now

STOOQ_BASE_URL = "https://stooq.com/q/d/l/"
STOOQ_INTERVALS = {"d", "w", "m"}
OHLCV_FIELDS = ("open", "high", "low", "close", "volume")


@dataclass(frozen=True)
class DownloadRequest:
    symbol: str
    source: str = "stooq"
    interval: str = "d"
    start: str | None = None
    end: str | None = None
    provider_symbol: str | None = None


def normalize_date(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip().replace("-", "")
    if len(cleaned) != 8 or not cleaned.isdigit():
        raise ValueError(f"date must be YYYY-MM-DD or YYYYMMDD: {value}")
    return cleaned


def normalize_stooq_symbol(symbol: str, provider_symbol: str | None = None) -> str:
    raw = (provider_symbol or symbol).strip()
    if not raw:
        raise ValueError("symbol is required")
    if raw.startswith("^") or "." in raw:
        return raw.lower()
    return f"{raw}.US".lower()


def stooq_url(request: DownloadRequest) -> str:
    interval = request.interval.lower()
    if interval not in STOOQ_INTERVALS:
        raise ValueError(f"unsupported stooq interval: {request.interval}")
    params = {
        "s": normalize_stooq_symbol(request.symbol, request.provider_symbol),
        "i": interval,
    }
    start = normalize_date(request.start)
    end = normalize_date(request.end)
    if start:
        params["d1"] = start
    if end:
        params["d2"] = end
    return f"{STOOQ_BASE_URL}?{urllib.parse.urlencode(params)}"


def download_text(url: str, timeout: float = 20.0) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "QuantOps-cli/0.1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - user-triggered market data download
        return response.read().decode("utf-8-sig")


def _number(value: str) -> float | int | None:
    text = value.strip()
    if not text:
        return None
    try:
        parsed = float(text)
    except ValueError:
        return None
    return int(parsed) if parsed.is_integer() else parsed


def parse_stooq_csv(text: str) -> list[dict[str, Any]]:
    stripped = text.strip()
    if not stripped:
        return []
    if stripped.lower().startswith("no data") or "exceeded the daily hits limit" in stripped.lower():
        raise ValueError(stripped)
    rows: list[dict[str, Any]] = []
    reader = csv.DictReader(stripped.splitlines())
    for row in reader:
        date = (row.get("Date") or row.get("date") or "").strip()
        if not date:
            continue
        rows.append(
            {
                "date": date,
                "open": _number(row.get("Open", "")),
                "high": _number(row.get("High", "")),
                "low": _number(row.get("Low", "")),
                "close": _number(row.get("Close", "")),
                "volume": _number(row.get("Volume", "")),
            }
        )
    return rows


def safe_dataset_name(symbol: str, interval: str) -> str:
    return f"{symbol.lower().replace('^', 'idx_').replace('.', '_')}_{interval.lower()}"


def raw_download_path(base: str | Path | None, source: str, symbol: str, interval: str) -> Path:
    return data_dir(base) / "downloads" / source / f"{safe_dataset_name(symbol, interval)}.csv"


def market_dataset_path(base: str | Path | None, source: str, symbol: str, interval: str) -> Path:
    return data_dir(base) / "market" / source / f"{safe_dataset_name(symbol, interval)}.jsonl"


def manifest_path(base: str | Path | None) -> Path:
    return data_dir(base) / "downloads" / "manifest.jsonl"


def _merge_by_key(path: Path, rows: list[dict[str, Any]], key_fields: tuple[str, ...]) -> int:
    existing = read_jsonl(path)
    merged = {tuple(str(row.get(field, "")) for field in key_fields): row for row in existing}
    before = len(merged)
    for row in rows:
        merged[tuple(str(row.get(field, "")) for field in key_fields)] = row
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(merged.values(), key=lambda row: tuple(str(row.get(field, "")) for field in key_fields))
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in ordered),
        encoding="utf-8",
    )
    return len(merged) - before


def download_stooq_history(
    request: DownloadRequest,
    *,
    base: str | Path | None = None,
    fetcher: Callable[[str], str] | None = None,
) -> dict[str, Any]:
    fetcher = fetcher or download_text
    provider_symbol = normalize_stooq_symbol(request.symbol, request.provider_symbol)
    normalized = DownloadRequest(
        symbol=request.symbol.upper(),
        source="stooq",
        interval=request.interval.lower(),
        start=request.start,
        end=request.end,
        provider_symbol=provider_symbol,
    )
    url = stooq_url(normalized)
    fetched_at = utc_now()
    csv_text = fetcher(url)
    parsed_rows = parse_stooq_csv(csv_text)
    raw_path = raw_download_path(base, "stooq", provider_symbol, normalized.interval)
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(csv_text if csv_text.endswith("\n") else csv_text + "\n", encoding="utf-8")

    records = [
        {
            "ticker": normalized.symbol,
            "provider_symbol": provider_symbol,
            "source": "stooq",
            "interval": normalized.interval,
            "date": row["date"],
            "fetched_at": fetched_at,
            "payload": {field: row[field] for field in OHLCV_FIELDS},
        }
        for row in parsed_rows
    ]
    dataset_path = market_dataset_path(base, "stooq", provider_symbol, normalized.interval)
    new_rows = _merge_by_key(dataset_path, records, ("source", "provider_symbol", "interval", "date"))
    manifest = {
        "fetched_at": fetched_at,
        "source": "stooq",
        "ticker": normalized.symbol,
        "provider_symbol": provider_symbol,
        "interval": normalized.interval,
        "start": normalize_date(normalized.start),
        "end": normalize_date(normalized.end),
        "url": url,
        "raw_path": str(raw_path),
        "dataset_path": str(dataset_path),
        "rows": len(records),
        "new_rows": new_rows,
    }
    append_jsonl(manifest_path(base), manifest)
    return {"ok": True, **manifest}


def download_history(request: DownloadRequest, *, base: str | Path | None = None, fetcher: Callable[[str], str] | None = None) -> dict[str, Any]:
    if request.source != "stooq":
        raise ValueError(f"unsupported source: {request.source}")
    return download_stooq_history(request, base=base, fetcher=fetcher)


def download_watchlist(
    *,
    base: str | Path | None = None,
    source: str = "stooq",
    interval: str = "d",
    start: str | None = None,
    end: str | None = None,
    fetcher: Callable[[str], str] | None = None,
) -> dict[str, Any]:
    results = []
    for ticker in read_watchlist(base):
        try:
            results.append(download_history(DownloadRequest(symbol=ticker, source=source, interval=interval, start=start, end=end), base=base, fetcher=fetcher))
        except Exception as exc:
            results.append({"ok": False, "ticker": ticker, "source": source, "error": str(exc)})
    failed = [item for item in results if not item.get("ok")]
    return {"ok": not failed, "downloaded": len(results) - len(failed), "failed": len(failed), "results": results}


def list_datasets(base: str | Path | None = None) -> list[dict[str, Any]]:
    root = data_dir(base) / "market"
    if not root.exists():
        return []
    datasets = []
    for path in sorted(root.glob("*/*.jsonl")):
        rows = read_jsonl(path)
        first = rows[0] if rows else {}
        latest = rows[-1] if rows else {}
        datasets.append(
            {
                "source": path.parent.name,
                "name": path.stem,
                "path": str(path),
                "rows": len(rows),
                "first_date": first.get("date"),
                "latest_date": latest.get("date"),
                "symbol": latest.get("ticker"),
                "provider_symbol": latest.get("provider_symbol"),
                "interval": latest.get("interval"),
            }
        )
    return datasets
