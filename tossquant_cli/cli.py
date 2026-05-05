from __future__ import annotations

import argparse
import json
import shlex
import shutil
from pathlib import Path
from typing import Any

try:
    import readline
except ImportError:  # pragma: no cover - platform dependent
    readline = None  # type: ignore[assignment]

from . import __version__
from .analysis import classify as classify_records, history_rows
from .audit import audit_all
from .codex_tools import SUPPORTED_STRATEGY_TOPICS, build_local_context, print_user_window, run_codex_command, run_codex_task
from .data import DownloadRequest, download_history, download_watchlist, list_datasets
from .market_analysis import market_stats
from .storage import append_jsonl, quote_history_path, read_jsonl, redact, read_watchlist, snapshot_path, utc_now, write_watchlist
from .runtime import current_runtime_line, record_runtime, status_summary as runtime_status_summary
from .hud import launch_tmux_hud, launch_tmux_runtime, print_hud_once, tmux_path, tmux_install_hint, watch_hud
from . import toss

APP_NAME = "QuantOps"
RESET = "\033[0m"
CYAN = "\033[96m"
GREEN = "\033[92m"
MAGENTA = "\033[95m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
DIM = "\033[2m"
BOLD = "\033[1m"

# readline needs non-printing ANSI spans wrapped in \001/\002 so cursor math stays correct.
RL_START = "\001"
RL_END = "\002"


ROOT_COMMANDS = [
    "doctor",
    "quote",
    "history",
    "classify",
    "stats",
    "data",
    "portfolio",
    "order",
    "brief",
    "audit",
    "strategy",
    "hud",
    "runtime",
    "tmux",
    "help",
    "exit",
    "quit",
]
SLASH_COMMANDS = [
    "/help",
    "/modes",
    "/ask",
    "/codex",
    "/quant",
    "/start",
    "/next",
    "/status",
    "/watchlist",
    "/learn",
    "/brief",
    "/today",
    "/audit",
    "/stats",
    "/data",
    "/strategy",
    "/hud",
    "/runtime",
]
COMMAND_COMPLETIONS = {
    "quote": ["fetch", "history"],
    "order": ["preview"],
    "portfolio": ["snapshot"],
    "runtime": ["line", "snapshot"],
    "hud": ["--tmux", "--watch"],
    "tmux": ["start"],
    "history": [],
    "classify": [],
    "data": ["download", "watchlist", "list"],
    "stats": [],
}

BANNER = r"""
████████╗ ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗████████╗
╚══██╔══╝██╔═══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗████╗  ██║╚══██╔══╝
   ██║   ██║   ██║███████╗███████╗██║   ██║██║   ██║███████║██╔██╗ ██║   ██║
   ██║   ██║   ██║╚════██║╚════██║██║▄▄ ██║██║   ██║██╔══██║██║╚██╗██║   ██║
   ██║   ╚██████╔╝███████║███████║╚██████╔╝╚██████╔╝██║  ██║██║ ╚████║   ██║
   ╚═╝    ╚═════╝ ╚══════╝╚══════╝ ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝
"""

HELP_TEXT = """QuantOps commands:
  doctor
  quote fetch <TICKER>        fetch quote through tossctl and save history
  quote history <TICKER>      show saved quote history and changes
  data download <SYMBOL>      download historical OHLCV data into ./data
  data watchlist              download historical data for every watchlist ticker
  data list                   list saved market datasets
  stats <SYMBOL>              summarize downloaded OHLCV market data
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
  /brief | /today             Codex session coach over local redacted data
  /audit [TICKER] [explain]   deterministic data audit; explain uses Codex
  /data download <SYMBOL>     download historical OHLCV data into ./data
  /data watchlist             download historical OHLCV for watchlist tickers
  /data list                  list saved market datasets
  /stats <SYMBOL>             summarize downloaded OHLCV market data
  /strategy <TICKER> <TOPIC>  Codex research plan: momentum, mean-reversion, event-study, risk
  /hud                        show compact runtime/status line
  /hud tmux                   open a bottom tmux HUD pane
  /runtime [line|snapshot]    inspect persisted runtime state

Runtime commands:
  hud                          print runtime HUD once
  hud --watch                  watch runtime state in the current terminal
  hud --tmux                   open a bottom tmux HUD pane
  runtime snapshot             write and print ./data/runtime/state.json
  runtime line                 print the one-line runtime status
  tmux start                   start QuantOps in tmux with bottom HUD pane

Guided learning slash commands:
  /start                      show the beginner quant workflow
  /next                       recommend the next action from your local data
  /status                     summarize saved quote samples/watchlist
  /watchlist add <TICKER>     add ticker to local watchlist
  /watchlist remove <TICKER>  remove ticker from watchlist
  /watchlist list             list watchlist
  /watchlist fetch            fetch quotes for every watchlist ticker
  /learn <TOPIC>              explain: momentum, mean-reversion, backtest, risk

Data download commands:
  quote <TICKER>              download one quote sample through tossctl
  data download AAPL          download daily historical OHLCV from Stooq into ./data
  data download AAPL --start 2026-01-01 --end 2026-01-31
  /data watchlist             download historical OHLCV for every watchlist ticker
  /data list                  list saved market datasets
  /stats AAPL                 analyze downloaded OHLCV readiness and risk
  /watchlist fetch            download quotes for every watchlist ticker
  portfolio                   save read-only account/portfolio snapshot
"""

START_HERE_TEXT = """Start here:
  1) doctor                   check tossctl/auth/data setup
  2) /watchlist add AAPL      choose a ticker
  3) quote AAPL               download one quote sample into ./data
  4) data download AAPL       download historical OHLCV into ./data/market
  5) /stats AAPL              inspect return, volatility, drawdown, trend
  6) /watchlist fetch         download quotes for every watchlist ticker
  7) /status                  see what local data is ready
  8) /audit                   check local data quality
  9) /brief                   ask Codex for a session brief
  10) /strategy AAPL momentum ask Codex for a research plan

Type /help for every command. Press Tab to autocomplete commands.
QuantOps stays quiet until you run a command.
"""

MODES_TEXT = """Modes:
  quant   default; local QuantOps commands only
  codex   only after /codex; each message is sent to: codex exec --sandbox read-only

Safety defaults:
  - Codex bridge is opt-in, never always-on
  - Codex runs read-only by default from this project directory
  - Codex recommends research steps and QuantOps commands, not buy/sell actions
  - Trading remains preview-only; QuantOps has no real order mutation command
"""

LEARN_TOPICS = {
    "momentum": (
        "Momentum",
        "최근에 강했던 자산이 단기적으로 계속 강할 수 있다는 가설입니다.",
        ["quote AAPL", "quote AAPL", "quote AAPL", "classify AAPL"],
    ),
    "mean-reversion": (
        "Mean reversion",
        "가격이 평균에서 멀어지면 다시 평균 쪽으로 돌아올 수 있다는 가설입니다.",
        ["history AAPL", "classify AAPL", "기록이 더 쌓인 뒤 변동이 과했는지 비교"],
    ),
    "backtest": (
        "Backtest",
        "과거 데이터에 규칙을 적용해 전략이 어떻게 행동했을지 검증하는 과정입니다.",
        ["먼저 quote/history로 데이터 축적", "그 다음 전략 규칙 정의", "마지막으로 수익률/손실/거래횟수 확인"],
    ),
    "risk": (
        "Risk",
        "수익보다 먼저 손실 크기, 집중도, 변동성, 최대낙폭을 관리하는 관점입니다.",
        ["portfolio", "order preview --symbol AAPL --side buy --qty 1 --price 100", "실제 주문 전 포지션 크기 점검"],
    ),
}



def color(text: str, ansi: str, *, readline_safe: bool = False) -> str:
    if readline_safe:
        return f"{RL_START}{ansi}{RL_END}{text}{RL_START}{RESET}{RL_END}"
    return f"{ansi}{text}{RESET}"


def prompt_for_mode(mode: str, *, readline_safe: bool = False, status_line: str | None = None) -> str:
    if mode == "codex":
        name = color("QuantOps", MAGENTA, readline_safe=readline_safe)
        badge = color("codex", CYAN, readline_safe=readline_safe)
    else:
        name = color("QuantOps", GREEN, readline_safe=readline_safe)
        badge = color("quant", CYAN, readline_safe=readline_safe)
    arrow = color("❯", BOLD, readline_safe=readline_safe)
    prompt = f"{name} {badge} {arrow} "
    if status_line:
        return color(status_line, DIM + BLUE, readline_safe=readline_safe) + "\n" + prompt
    return prompt


def completion_candidates(line: str, mode: str = "quant") -> list[str]:
    stripped = line.lstrip()
    if mode == "codex":
        return SLASH_COMMANDS
    if not stripped:
        return sorted(ROOT_COMMANDS + SLASH_COMMANDS)
    try:
        parts = shlex.split(stripped)
    except ValueError:
        parts = stripped.split()
    if stripped.endswith(" "):
        parts.append("")
    if len(parts) <= 1:
        return sorted(ROOT_COMMANDS + SLASH_COMMANDS)
    if parts[0] == "/watchlist":
        return ["add", "fetch", "list", "remove"]
    if parts[0] == "/learn":
        return sorted(LEARN_TOPICS)
    if parts[0] == "/audit":
        return ["explain"]
    if parts[0] == "/data":
        return ["download", "watchlist", "list"]
    if parts[0] == "/stats":
        return []
    if parts[0] == "/strategy":
        return sorted(SUPPORTED_STRATEGY_TOPICS)
    if parts[0] == "/runtime":
        return ["line", "snapshot"]
    if parts[0] == "/hud":
        return ["tmux"]
    return COMMAND_COMPLETIONS.get(parts[0], [])


def setup_readline(mode_getter: Any) -> None:
    if readline is None:
        return

    def complete(text: str, state: int) -> str | None:
        buffer = readline.get_line_buffer()
        mode = mode_getter()
        matches = [item for item in completion_candidates(buffer, mode) if item.startswith(text)]
        if state < len(matches):
            return matches[state] + " "
        return None

    readline.set_completer(complete)
    readline.parse_and_bind("tab: complete")
    readline.set_completer_delims(" \t\n")


def label(text: str, ansi: str) -> str:
    return color(text, ansi)


def print_section(title: str) -> None:
    print(label(f"\n◆ {title}", BOLD + CYAN))


def print_hint(text: str) -> None:
    print(f"  {label('hint', BLUE)}  {text}")


def print_warning(text: str) -> None:
    print(f"  {label('warn', YELLOW)}  {text}")


def print_success(text: str) -> None:
    print(f"  {label('ok', GREEN)}    {text}")


def print_command(command: str, note: str = "") -> None:
    suffix = f"  {color(note, DIM)}" if note else ""
    print(f"  {label('$', MAGENTA)} {color(command, BOLD)}{suffix}")


def runtime_status_line(mode: str, last_action: str = "ready", base: str | Path | None = "data") -> str:
    return current_runtime_line(mode=mode, last_action=last_action, base=base, cwd=Path.cwd())


def print_hud(mode: str, last_action: str = "ready", base: str | Path | None = "data") -> None:
    print_hud_once(base=base, mode=mode, last_action=last_action)


def status_summary(base: str | Path | None = None) -> dict[str, Any]:
    return runtime_status_summary(base)


def print_start_workflow() -> None:
    print_section("Beginner quant workflow")
    print("  QuantOps는 '데이터 수집 → 기록 확인 → 후보 분류 → 리스크 확인' 순서로 쓰면 됩니다.")
    print_command("doctor", "환경/auth 확인")
    print_command("/watchlist add AAPL", "관심 종목 등록")
    print_command("quote AAPL", "가격 샘플 저장")
    print_command("history AAPL", "저장된 샘플 확인")
    print_command("classify AAPL", "샘플 3개 이상일 때 후보 분류")
    print_command("/next", "현재 상태 기준 다음 행동 추천")
    print_hint("처음에는 AAPL, SPY, TSLA 중 하나만 골라 반복해서 샘플을 쌓아도 충분합니다.")


def print_status(base: str | Path | None = None) -> None:
    summary = status_summary(base)
    print_section("Data status")
    if not summary["watchlist"]:
        print_warning("watchlist가 비어 있습니다. /watchlist add AAPL 로 시작하세요.")
    else:
        print(f"  watchlist: {', '.join(summary['watchlist'])}")
    if not summary["counts"]:
        print_warning("아직 quote history가 없습니다.")
    else:
        for ticker, count in sorted(summary["counts"].items()):
            state = label("ready", GREEN) if count >= 3 else label("need more", YELLOW)
            print(f"  {ticker:<8} {count:>3} samples  {state}")
    if summary["ready"]:
        print_success("classify 가능: " + ", ".join(summary["ready"]))
    if summary["needs_more"]:
        print_hint("샘플 3개 미만: " + ", ".join(summary["needs_more"]))


def print_next_action(base: str | Path | None = None) -> None:
    summary = status_summary(base)
    counts = summary["counts"]
    watchlist = summary["watchlist"]
    print_section("Recommended next action")
    if not watchlist and not counts:
        print_warning("아직 관심 종목과 quote 기록이 없습니다.")
        print_command("/watchlist add AAPL")
        print_command("quote AAPL")
        print_hint("분석은 최소 3개 이상의 가격 샘플부터 의미가 생깁니다.")
        return
    if watchlist:
        missing = [ticker for ticker in watchlist if counts.get(ticker, 0) == 0]
        if missing:
            print_command(f"quote {missing[0]}", f"{missing[0]} 첫 샘플 저장")
            return
    not_ready = sorted((ticker, count) for ticker, count in counts.items() if count < 3)
    if not_ready:
        ticker, count = not_ready[0]
        print_command(f"quote {ticker}", f"현재 {count}/3 samples")
        print_hint("같은 종목을 시간 간격을 두고 3번 이상 저장한 뒤 classify를 실행하세요.")
        return
    ticker = sorted(counts)[0]
    print_command(f"classify {ticker}", "샘플이 충분합니다")
    print_command(f"history {ticker}", "분류 전 원자료 확인")


def print_learn(topic: str | None) -> None:
    if not topic:
        print_section("Learn topics")
        print("  " + ", ".join(sorted(LEARN_TOPICS)))
        print_command("/learn momentum")
        return
    key = topic.lower()
    if key not in LEARN_TOPICS:
        print_warning(f"unknown topic: {topic}")
        print_hint("가능한 주제: " + ", ".join(sorted(LEARN_TOPICS)))
        return
    title, description, actions = LEARN_TOPICS[key]
    print_section(title)
    print(f"  {description}")
    print("\n  Try next:")
    for action in actions:
        print_command(action)


def handle_watchlist(parts: list[str], base: str | Path | None = None) -> int:
    action = parts[1] if len(parts) > 1 else "list"
    tickers = read_watchlist(base)
    if action == "list":
        print_section("Watchlist")
        if tickers:
            for ticker in tickers:
                print(f"  - {ticker}")
        else:
            print_warning("watchlist가 비어 있습니다.")
            print_command("/watchlist add AAPL")
        return 0
    if action == "add" and len(parts) >= 3:
        ticker = parts[2].upper()
        write_watchlist(tickers + [ticker], base)
        print_success(f"{ticker} added to watchlist")
        return 0
    if action in {"remove", "rm"} and len(parts) >= 3:
        ticker = parts[2].upper()
        write_watchlist([item for item in tickers if item != ticker], base)
        print_success(f"{ticker} removed from watchlist")
        return 0
    if action == "fetch":
        if not tickers:
            print_warning("watchlist가 비어 있습니다. /watchlist add AAPL 먼저 실행하세요.")
            return 1
        code = 0
        for ticker in tickers:
            print_section(f"Fetching {ticker}")
            args = argparse.Namespace(ticker=ticker, data_dir=str(base or "data"))
            code = command_quote_fetch(args) or code
        return code
    print_warning("usage: /watchlist [list|add <TICKER>|remove <TICKER>|fetch]")
    return 2

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
        "tmux_path": tmux_path(),
        "tmux_available": bool(tmux_path()),
        "tmux_install_hint": tmux_install_hint() if not tmux_path() else "ok",
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


def command_stats(args: argparse.Namespace) -> int:
    result = market_stats(args.symbol, base=args.data_dir, source=args.source, interval=args.interval, provider_symbol=args.provider_symbol)
    print_json(result)
    return 0 if result.get("ok") else 1


def command_data_download(args: argparse.Namespace) -> int:
    try:
        result = download_history(
            DownloadRequest(
                symbol=args.symbol,
                source=args.source,
                interval=args.interval,
                start=args.start,
                end=args.end,
                provider_symbol=args.provider_symbol,
            ),
            base=args.data_dir,
        )
    except Exception as exc:
        print_json({"ok": False, "symbol": args.symbol.upper(), "source": args.source, "error": str(exc)})
        return 1
    print_json(result)
    return 0


def command_data_watchlist(args: argparse.Namespace) -> int:
    result = download_watchlist(
        base=args.data_dir,
        source=args.source,
        interval=args.interval,
        start=args.start,
        end=args.end,
    )
    print_json(result)
    return 0 if result.get("ok") else 1


def command_data_list(args: argparse.Namespace) -> int:
    print_json({"ok": True, "datasets": list_datasets(args.data_dir)})
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


def brief_instructions() -> str:
    return """Create a concise QuantOps session brief.

Output:
1. Current data readiness by ticker.
2. The top 3 next QuantOps commands to run.
3. Any data-quality gaps to inspect.
4. A safety note that this is not a trade recommendation.

Prefer exact commands such as quote AAPL, history AAPL, classify AAPL, /audit, or /watchlist add AAPL.
Use only commands from the "Currently supported QuantOps commands" list in the prompt.
Do not recommend buy/sell/hold decisions."""


def command_brief(args: argparse.Namespace) -> int:
    context = build_local_context(args.data_dir)
    return run_codex_task("brief", brief_instructions(), context, cwd=Path.cwd())


def strategy_instructions(ticker: str, topic: str) -> str:
    return f"""Create a QuantOps research strategy plan for {ticker.upper()} using topic '{topic}'.

Output sections:
- Strategy hypothesis
- Current data readiness
- Data needed before trusting the idea
- Rule draft for study/backtest only
- Validation steps
- Risk checks
- Next QuantOps commands
- Safety note: no direct trade advice and no real orders

Keep the plan educational and test-oriented.
Use only commands from the "Currently supported QuantOps commands" list in the prompt."""


def command_strategy(args: argparse.Namespace) -> int:
    topic = args.topic.lower()
    if topic not in SUPPORTED_STRATEGY_TOPICS:
        print_json({"ok": False, "error": f"unsupported topic: {args.topic}", "supported": list(SUPPORTED_STRATEGY_TOPICS)})
        return 2
    context = build_local_context(args.data_dir, args.ticker)
    return run_codex_task("strategy", strategy_instructions(args.ticker, topic), context, cwd=Path.cwd())


def audit_explanation_instructions(findings: list[dict[str, Any]]) -> str:
    return """Explain these deterministic QuantOps audit findings.

Output:
1. Prioritized issues.
2. Why each issue matters for data quality.
3. Exact QuantOps commands to repair or inspect.
4. Safety note: do not give buy/sell/hold advice.

Findings:
""" + json.dumps(findings, ensure_ascii=False, indent=2, sort_keys=True)


def command_audit(args: argparse.Namespace) -> int:
    findings = audit_all(args.data_dir, args.ticker)
    result = {"ok": not any(item["severity"] == "error" for item in findings), "findings": findings}
    print_json(result)
    if args.explain:
        context = build_local_context(args.data_dir, args.ticker)
        context["audit_findings"] = findings
        return run_codex_task("audit", audit_explanation_instructions(findings), context, cwd=Path.cwd())
    return 1 if any(item["severity"] == "error" for item in findings) else 0


def handle_audit(parts: list[str], base: str | Path | None = "data") -> int:
    ticker = None
    explain = False
    for item in parts[1:]:
        if item.lower() in {"explain", "--explain"}:
            explain = True
        else:
            ticker = item.upper()
    args = argparse.Namespace(data_dir=str(base or "data"), ticker=ticker, explain=explain)
    return command_audit(args)


def handle_stats(parts: list[str], base: str | Path | None = "data") -> int:
    if len(parts) < 2:
        print_warning("usage: /stats <SYMBOL>")
        return 2
    args = argparse.Namespace(data_dir=str(base or "data"), symbol=parts[1], source="stooq", interval="d", provider_symbol=None)
    return command_stats(args)


def handle_strategy(parts: list[str], base: str | Path | None = "data") -> int:
    if len(parts) < 3:
        print_warning("usage: /strategy <TICKER> <TOPIC>")
        print_hint("topics: " + ", ".join(SUPPORTED_STRATEGY_TOPICS))
        return 2
    args = argparse.Namespace(data_dir=str(base or "data"), ticker=parts[1], topic=parts[2])
    return command_strategy(args)


def handle_data(parts: list[str], base: str | Path | None = "data") -> int:
    if len(parts) < 2:
        print_warning("usage: /data [download <SYMBOL>|watchlist|list]")
        return 2
    try:
        parser = build_parser(interactive=True)
        args = parser.parse_args(["--data-dir", str(base or "data"), "data", *parts[1:]])
    except (SystemExit, ValueError) as exc:
        print_warning(f"usage: /data [download <SYMBOL>|watchlist|list] ({exc})")
        return 2
    return int(args.func(args))


def command_runtime_snapshot(args: argparse.Namespace) -> int:
    snapshot = record_runtime(mode=args.mode, last_action=args.last_action, base=args.data_dir, cwd=Path.cwd())
    print_json(snapshot)
    return 0


def command_runtime_line(args: argparse.Namespace) -> int:
    print(runtime_status_line(args.mode, args.last_action, args.data_dir))
    return 0


def command_tmux_start(args: argparse.Namespace) -> int:
    code, message = launch_tmux_runtime(base=args.data_dir, session=args.session, height=args.height, interval=args.interval, cwd=Path.cwd())
    if code == 0:
        print_success(message)
    else:
        print_warning(message)
    return code


def command_hud(args: argparse.Namespace) -> int:
    if args.tmux:
        code, message = launch_tmux_hud(base=args.data_dir, height=args.height, interval=args.interval)
        if code == 0:
            print_success(message or "tmux HUD launched")
        else:
            print_warning(message)
        return code
    if args.watch:
        return watch_hud(base=args.data_dir, interval=args.interval)
    print_hud_once(base=args.data_dir, mode=args.mode, last_action=args.last_action)
    return 0


def handle_hud(parts: list[str], mode: str, last_action: str, base: str | Path | None = "data") -> int:
    if len(parts) > 1 and parts[1] == "tmux":
        code, message = launch_tmux_hud(base=base, height=3, interval=1.0)
        if code == 0:
            print_success(message or "tmux HUD launched")
        else:
            print_warning(message)
        return code
    print_hud(mode, last_action, base)
    return 0


class QuantOpsArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ValueError(message)


def build_parser(*, interactive: bool = False) -> argparse.ArgumentParser:
    parser_cls = QuantOpsArgumentParser if interactive else argparse.ArgumentParser
    parser = parser_cls(prog="quantops", description="QuantOps: agentic quant research and execution workflow tools")
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

    stats = sub.add_parser("stats")
    stats.add_argument("symbol")
    stats.add_argument("--source", default="stooq", choices=["stooq"])
    stats.add_argument("--interval", default="d", choices=["d", "w", "m"])
    stats.add_argument("--provider-symbol", "--stooq-symbol", dest="provider_symbol")
    stats.set_defaults(func=command_stats)

    data = sub.add_parser("data")
    dsub = data.add_subparsers(dest="data_cmd", required=True)
    dload = dsub.add_parser("download")
    dload.add_argument("symbol")
    dload.add_argument("--source", default="stooq", choices=["stooq"])
    dload.add_argument("--interval", default="d", choices=["d", "w", "m"])
    dload.add_argument("--start")
    dload.add_argument("--end")
    dload.add_argument("--provider-symbol", "--stooq-symbol", dest="provider_symbol")
    dload.set_defaults(func=command_data_download)
    dwatch = dsub.add_parser("watchlist")
    dwatch.add_argument("--source", default="stooq", choices=["stooq"])
    dwatch.add_argument("--interval", default="d", choices=["d", "w", "m"])
    dwatch.add_argument("--start")
    dwatch.add_argument("--end")
    dwatch.set_defaults(func=command_data_watchlist)
    dlist = dsub.add_parser("list")
    dlist.set_defaults(func=command_data_list)

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

    brief = sub.add_parser("brief")
    brief.set_defaults(func=command_brief)

    audit = sub.add_parser("audit")
    audit.add_argument("ticker", nargs="?")
    audit.add_argument("--explain", action="store_true")
    audit.set_defaults(func=command_audit)

    strategy = sub.add_parser("strategy")
    strategy.add_argument("ticker")
    strategy.add_argument("topic", choices=SUPPORTED_STRATEGY_TOPICS)
    strategy.set_defaults(func=command_strategy)

    runtime = sub.add_parser("runtime")
    rsub = runtime.add_subparsers(dest="runtime_cmd", required=True)
    rsnap = rsub.add_parser("snapshot")
    rsnap.add_argument("--mode", default="quant")
    rsnap.add_argument("--last-action", default="snapshot")
    rsnap.set_defaults(func=command_runtime_snapshot)
    rline = rsub.add_parser("line")
    rline.add_argument("--mode", default="quant")
    rline.add_argument("--last-action", default="line")
    rline.set_defaults(func=command_runtime_line)

    hud = sub.add_parser("hud")
    hud.add_argument("--watch", action="store_true")
    hud.add_argument("--tmux", action="store_true")
    hud.add_argument("--interval", type=float, default=1.0)
    hud.add_argument("--height", type=int, default=3)
    hud.add_argument("--mode", default="quant")
    hud.add_argument("--last-action", default="hud")
    hud.set_defaults(func=command_hud)

    tmux = sub.add_parser("tmux")
    tsub = tmux.add_subparsers(dest="tmux_cmd", required=True)
    start = tsub.add_parser("start")
    start.add_argument("--session", default="quantops")
    start.add_argument("--height", type=int, default=3)
    start.add_argument("--interval", type=float, default=1.0)
    start.set_defaults(func=command_tmux_start)
    return parser



def run_codex_prompt(prompt: str) -> int:
    """Ask Codex once from QuantOps without granting write access."""
    prompt = prompt.strip()
    if not prompt:
        print("usage: /ask <QUESTION>")
        return 2
    codex = shutil.which("codex")
    if not codex:
        print("error: codex CLI not found in PATH")
        return 127
    command = [codex, "exec", "--sandbox", "read-only", "--cd", str(Path.cwd()), prompt]
    print_user_window(prompt)
    return run_codex_command(command, title="Codex")


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


def slash_command_name(line: str) -> str | None:
    if not line.startswith("/"):
        return None
    try:
        parts = shlex.split(line)
    except ValueError:
        return None
    return parts[0] if parts else None


def run_once(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


def run_interactive() -> int:
    print(color(BANNER, CYAN))
    print(f"{APP_NAME} {__version__}  ·  agentic quant research workflows  ·  trading mutations disabled")
    print("data: ./data  ·  mode: quant  ·  type /help for commands, exit to quit")
    print_start_here()
    parser = build_parser(interactive=True)
    mode = "quant"
    last_action = "ready"
    import sys
    readline_safe_prompt = sys.stdin.isatty()
    setup_readline(lambda: mode)
    while True:
        try:
            line = input(prompt_for_mode(mode, readline_safe=readline_safe_prompt, status_line=runtime_status_line(mode, last_action))).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not line:
            continue
        if line in {"exit", "quit", ":q"}:
            return 0
        if line in {"help", "?", "/help"}:
            print(HELP_TEXT)
            last_action = "/help"
            continue
        if line == "/modes":
            print_modes(mode)
            last_action = "/modes"
            continue
        if line.startswith("/hud"):
            try:
                hud_parts = shlex.split(line)
            except ValueError as exc:
                print(f"error: {exc}")
                continue
            handle_hud(hud_parts, mode, last_action, "data")
            last_action = "/hud"
            continue
        if line.startswith("/runtime"):
            try:
                runtime_parts = shlex.split(line)
            except ValueError as exc:
                print(f"error: {exc}")
                continue
            action = runtime_parts[1] if len(runtime_parts) > 1 else "line"
            if action == "snapshot":
                command_runtime_snapshot(argparse.Namespace(data_dir="data", mode=mode, last_action="/runtime"))
            elif action == "line":
                command_runtime_line(argparse.Namespace(data_dir="data", mode=mode, last_action="/runtime"))
            else:
                print_warning("usage: /runtime [line|snapshot]")
            last_action = "/runtime"
            continue
        if line == "/start":
            print_start_workflow()
            last_action = "/start"
            continue
        if line == "/status":
            print_status("data")
            last_action = "/status"
            continue
        if line == "/next":
            print_next_action("data")
            last_action = "/next"
            continue
        if line in {"/brief", "/today"}:
            command_brief(argparse.Namespace(data_dir="data"))
            last_action = line
            print_hud(mode, last_action)
            continue
        try:
            slash_parts = shlex.split(line) if line.startswith("/") else []
        except ValueError as exc:
            print(f"error: {exc}")
            continue
        slash_name = slash_parts[0] if slash_parts else None
        if slash_name == "/audit":
            handle_audit(slash_parts, "data")
            last_action = "/audit"
            print_hud(mode, last_action)
            continue
        if slash_name == "/data":
            handle_data(slash_parts, "data")
            last_action = "/data"
            print_hud(mode, last_action)
            continue
        if slash_name == "/stats":
            handle_stats(slash_parts, "data")
            last_action = "/stats"
            print_hud(mode, last_action)
            continue
        if slash_name == "/strategy":
            handle_strategy(slash_parts, "data")
            last_action = "/strategy"
            print_hud(mode, last_action)
            continue
        if line.startswith("/learn"):
            parts = shlex.split(line)
            print_learn(parts[1] if len(parts) > 1 else None)
            last_action = "/learn"
            continue
        if line.startswith("/watchlist"):
            handle_watchlist(shlex.split(line), "data")
            last_action = "/watchlist"
            print_hud(mode, last_action)
            continue
        if line == "/codex":
            mode = "codex"
            print("Codex mode enabled. Normal text now goes to Codex read-only. Type /quant to return.")
            print_hud(mode, "/codex")
            continue
        if line == "/quant":
            mode = "quant"
            print("Quant mode enabled. Normal text is parsed as QuantOps commands again.")
            print_hud(mode, "/quant")
            continue
        if line.startswith("/ask "):
            run_codex_prompt(line.removeprefix("/ask "))
            last_action = "/ask"
            print_hud(mode, last_action)
            continue
        if line.startswith("/"):
            print(f"unknown slash command: {line.split()[0]}  (try /help)")
            continue
        if mode == "codex":
            run_codex_prompt(line)
            last_action = "codex"
            print_hud(mode, last_action)
            continue
        try:
            parts = normalize_interactive_command(shlex.split(line))
            args = parser.parse_args(parts)
            args.func(args)
            last_action = " ".join(parts[:2])
            print_hud(mode, last_action)
        except SystemExit:
            continue
        except Exception as exc:
            print(f"error: {exc}")
    return 0


def should_auto_start_tmux() -> bool:
    import os
    import sys

    if os.environ.get("QUANTOPS_NO_TMUX") in {"1", "true", "yes", "on"}:
        return False
    if os.environ.get("TMUX"):
        return False
    return sys.stdin.isatty() and sys.stdout.isatty() and bool(tmux_path())


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        import sys
        argv = sys.argv[1:]
    no_tmux = False
    if "--no-tmux" in argv:
        argv = [item for item in argv if item != "--no-tmux"]
        no_tmux = True
    if not argv:
        if not no_tmux and should_auto_start_tmux():
            code, message = launch_tmux_runtime(cwd=Path.cwd())
            if code == 127:
                print_warning(message)
            else:
                return code
        return run_interactive()
    return run_once(argv)


if __name__ == "__main__":
    raise SystemExit(main())
