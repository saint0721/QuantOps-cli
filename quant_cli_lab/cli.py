from __future__ import annotations

import argparse
import json
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Any

from . import __version__
from .analysis import classify as classify_records, history_rows
from .storage import append_jsonl, quote_history_path, read_jsonl, redact, snapshot_path, utc_now
from . import toss

APP_NAME = "TossQuant"
PROMPT = "tossquant> "
CODEX_PROMPT = "tossquant/codex> "

BANNER = r"""
████████╗ ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗████████╗
╚══██╔══╝██╔═══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗████╗  ██║╚══██╔══╝
   ██║   ██║   ██║███████╗███████╗██║   ██║██║   ██║███████║██╔██╗ ██║   ██║
   ██║   ██║   ██║╚════██║╚════██║██║▄▄ ██║██║   ██║██╔══██║██║╚██╗██║   ██║
   ██║   ╚██████╔╝███████║███████║╚██████╔╝╚██████╔╝██║  ██║██║ ╚████║   ██║
   ╚═╝    ╚═════╝ ╚══════╝╚══════╝ ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝
"""

HELP_TEXT = """TossQuant commands:
  doctor
  quote fetch <TICKER>        fetch quote through tossctl and save history
  quote history <TICKER>      show saved quote history and changes
  classify <TICKER>           classify ticker from quote history
  portfolio snapshot          save read-only account/portfolio snapshot
  order preview --symbol ...  preview only; no real order mutation
  help | /help
  exit | quit

Short aliases inside interactive mode:
  quote <TICKER>              same as quote fetch <TICKER>
  history <TICKER>            same as quote history <TICKER>
  portfolio                   same as portfolio snapshot

Codex bridge slash commands:
  /ask <QUESTION>             ask Codex once, using read-only sandbox
  /codex                      enter Codex conversation mode
  /quant                      return to normal quant command mode
  /modes                      show current modes and safety defaults
"""

START_HERE_TEXT = """Start here:
  1) doctor                   check tossctl/auth/data setup
  2) quote AAPL               fetch one quote sample into ./data
  3) history AAPL             inspect saved samples
  4) classify AAPL            get a simple strategy-candidate label
  5) /ask what should I study next?

Type /help for every command. TossQuant stays quiet until you run a command.
"""

MODES_TEXT = """Modes:
  quant   default; local TossQuant commands only
  codex   only after /codex; each message is sent to: codex exec --sandbox read-only

Safety defaults:
  - Codex bridge is opt-in, never always-on
  - Codex runs read-only by default from this project directory
  - Trading remains preview-only; TossQuant has no real order mutation command
"""


def print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def command_doctor(args: argparse.Namespace) -> int:
    data = Path(args.data_dir)
    checks = {
        "app": APP_NAME,
        "version": __version__,
        "tossctl_path": toss.tossctl_path(),
        "data_dir": str(data),
        "trading_mutations": "disabled",
    }
    version = toss.version()
    checks["tossctl_version_ok"] = version.ok
    checks["tossctl_version"] = (version.stdout or version.stderr).strip()
    auth = toss.auth_status()
    checks["auth_status_ok"] = auth.ok
    checks["auth_status"] = (auth.stdout or auth.stderr).strip()
    data.mkdir(parents=True, exist_ok=True)
    print_json(checks)
    return 0 if version.ok else 1


def command_quote_fetch(args: argparse.Namespace) -> int:
    result = toss.quote(args.ticker)
    if not result.ok:
        print_json({"ok": False, "command": result.command, "error": result.stderr or result.stdout})
        return result.returncode or 1
    try:
        payload = result.json()
    except json.JSONDecodeError:
        payload = {"raw": result.stdout}
    record = {"ticker": args.ticker.upper(), "fetched_at": utc_now(), "source": "tossctl quote get", "payload": redact(payload)}
    path = quote_history_path(args.ticker, args.data_dir)
    append_jsonl(path, record)
    print_json({"ok": True, "saved_to": str(path), "ticker": args.ticker.upper(), "fetched_at": record["fetched_at"]})
    return 0


def command_quote_history(args: argparse.Namespace) -> int:
    records = read_jsonl(quote_history_path(args.ticker, args.data_dir))
    print_json({"ticker": args.ticker.upper(), "samples": len(records), "history": history_rows(records)})
    return 0


def command_classify(args: argparse.Namespace) -> int:
    records = read_jsonl(quote_history_path(args.ticker, args.data_dir))
    result = classify_records(records)
    result["ticker"] = args.ticker.upper()
    print_json(result)
    return 0


def command_portfolio_snapshot(args: argparse.Namespace) -> int:
    summary = toss.account_summary()
    positions = toss.portfolio_positions()
    payload = {
        "account_summary": redact(_json_or_raw(summary)),
        "positions": redact(_json_or_raw(positions)),
        "errors": [item for item in [None if summary.ok else summary.stderr or summary.stdout, None if positions.ok else positions.stderr or positions.stdout] if item],
    }
    record = {"fetched_at": utc_now(), "source": "tossctl account/portfolio", "payload": payload}
    path = snapshot_path("portfolio", args.data_dir)
    append_jsonl(path, record)
    print_json({"ok": summary.ok and positions.ok, "saved_to": str(path), "fetched_at": record["fetched_at"], "errors": payload["errors"]})
    return 0 if summary.ok and positions.ok else 1


def _json_or_raw(result: toss.TossResult) -> Any:
    try:
        return result.json()
    except Exception:
        return {"raw": result.stdout, "stderr": result.stderr, "returncode": result.returncode}


def command_order_preview(args: argparse.Namespace) -> int:
    flags = []
    for name in ("symbol", "side", "qty", "price", "type", "market", "amount"):
        value = getattr(args, name)
        if value is not None:
            flags.extend([f"--{name}", str(value)])
    if args.fractional:
        flags.append("--fractional")
    result = toss.order_preview(flags)
    if result.ok:
        print(result.stdout.strip())
        return 0
    print_json({"ok": False, "command": result.command, "error": result.stderr or result.stdout})
    return result.returncode or 1


class TossQuantArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ValueError(message)


def build_parser(*, interactive: bool = False) -> argparse.ArgumentParser:
    parser_cls = TossQuantArgumentParser if interactive else argparse.ArgumentParser
    parser = parser_cls(prog="tossquant", description="TossQuant: CLI-first quant learning tools around tossctl")
    parser.add_argument("--data-dir", default="data", help="Local non-sensitive data directory")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor").set_defaults(func=command_doctor)

    quote = sub.add_parser("quote")
    qsub = quote.add_subparsers(dest="quote_cmd", required=True)
    qfetch = qsub.add_parser("fetch")
    qfetch.add_argument("ticker")
    qfetch.set_defaults(func=command_quote_fetch)
    qhist = qsub.add_parser("history")
    qhist.add_argument("ticker")
    qhist.set_defaults(func=command_quote_history)

    classify_p = sub.add_parser("classify")
    classify_p.add_argument("ticker")
    classify_p.set_defaults(func=command_classify)

    portfolio = sub.add_parser("portfolio")
    psub = portfolio.add_subparsers(dest="portfolio_cmd", required=True)
    psnap = psub.add_parser("snapshot")
    psnap.set_defaults(func=command_portfolio_snapshot)

    order = sub.add_parser("order")
    osub = order.add_subparsers(dest="order_cmd", required=True)
    preview = osub.add_parser("preview")
    preview.add_argument("--symbol", required=True)
    preview.add_argument("--side", choices=["buy", "sell"], required=True)
    preview.add_argument("--qty", type=float)
    preview.add_argument("--price", type=float)
    preview.add_argument("--type", default="limit")
    preview.add_argument("--market", default="us")
    preview.add_argument("--amount", type=float)
    preview.add_argument("--fractional", action="store_true")
    preview.set_defaults(func=command_order_preview)
    return parser



def run_codex_prompt(prompt: str) -> int:
    """Ask Codex once from TossQuant without granting write access."""
    prompt = prompt.strip()
    if not prompt:
        print("usage: /ask <QUESTION>")
        return 2
    codex = shutil.which("codex")
    if not codex:
        print("error: codex CLI not found in PATH")
        return 127
    command = [codex, "exec", "--sandbox", "read-only", "--cd", str(Path.cwd()), prompt]
    print("codex: running read-only. Use /quant to return after /codex mode.")
    completed = subprocess.run(command)
    if completed.returncode != 0:
        print(f"codex: exited with status {completed.returncode}")
    return int(completed.returncode)


def print_start_here() -> None:
    print(START_HERE_TEXT)


def print_modes(active_mode: str) -> None:
    print(MODES_TEXT.rstrip())
    print(f"Current mode: {active_mode}")

def normalize_interactive_command(parts: list[str]) -> list[str]:
    if not parts:
        return parts
    if parts[0] == "quote" and len(parts) == 2:
        return ["quote", "fetch", parts[1]]
    if parts[0] == "history" and len(parts) == 2:
        return ["quote", "history", parts[1]]
    if parts[0] == "portfolio" and len(parts) == 1:
        return ["portfolio", "snapshot"]
    return parts


def run_once(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


def run_interactive() -> int:
    print("\033[96m" + BANNER + "\033[0m")
    print(f"{APP_NAME} {__version__}  ·  tossctl read-only quant lab  ·  trading mutations disabled")
    print("data: ./data  ·  mode: quant  ·  type /help for commands, exit to quit")
    print_start_here()
    parser = build_parser(interactive=True)
    mode = "quant"
    while True:
        try:
            line = input(CODEX_PROMPT if mode == "codex" else PROMPT).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not line:
            continue
        if line in {"exit", "quit", ":q"}:
            return 0
        if line in {"help", "?", "/help"}:
            print(HELP_TEXT)
            continue
        if line == "/modes":
            print_modes(mode)
            continue
        if line == "/codex":
            mode = "codex"
            print("Codex mode enabled. Normal text now goes to Codex read-only. Type /quant to return.")
            continue
        if line == "/quant":
            mode = "quant"
            print("Quant mode enabled. Normal text is parsed as TossQuant commands again.")
            continue
        if line.startswith("/ask "):
            run_codex_prompt(line.removeprefix("/ask "))
            continue
        if line.startswith("/"):
            print(f"unknown slash command: {line.split()[0]}  (try /help)")
            continue
        if mode == "codex":
            run_codex_prompt(line)
            continue
        try:
            parts = normalize_interactive_command(shlex.split(line))
            args = parser.parse_args(parts)
            args.func(args)
        except SystemExit:
            continue
        except Exception as exc:
            print(f"error: {exc}")
    return 0


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        import sys
        argv = sys.argv[1:]
    if not argv:
        return run_interactive()
    return run_once(argv)


if __name__ == "__main__":
    raise SystemExit(main())
