from __future__ import annotations

import argparse
import json
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Any

try:
    import readline
except ImportError:  # pragma: no cover - platform dependent
    readline = None  # type: ignore[assignment]

from . import __version__
from .analysis import classify as classify_records, history_rows
from .storage import append_jsonl, quote_history_path, read_jsonl, redact, read_watchlist, snapshot_path, utc_now, write_watchlist
from . import toss

APP_NAME = "TossQuant"
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
    "portfolio",
    "order",
    "help",
    "exit",
    "quit",
]
SLASH_COMMANDS = ["/help", "/modes", "/ask", "/codex", "/quant", "/start", "/next", "/status", "/watchlist", "/learn"]
COMMAND_COMPLETIONS = {
    "quote": ["fetch", "history"],
    "order": ["preview"],
    "portfolio": ["snapshot"],
    "history": [],
    "classify": [],
}

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

Guided learning slash commands:
  /start                      show the beginner quant workflow
  /next                       recommend the next action from your local data
  /status                     summarize saved quote samples/watchlist
  /watchlist add <TICKER>     add ticker to local watchlist
  /watchlist remove <TICKER>  remove ticker from watchlist
  /watchlist list             list watchlist
  /watchlist fetch            fetch quotes for every watchlist ticker
  /learn <TOPIC>              explain: momentum, mean-reversion, backtest, risk
"""

START_HERE_TEXT = """Start here:
  1) doctor                   check tossctl/auth/data setup
  2) quote AAPL               fetch one quote sample into ./data
  3) history AAPL             inspect saved samples
  4) classify AAPL            get a simple strategy-candidate label
  5) /status                   see what data is ready
  6) /next                     get one recommended next action

Type /help for every command. Press Tab to autocomplete commands.
TossQuant stays quiet until you run a command.
"""

MODES_TEXT = """Modes:
  quant   default; local TossQuant commands only
  codex   only after /codex; each message is sent to: codex exec --sandbox read-only

Safety defaults:
  - Codex bridge is opt-in, never always-on
  - Codex runs read-only by default from this project directory
  - Trading remains preview-only; TossQuant has no real order mutation command
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


def prompt_for_mode(mode: str, *, readline_safe: bool = False) -> str:
    if mode == "codex":
        name = color("TossQuant", MAGENTA, readline_safe=readline_safe)
        badge = color("codex", CYAN, readline_safe=readline_safe)
    else:
        name = color("TossQuant", GREEN, readline_safe=readline_safe)
        badge = color("quant", CYAN, readline_safe=readline_safe)
    arrow = color("❯", BOLD, readline_safe=readline_safe)
    return f"{name} {badge} {arrow} "


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


def quote_sample_counts(base: str | Path | None = None) -> dict[str, int]:
    root = Path(base) if base else Path.cwd() / "data"
    quote_dir = root / "quotes"
    if not quote_dir.exists():
        return {}
    counts: dict[str, int] = {}
    for path in sorted(quote_dir.glob("*.jsonl")):
        counts[path.stem.upper()] = len(read_jsonl(path))
    return counts


def status_summary(base: str | Path | None = None) -> dict[str, Any]:
    counts = quote_sample_counts(base)
    watchlist = read_watchlist(base)
    ready = sorted([ticker for ticker, count in counts.items() if count >= 3])
    needs_more = sorted([ticker for ticker in set(watchlist) | set(counts) if counts.get(ticker, 0) < 3])
    return {"watchlist": watchlist, "counts": counts, "ready": ready, "needs_more": needs_more}


def print_start_workflow() -> None:
    print_section("Beginner quant workflow")
    print("  TossQuant는 '데이터 수집 → 기록 확인 → 후보 분류 → 리스크 확인' 순서로 쓰면 됩니다.")
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
    print(color(BANNER, CYAN))
    print(f"{APP_NAME} {__version__}  ·  tossctl read-only quant lab  ·  trading mutations disabled")
    print("data: ./data  ·  mode: quant  ·  type /help for commands, exit to quit")
    print_start_here()
    parser = build_parser(interactive=True)
    mode = "quant"
    import sys
    readline_safe_prompt = sys.stdin.isatty()
    setup_readline(lambda: mode)
    while True:
        try:
            line = input(prompt_for_mode(mode, readline_safe=readline_safe_prompt)).strip()
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
        if line == "/start":
            print_start_workflow()
            continue
        if line == "/status":
            print_status("data")
            continue
        if line == "/next":
            print_next_action("data")
            continue
        if line.startswith("/learn"):
            parts = shlex.split(line)
            print_learn(parts[1] if len(parts) > 1 else None)
            continue
        if line.startswith("/watchlist"):
            handle_watchlist(shlex.split(line), "data")
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
