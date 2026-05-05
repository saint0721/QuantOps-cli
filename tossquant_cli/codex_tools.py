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
- Recommend QuantOps commands, research steps, and data-quality checks only.
- Only recommend currently supported QuantOps commands listed in this prompt; describe unavailable future ideas without command syntax.
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

RESET = "\033[0m"
CODEX_BORDER = "\033[38;5;111m"
CODEX_TEXT = "\033[38;5;252m"
USER_BORDER = "\033[38;5;213m"
USER_TEXT = "\033[38;5;255m"
CODEX_DIM = "\033[2m"

NOISE_PREFIXES = (
    "hook:",
    "warning: Codex could not find bubblewrap",
    "OpenAI Codex ",
    "workdir:",
    "model:",
    "provider:",
    "approval:",
    "sandbox:",
    "reasoning effort:",
    "reasoning summaries:",
    "session id:",
    "Reading additional input from stdin",
)

NOISE_EXACT = {"--------", "tokens used"}


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
    """Build a bounded, redacted local QuantOps context for Codex prompts."""
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
            f"QuantOps task: {task_name}",
            SAFETY_INSTRUCTIONS.strip(),
            "Currently supported QuantOps commands:",
            "\n".join(f"- {command}" for command in SUPPORTED_COMMANDS),
            "Local redacted context:",
            json.dumps(redact(context), ensure_ascii=False, indent=2, sort_keys=True),
            "Task instructions:",
            instructions.strip(),
        ]
    )


def filtered_codex_output(stdout: str, stderr: str = "") -> str:
    """Return user-facing Codex output without CLI transcript/hooks/noisy warnings."""
    lines = (stdout.splitlines() + stderr.splitlines())
    visible: list[str] = []
    skip_user_prompt = False
    skip_token_count = False

    for raw_line in lines:
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped:
            if visible and visible[-1] != "":
                visible.append("")
            continue
        if skip_token_count:
            skip_token_count = False
            if stripped.replace(",", "").isdigit():
                continue
        if stripped == "user":
            skip_user_prompt = True
            continue
        if stripped == "codex":
            skip_user_prompt = False
            continue
        if skip_user_prompt:
            continue
        if stripped in NOISE_EXACT:
            skip_token_count = stripped == "tokens used"
            continue
        if any(stripped.startswith(prefix) for prefix in NOISE_PREFIXES):
            continue
        visible.append(line)

    while visible and visible[0] == "":
        visible.pop(0)
    while visible and visible[-1] == "":
        visible.pop()
    return "\n".join(visible)


def print_chat_window(text: str, *, title: str, border: str, text_color: str) -> None:
    if not text.strip():
        return
    print(f"{border}╭─ {title} ─╮{RESET}")
    for line in text.splitlines():
        print(f"{border}│{RESET} {text_color}{line}{RESET}")
    print(f"{border}╰{'─' * (len(title) + 4)}╯{RESET}")


def print_codex_window(text: str, *, title: str = "Codex") -> None:
    print_chat_window(text, title=title, border=CODEX_BORDER, text_color=CODEX_TEXT)


def print_user_window(text: str, *, title: str = "You") -> None:
    print_chat_window(text, title=title, border=USER_BORDER, text_color=USER_TEXT)


def run_codex_command(command: list[str], *, title: str = "Codex") -> int:
    completed = subprocess.run(command, text=True, capture_output=True, check=False)
    output = filtered_codex_output(completed.stdout or "", completed.stderr or "")
    print_codex_window(output, title=title)
    if completed.returncode != 0:
        print(f"{CODEX_DIM}codex: exited with status {completed.returncode}{RESET}")
    return int(completed.returncode)


def run_codex_task(task_name: str, instructions: str, context: dict[str, Any], *, cwd: str | Path | None = None) -> int:
    codex = shutil.which("codex")
    if not codex:
        print("error: codex CLI not found in PATH")
        return 127
    prompt = build_task_prompt(task_name, instructions, context)
    command = [codex, "exec", "--sandbox", "read-only", "--cd", str(Path(cwd or Path.cwd())), prompt]
    return run_codex_command(command, title=f"Codex · {task_name}")
