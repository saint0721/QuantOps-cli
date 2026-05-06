from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from . import __version__
from .analysis import classify as classify_records, history_rows
from .audit import audit_all
from .data import DownloadRequest, download_history, download_watchlist, list_datasets
from .market_analysis import market_stats
from .runtime import current_runtime_line, record_runtime
from .storage import append_jsonl, quote_history_path, read_jsonl, read_watchlist, redact, snapshot_path, utc_now, write_watchlist
from . import toss

APP_NAME = "QuantOps"

ROOT_COMMANDS = [
    "doctor",
    "quote",
    "history",
    "classify",
    "stats",
    "data",
    "portfolio",
    "order",
    "audit",
    "runtime",
    "watchlist",
    "help",
]

HELP_TEXT = """QuantOps Python reference CLI — headless mode only

Primary flow:
  Run explicit commands and parse JSON/text outputs. There is no embedded conversational mode,
  no slash-command conversation mode, and no terminal dashboard.

Commands:
  doctor
  quote fetch <TICKER>        fetch quote through tossctl and save history
  quote history <TICKER>      show saved quote history and changes
  history <TICKER>            alias for quote history
  classify <TICKER>           classify ticker from quote history
  data download <SYMBOL>      download historical OHLCV into ./data
  data watchlist              download historical OHLCV for watchlist tickers
  data list                   list saved market datasets
  stats <SYMBOL>              summarize downloaded OHLCV market data
  audit [TICKER]              check local quote/watchlist data quality
  runtime line                print the one-line runtime status
  runtime snapshot            write and print ./data/runtime/state.json
  watchlist add|remove|list   manage local watchlist
  portfolio snapshot          save read-only account/portfolio snapshot
  order preview ...           preview only; no real order mutation

Safety:
  No buy/sell/hold advice. Trading mutation is not implemented here.
"""


def print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def print_success(message: str) -> None:
    print(f"ok    {message}")


def print_warn(message: str) -> None:
    print(f"warn  {message}")


def parse_json_or_raw(stdout: str, stderr: str, returncode: int) -> Any:
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return {"raw": stdout, "stderr": stderr, "returncode": returncode}


def completion_candidates(line: str, mode: str = "quant") -> list[str]:
    del mode
    parts = line.strip().split()
    if not parts:
        return sorted(ROOT_COMMANDS)
    if len(parts) == 1 and not line.endswith(" "):
        return sorted(command for command in ROOT_COMMANDS if command.startswith(parts[0]))
    command = parts[0]
    if command == "quote":
        return ["fetch", "history"]
    if command == "data":
        return ["download", "watchlist", "list"]
    if command == "runtime":
        return ["line", "snapshot"]
    if command == "watchlist":
        return ["add", "remove", "list", "fetch"]
    if command == "order":
        return ["preview"]
    if command == "portfolio":
        return ["snapshot"]
    return []


def command_quote_fetch(args: argparse.Namespace) -> int:
    ticker = args.ticker.upper()
    result = toss.quote(ticker)
    if result.ok:
        payload = redact(parse_json_or_raw(result.stdout, result.stderr, result.returncode))
        record = {"ticker": ticker, "fetched_at": utc_now(), "payload": payload}
        append_jsonl(quote_history_path(ticker, args.data_dir), record)
        print_json({"ok": True, "ticker": ticker, "saved_to": str(quote_history_path(ticker, args.data_dir)), "fetched_at": record["fetched_at"]})
        return 0
    print_json({"ok": False, "ticker": ticker, "stderr": result.stderr, "stdout": result.stdout, "returncode": result.returncode})
    return result.returncode or 1


def command_quote_history(args: argparse.Namespace) -> int:
    ticker = args.ticker.upper()
    records = read_jsonl(quote_history_path(ticker, args.data_dir))
    print_json({"ticker": ticker, "samples": len(records), "history": history_rows(records)})
    return 0


def command_classify(args: argparse.Namespace) -> int:
    ticker = args.ticker.upper()
    records = read_jsonl(quote_history_path(ticker, args.data_dir))
    print_json({"ticker": ticker, **classify_records(records)})
    return 0


def command_data_download(args: argparse.Namespace) -> int:
    request = DownloadRequest(symbol=args.symbol, source=args.source, interval=args.interval, start=args.start, end=args.end, provider_symbol=args.provider_symbol)
    result = download_history(request, base=args.data_dir)
    print_json(result)
    return 0 if result.get("ok") else 1


def command_data_watchlist(args: argparse.Namespace) -> int:
    result = download_watchlist(base=args.data_dir, source=args.source, interval=args.interval, start=args.start, end=args.end)
    print_json(result)
    return 0 if result.get("ok") else 1


def command_data_list(args: argparse.Namespace) -> int:
    print_json({"ok": True, "datasets": list_datasets(args.data_dir)})
    return 0


def command_stats(args: argparse.Namespace) -> int:
    result = market_stats(args.symbol, base=args.data_dir, source=args.source, interval=args.interval, provider_symbol=args.provider_symbol)
    print_json(result)
    return 0 if result.get("ok") else 1


def command_audit(args: argparse.Namespace) -> int:
    findings = audit_all(args.data_dir, args.ticker)
    print_json({"ok": not any(item.get("severity") == "error" for item in findings), "findings": findings})
    return 1 if any(item.get("severity") == "error" for item in findings) else 0


def command_portfolio_snapshot(args: argparse.Namespace) -> int:
    summary = toss.account_summary()
    positions = toss.portfolio_positions()
    payload = {
        "account_summary": redact(parse_json_or_raw(summary.stdout, summary.stderr, summary.returncode)),
        "positions": redact(parse_json_or_raw(positions.stdout, positions.stderr, positions.returncode)),
        "errors": [item for item in [summary.stderr or summary.stdout if not summary.ok else None, positions.stderr or positions.stdout if not positions.ok else None] if item],
    }
    record = {"fetched_at": utc_now(), "payload": payload}
    path = snapshot_path("portfolio", args.data_dir)
    append_jsonl(path, record)
    print_json({"ok": summary.ok and positions.ok, "saved_to": str(path), "fetched_at": record["fetched_at"], "errors": payload["errors"]})
    return 0 if summary.ok and positions.ok else 1


def command_order_preview(args: argparse.Namespace) -> int:
    result = toss.order_preview(args.flags)
    if result.ok:
        print(result.stdout.strip())
        return 0
    print_json({"ok": False, "stderr": result.stderr, "stdout": result.stdout, "returncode": result.returncode})
    return result.returncode or 1


def command_watchlist(args: argparse.Namespace) -> int:
    tickers = read_watchlist(args.data_dir)
    if args.watchlist_cmd == "list":
        print_json({"watchlist": tickers})
        return 0
    if args.watchlist_cmd == "add":
        write_watchlist([*tickers, args.ticker], args.data_dir)
        print_success(f"{args.ticker.upper()} added to watchlist")
        return 0
    if args.watchlist_cmd == "remove":
        write_watchlist([item for item in tickers if item != args.ticker.upper()], args.data_dir)
        print_success(f"{args.ticker.upper()} removed from watchlist")
        return 0
    if args.watchlist_cmd == "fetch":
        code = 0
        for ticker in tickers:
            child = argparse.Namespace(ticker=ticker, data_dir=args.data_dir)
            code = command_quote_fetch(child) or code
        return code
    print_warn("usage: watchlist [list|add <TICKER>|remove <TICKER>|fetch]")
    return 2


def command_runtime_line(args: argparse.Namespace) -> int:
    print(current_runtime_line(base=args.data_dir, last_action="runtime.line"))
    return 0


def command_runtime_snapshot(args: argparse.Namespace) -> int:
    print_json(record_runtime(base=args.data_dir, last_action="runtime.snapshot"))
    return 0


def command_doctor(args: argparse.Namespace) -> int:
    toss_version = toss.version()
    auth = toss.auth_status()
    print_json(
        {
            "ok": True,
            "app": APP_NAME,
            "version": __version__,
            "interface": "shell-cli",
            "data_dir": str(Path(args.data_dir)),
            "tossctl": toss.tossctl_path(),
            "tossctl_version_ok": toss_version.ok,
            "auth_status_ok": auth.ok,
            "broker_optional": True,
        }
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="quantops", description="QuantOps Python reference CLI — headless mode only")
    parser.add_argument("--data-dir", default="data")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("doctor").set_defaults(func=command_doctor)
    sub.add_parser("help").set_defaults(func=lambda args: (print(HELP_TEXT), 0)[1])

    quote = sub.add_parser("quote")
    qsub = quote.add_subparsers(dest="quote_cmd", required=True)
    qfetch = qsub.add_parser("fetch")
    qfetch.add_argument("ticker")
    qfetch.set_defaults(func=command_quote_fetch)
    qhistory = qsub.add_parser("history")
    qhistory.add_argument("ticker")
    qhistory.set_defaults(func=command_quote_history)

    history = sub.add_parser("history")
    history.add_argument("ticker")
    history.set_defaults(func=command_quote_history)

    classify = sub.add_parser("classify")
    classify.add_argument("ticker")
    classify.set_defaults(func=command_classify)

    data = sub.add_parser("data")
    dsub = data.add_subparsers(dest="data_cmd", required=True)
    download = dsub.add_parser("download")
    download.add_argument("symbol")
    download.add_argument("--source", default="stooq")
    download.add_argument("--interval", default="d")
    download.add_argument("--start")
    download.add_argument("--end")
    download.add_argument("--provider-symbol")
    download.set_defaults(func=command_data_download)
    watch = dsub.add_parser("watchlist")
    watch.add_argument("--source", default="stooq")
    watch.add_argument("--interval", default="d")
    watch.add_argument("--start")
    watch.add_argument("--end")
    watch.set_defaults(func=command_data_watchlist)
    dsub.add_parser("list").set_defaults(func=command_data_list)

    stats = sub.add_parser("stats")
    stats.add_argument("symbol")
    stats.add_argument("--source", default="stooq")
    stats.add_argument("--interval", default="d")
    stats.add_argument("--provider-symbol")
    stats.set_defaults(func=command_stats)

    audit = sub.add_parser("audit")
    audit.add_argument("ticker", nargs="?")
    audit.set_defaults(func=command_audit)

    runtime = sub.add_parser("runtime")
    rsub = runtime.add_subparsers(dest="runtime_cmd", required=True)
    rsub.add_parser("line").set_defaults(func=command_runtime_line)
    rsub.add_parser("snapshot").set_defaults(func=command_runtime_snapshot)

    watchlist = sub.add_parser("watchlist")
    wsub = watchlist.add_subparsers(dest="watchlist_cmd", required=True)
    wsub.add_parser("list").set_defaults(func=command_watchlist)
    wadd = wsub.add_parser("add")
    wadd.add_argument("ticker")
    wadd.set_defaults(func=command_watchlist)
    wremove = wsub.add_parser("remove")
    wremove.add_argument("ticker")
    wremove.set_defaults(func=command_watchlist)
    wsub.add_parser("fetch").set_defaults(func=command_watchlist)

    portfolio = sub.add_parser("portfolio")
    psub = portfolio.add_subparsers(dest="portfolio_cmd", required=True)
    psub.add_parser("snapshot").set_defaults(func=command_portfolio_snapshot)

    order = sub.add_parser("order")
    osub = order.add_subparsers(dest="order_cmd", required=True)
    preview = osub.add_parser("preview")
    preview.add_argument("flags", nargs=argparse.REMAINDER)
    preview.set_defaults(func=command_order_preview)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        print(HELP_TEXT)
        return 0
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
