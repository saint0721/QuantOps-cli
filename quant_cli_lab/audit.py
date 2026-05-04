from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from .analysis import extract_price, history_rows
from .storage import SENSITIVE_KEYS, quote_history_path, read_watchlist

SENSITIVE_TERMS = SENSITIVE_KEYS


def finding(severity: str, code: str, message: str, *, ticker: str | None = None, next_command: str | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {"severity": severity, "code": code, "message": message}
    if ticker:
        item["ticker"] = ticker.upper()
    if next_command:
        item["next_command"] = next_command
    return item


def _contains_sensitive_key(value: Any) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = str(key).lower().replace("-", "_")
            if normalized in SENSITIVE_TERMS:
                return True
            if _contains_sensitive_key(item):
                return True
    if isinstance(value, list):
        return any(_contains_sensitive_key(item) for item in value)
    return False


def _read_jsonl_for_audit(path: Path, ticker: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not path.exists():
        return [], []
    records: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            findings.append(
                finding(
                    "error",
                    "malformed_record",
                    f"{path} line {line_number} is not valid JSON: {exc.msg}",
                    ticker=ticker,
                    next_command=f"history {ticker}",
                )
            )
            continue
        if not isinstance(payload, dict):
            findings.append(
                finding(
                    "error",
                    "malformed_record",
                    f"{path} line {line_number} is a {type(payload).__name__}, expected object",
                    ticker=ticker,
                    next_command=f"history {ticker}",
                )
            )
            continue
        records.append(payload)
    return records, findings


def _valid_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def audit_watchlist(base: str | Path | None = "data") -> list[dict[str, Any]]:
    watchlist = read_watchlist(base)
    if watchlist:
        return []
    return [
        finding(
            "warn",
            "empty_watchlist",
            "watchlist is empty; add at least one ticker before running quote/history workflows",
            next_command="/watchlist add AAPL",
        )
    ]


def audit_quotes(base: str | Path | None = "data", ticker: str | None = None) -> list[dict[str, Any]]:
    watchlist = read_watchlist(base)
    tickers = [ticker.upper()] if ticker else watchlist
    findings: list[dict[str, Any]] = []
    for symbol in tickers:
        path = quote_history_path(symbol, base)
        records, read_findings = _read_jsonl_for_audit(path, symbol)
        findings.extend(read_findings)
        if not records:
            if read_findings:
                continue
            findings.append(finding("warn", "missing_quote_history", f"no quote history found for {symbol}", ticker=symbol, next_command=f"quote {symbol}"))
            continue
        seen_timestamps: set[str] = set()
        for index, record in enumerate(records):
            fetched_at = record.get("fetched_at")
            if not fetched_at:
                findings.append(finding("error", "missing_fetched_at", f"record {index} has no fetched_at timestamp", ticker=symbol, next_command=f"history {symbol}"))
            elif not _valid_timestamp(fetched_at):
                findings.append(finding("error", "invalid_timestamp", f"record {index} has invalid fetched_at timestamp: {fetched_at}", ticker=symbol, next_command=f"history {symbol}"))
            elif fetched_at in seen_timestamps:
                findings.append(finding("warn", "duplicate_timestamp", f"duplicate fetched_at timestamp: {fetched_at}", ticker=symbol, next_command=f"history {symbol}"))
            else:
                seen_timestamps.add(str(fetched_at))
            if extract_price(record.get("payload")) is None:
                findings.append(finding("error", "missing_price", f"record {index} has no extractable price", ticker=symbol, next_command=f"quote {symbol}"))
            if _contains_sensitive_key(record):
                findings.append(finding("error", "sensitive_key", f"record {index} contains a sensitive-looking key", ticker=symbol))
        rows = [row for row in history_rows(records) if row.get("price") is not None]
        for previous, current in zip(rows, rows[1:]):
            previous_price = previous.get("price")
            current_price = current.get("price")
            if previous_price in (None, 0) or current_price is None:
                continue
            change = float(current_price) / float(previous_price) - 1.0
            if abs(change) > 0.30:
                findings.append(
                    finding(
                        "warn",
                        "large_price_jump",
                        f"adjacent quote price changed by {change:.1%}; verify source payload",
                        ticker=symbol,
                        next_command=f"history {symbol}",
                    )
                )
    return findings


def audit_all(base: str | Path | None = "data", ticker: str | None = None) -> list[dict[str, Any]]:
    findings = []
    if ticker is None:
        findings.extend(audit_watchlist(base))
    findings.extend(audit_quotes(base, ticker))
    return findings
