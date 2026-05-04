from __future__ import annotations

import math
from pathlib import Path
from statistics import fmean
from typing import Any

from .data import market_dataset_path, normalize_stooq_symbol
from .storage import read_jsonl

TRADING_DAYS = 252


def _number(value: Any) -> float | None:
    try:
        parsed = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def market_rows(
    symbol: str,
    *,
    base: str | Path | None = None,
    source: str = "stooq",
    interval: str = "d",
    provider_symbol: str | None = None,
) -> list[dict[str, Any]]:
    resolved_symbol = normalize_stooq_symbol(symbol, provider_symbol) if source == "stooq" else (provider_symbol or symbol).lower()
    path = market_dataset_path(base, source, resolved_symbol, interval)
    records = read_jsonl(path)
    rows = []
    for record in records:
        payload = record.get("payload") if isinstance(record, dict) else None
        payload = payload if isinstance(payload, dict) else {}
        close = _number(payload.get("close"))
        if close is None:
            continue
        rows.append(
            {
                "date": record.get("date"),
                "ticker": record.get("ticker", symbol.upper()),
                "provider_symbol": record.get("provider_symbol", resolved_symbol),
                "source": record.get("source", source),
                "interval": record.get("interval", interval),
                "open": _number(payload.get("open")),
                "high": _number(payload.get("high")),
                "low": _number(payload.get("low")),
                "close": close,
                "volume": _number(payload.get("volume")),
            }
        )
    return sorted(rows, key=lambda row: str(row.get("date") or ""))


def _returns(closes: list[float]) -> list[float]:
    values = []
    for previous, current in zip(closes, closes[1:]):
        if previous == 0:
            continue
        values.append(current / previous - 1.0)
    return values


def _stddev(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    mean = fmean(values)
    return math.sqrt(sum((value - mean) ** 2 for value in values) / (len(values) - 1))


def _max_drawdown(closes: list[float]) -> float | None:
    if not closes:
        return None
    peak = closes[0]
    worst = 0.0
    for close in closes:
        peak = max(peak, close)
        if peak:
            worst = min(worst, close / peak - 1.0)
    return worst


def _moving_average(values: list[float], window: int) -> float | None:
    if len(values) < window:
        return None
    return fmean(values[-window:])


def _volume_ratio(rows: list[dict[str, Any]], window: int = 20) -> float | None:
    volumes = [row["volume"] for row in rows if row.get("volume") is not None]
    if len(volumes) < window or not volumes[-1]:
        return None
    average = fmean(volumes[-window:])
    return None if average == 0 else volumes[-1] / average


def _regime(total_return: float | None, latest_close: float | None, ma20: float | None, ma50: float | None, volatility: float | None) -> str:
    if latest_close is None:
        return "no-price-data"
    if ma20 is not None and ma50 is not None and latest_close > ma20 > ma50:
        return "trend-up"
    if ma20 is not None and ma50 is not None and latest_close < ma20 < ma50:
        return "trend-down"
    if volatility is not None and volatility > 0.04:
        return "high-volatility"
    if total_return is not None and abs(total_return) < 0.02:
        return "range-bound"
    return "watch"


def market_stats(
    symbol: str,
    *,
    base: str | Path | None = None,
    source: str = "stooq",
    interval: str = "d",
    provider_symbol: str | None = None,
) -> dict[str, Any]:
    rows = market_rows(symbol, base=base, source=source, interval=interval, provider_symbol=provider_symbol)
    if not rows:
        return {
            "ok": False,
            "ticker": symbol.upper(),
            "source": source,
            "interval": interval,
            "rows": 0,
            "error": "no market dataset found; run data download first",
            "next_command": f"data download {symbol.upper()}",
        }

    closes = [float(row["close"]) for row in rows]
    returns = _returns(closes)
    latest_close = closes[-1]
    first_close = closes[0]
    total_return = None if first_close == 0 else latest_close / first_close - 1.0
    volatility = _stddev(returns)
    annualized_volatility = None if volatility is None else volatility * math.sqrt(TRADING_DAYS)
    ma20 = _moving_average(closes, 20)
    ma50 = _moving_average(closes, 50)
    volume_ratio_20 = _volume_ratio(rows, 20)
    return {
        "ok": True,
        "ticker": str(rows[-1].get("ticker") or symbol.upper()).upper(),
        "provider_symbol": rows[-1].get("provider_symbol"),
        "source": source,
        "interval": interval,
        "rows": len(rows),
        "start_date": rows[0].get("date"),
        "end_date": rows[-1].get("date"),
        "latest_close": latest_close,
        "total_return": total_return,
        "average_return": fmean(returns) if returns else None,
        "volatility": volatility,
        "annualized_volatility": annualized_volatility,
        "max_drawdown": _max_drawdown(closes),
        "best_return": max(returns) if returns else None,
        "worst_return": min(returns) if returns else None,
        "moving_average_20": ma20,
        "moving_average_50": ma50,
        "latest_volume": rows[-1].get("volume"),
        "volume_ratio_20": volume_ratio_20,
        "regime": _regime(total_return, latest_close, ma20, ma50, volatility),
        "readiness": {
            "basic_stats": len(rows) >= 2,
            "moving_average_20": len(rows) >= 20,
            "moving_average_50": len(rows) >= 50,
            "backtest_ready": len(rows) >= 60,
        },
    }
