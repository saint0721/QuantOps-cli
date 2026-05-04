from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from . import __version__
from .analysis import history_rows
from .storage import data_dir, quote_history_path, read_jsonl, read_watchlist, utc_now
from . import toss

APP_NAME = "TossQuant"


def runtime_dir(base: str | Path | None = "data") -> Path:
    path = data_dir(base) / "runtime"
    path.mkdir(parents=True, exist_ok=True)
    return path


def runtime_state_path(base: str | Path | None = "data") -> Path:
    return runtime_dir(base) / "state.json"


def _git_branch(cwd: str | Path | None = None) -> str:
    try:
        completed = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=str(cwd or Path.cwd()),
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError:
        return "unknown"
    branch = (completed.stdout or "").strip()
    return branch or "unknown"


def quote_sample_counts(base: str | Path | None = "data") -> dict[str, int]:
    root = data_dir(base)
    quote_dir = root / "quotes"
    if not quote_dir.exists():
        return {}
    counts: dict[str, int] = {}
    for path in sorted(quote_dir.glob("*.jsonl")):
        try:
            counts[path.stem.upper()] = len(read_jsonl(path))
        except Exception:
            counts[path.stem.upper()] = 0
    return counts


def status_summary(base: str | Path | None = "data") -> dict[str, Any]:
    counts = quote_sample_counts(base)
    watchlist = read_watchlist(base)
    ready = sorted([ticker for ticker, count in counts.items() if count >= 3])
    needs_more = sorted([ticker for ticker in set(watchlist) | set(counts) if counts.get(ticker, 0) < 3])
    return {"watchlist": watchlist, "counts": counts, "ready": ready, "needs_more": needs_more}


def latest_quote_timestamp(ticker: str, base: str | Path | None = "data") -> str | None:
    try:
        rows = history_rows(read_jsonl(quote_history_path(ticker, base)))
    except Exception:
        return None
    if not rows:
        return None
    value = rows[-1].get("fetched_at")
    return str(value) if value is not None else None


def build_runtime_snapshot(
    *,
    mode: str = "quant",
    last_action: str = "ready",
    base: str | Path | None = "data",
    cwd: str | Path | None = None,
) -> dict[str, Any]:
    summary = status_summary(base)
    counts = summary["counts"]
    latest = {ticker: latest_quote_timestamp(ticker, base) for ticker in counts}
    return {
        "app": APP_NAME,
        "version": __version__,
        "branch": _git_branch(cwd),
        "pid": os.getpid(),
        "tmux": bool(os.environ.get("TMUX")),
        "mode": mode,
        "last_action": last_action,
        "watchlist_count": len(summary["watchlist"]),
        "watchlist": summary["watchlist"],
        "quote_files": len(counts),
        "quote_samples": sum(counts.values()),
        "quote_counts": counts,
        "latest_quotes": latest,
        "classify_ready": summary["ready"],
        "needs_more": summary["needs_more"],
        "codex": "ready" if shutil.which("codex") else "missing",
        "tossctl": toss.tossctl_path(),
        "updated_at": utc_now(),
    }


def write_runtime_snapshot(snapshot: dict[str, Any], base: str | Path | None = "data") -> Path:
    path = runtime_state_path(base)
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def read_runtime_snapshot(base: str | Path | None = "data") -> dict[str, Any] | None:
    path = runtime_state_path(base)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def record_runtime(
    *,
    mode: str = "quant",
    last_action: str = "ready",
    base: str | Path | None = "data",
    cwd: str | Path | None = None,
) -> dict[str, Any]:
    snapshot = build_runtime_snapshot(mode=mode, last_action=last_action, base=base, cwd=cwd)
    write_runtime_snapshot(snapshot, base)
    return snapshot


def render_runtime_line(snapshot: dict[str, Any]) -> str:
    branch = snapshot.get("branch") or "unknown"
    mode = snapshot.get("mode") or "quant"
    watchlist = snapshot.get("watchlist_count", 0)
    quote_files = snapshot.get("quote_files", 0)
    quote_samples = snapshot.get("quote_samples", 0)
    ready = len(snapshot.get("classify_ready") or [])
    codex = snapshot.get("codex") or "missing"
    last_action = snapshot.get("last_action") or "ready"
    updated_at = snapshot.get("updated_at") or "unknown"
    return (
        f"[TossQuant] {branch} | mode:{mode} | watchlist:{watchlist} | "
        f"quotes:{quote_files}/{quote_samples} samples | classify-ready:{ready} | "
        f"codex:{codex} | last:{last_action} | updated:{updated_at}"
    )


def current_runtime_line(
    *,
    mode: str = "quant",
    last_action: str = "ready",
    base: str | Path | None = "data",
    cwd: str | Path | None = None,
) -> str:
    return render_runtime_line(record_runtime(mode=mode, last_action=last_action, base=base, cwd=cwd))
