from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .analysis import history_rows
from .storage import quote_history_path, read_watchlist, redact


SAFETY_INSTRUCTIONS = """Safety rules:
- Do not recommend direct buy/sell/hold decisions.
- Recommend TossQuant commands, research steps, and data-quality checks only.
- Only recommend currently supported TossQuant commands listed in this prompt; describe unavailable future ideas without command syntax.
- Do not request, infer, or print API keys, tokens, account identifiers, or credentials.
- Treat this as educational analysis, not financial advice.
- Do not suggest real order execution; order-related discussion must remain preview-only.
"""

SUPPORTED_STRATEGY_TOPICS = ("momentum", "mean-reversion", "event-study", "risk")
MAX_ROWS_PER_TICKER = 5
SUPPORTED_COMMANDS = (
    "doctor",
    "quote <TICKER>",
    "history <TICKER>",
    "classify <TICKER>",
    "portfolio",
    "/status",
    "/next",
    "/watchlist add <TICKER>",
    "/watchlist list",
    "/watchlist fetch",
    "/learn momentum",
    "/learn mean-reversion",
    "/learn backtest",
    "/learn risk",
    "/brief",
    "/today",
    "/audit",
    "/audit <TICKER>",
    "/audit <TICKER> explain",
    "/strategy <TICKER> momentum",
    "/strategy <TICKER> mean-reversion",
    "/strategy <TICKER> event-study",
    "/strategy <TICKER> risk",
)


def _safe_read_jsonl(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    if not path.exists():
        return [], []
    records: list[dict[str, Any]] = []
    warnings: list[str] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            warnings.append(f"{path} line {line_number} skipped: {exc.msg}")
            continue
        if isinstance(payload, dict):
            records.append(payload)
        else:
            warnings.append(f"{path} line {line_number} skipped: expected object, got {type(payload).__name__}")
    return records, warnings


def _quote_summary_for_ticker(ticker: str, base: str | Path | None = None) -> dict[str, Any]:
    records, warnings = _safe_read_jsonl(quote_history_path(ticker, base))
    rows = history_rows(records)
    priced = [row for row in rows if row.get("price") is not None]
    summary: dict[str, Any] = {
        "ticker": ticker.upper(),
        "samples": len(records),
        "priced_samples": len(priced),
        "latest": redact(rows[-1]) if rows else None,
        "recent_rows": redact(rows[-MAX_ROWS_PER_TICKER:]),
        "warnings": warnings[:3],
    }
    if priced:
        first = priced[0].get("price")
        last = priced[-1].get("price")
        summary["first_price"] = first
        summary["last_price"] = last
        summary["total_change"] = None if first in (None, 0) else (float(last) / float(first) - 1.0)
    return summary


def build_local_context(base: str | Path | None = "data", ticker: str | None = None) -> dict[str, Any]:
    """Build a bounded, redacted local TossQuant context for Codex prompts."""
    watchlist = read_watchlist(base)
    requested = ticker.upper() if ticker else None
    tickers = sorted({*(watchlist or []), *([requested] if requested else [])})
    return redact(
        {
            "watchlist": watchlist,
            "requested_ticker": requested,
            "quotes": [_quote_summary_for_ticker(item, base) for item in tickers],
            "context_notes": [
                "Local quote summaries are bounded to recent rows.",
                "Raw account snapshots are intentionally excluded from Codex context.",
            ],
        }
    )


def build_task_prompt(task_name: str, instructions: str, context: dict[str, Any]) -> str:
    return "\n\n".join(
        [
            f"TossQuant task: {task_name}",
            SAFETY_INSTRUCTIONS.strip(),
            "Currently supported TossQuant commands:",
            "\n".join(f"- {command}" for command in SUPPORTED_COMMANDS),
            "Local redacted context:",
            json.dumps(redact(context), ensure_ascii=False, indent=2, sort_keys=True),
            "Task instructions:",
            instructions.strip(),
        ]
    )


def run_codex_task(task_name: str, instructions: str, context: dict[str, Any], *, cwd: str | Path | None = None) -> int:
    codex = shutil.which("codex")
    if not codex:
        print("error: codex CLI not found in PATH")
        return 127
    prompt = build_task_prompt(task_name, instructions, context)
    command = [codex, "exec", "--sandbox", "read-only", "--cd", str(Path(cwd or Path.cwd())), prompt]
    print(f"codex: running {task_name} read-only.")
    completed = subprocess.run(command)
    if completed.returncode != 0:
        print(f"codex: exited with status {completed.returncode}")
    return int(completed.returncode)
