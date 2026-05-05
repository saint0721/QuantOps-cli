# QuantOps

Agent-native quant research runtime for Codex/Claude-style agents. QuantOps is no longer positioned as a standalone chat/TUI-first app: the intended workflow is **user talks to Codex → Codex calls `rtk` shell commands with `--json` → QuantOps returns deterministic data, research, backtest, and artifact context**. The active `rtk`, `quant`, and `quantops` launchers point at `src/cli.ts`; Python remains available for quant-analysis/reference work through the `quantops_cli` compatibility module.

## Codex runtime contract

Use QuantOps as a local execution harness from a Codex tmux/session:

```bash
rtk codex-guide --json
rtk runtime info --json
rtk --help
rtk doctor
rtk symbol search TSMC --json
rtk data info TSM --json
rtk data download TSM --start 2026-01-01 --end 2026-05-05 --json
rtk data validate TSM --json
rtk stats TSM --json
rtk compare TSM SOXX NVDA ASML --json
rtk research TSM --topic "earnings momentum" --json
rtk event define --type competitor_negative --source-symbol 005930.KS --target-symbol TSM --benchmark SOXX --json
rtk event study TSM --event-date 2026-04-18 --benchmark SOXX --json
rtk backtest strategies --json
rtk backtest run TSM --strategy ma-cross --json
```

Runtime decisions:

- Primary interface: shell CLI with stable `--json` outputs.
- Primary human UX: Codex conversation, not QuantOps-local chat.
- QuantOps role: data download, validation, stats, research context, event study, backtest, persistence.
- De-emphasized: `/agent` as the main UX, QuantOps fake chat loops, TUI-first product direction, MCP-first work before CLI JSON contracts are stable.
- Safety: no buy/sell/hold advice, no single trade score, and no live trading mutation by default.

## TypeScript runtime

QuantOps now runs on Node.js/TypeScript. It intentionally uses Node 24+ native
TypeScript execution, so there are no npm runtime dependencies yet.

```bash
node --version   # requires >= 24
npm test
node ./src/cli.ts setup bin   # installs ~/.local/bin/rtk, ~/.local/bin/quant, ~/.local/bin/quantops
rtk                         # preferred agent launcher; starts tmux-backed runtime when available
```

The Python reference prototype is still available for comparison:

```bash
python3 -m quantops_cli --no-tmux
```


### One-word launcher

Run this once from the repo:

```bash
node ./src/cli.ts setup bin
```

It creates symlinks in `~/.local/bin`:

```text
~/.local/bin/rtk -> <repo>/src/cli.ts
~/.local/bin/quant -> <repo>/src/cli.ts
~/.local/bin/quantops -> <repo>/src/cli.ts
```

After that, `rtk` is the preferred launcher and `quant`/`quantops` remain aliases. If `tmux` is installed and you are in an
interactive terminal, it automatically starts the QuantOps tmux runtime with the
live HUD pane. Use `rtk --no-tmux` or `QUANTOPS_NO_TMUX=1 rtk` for plain mode.

## Interactive mode

```bash
rtk
# or
quant
# or
quantops
```

Interactive mode is now a secondary debugging/dashboard surface. For normal research, discuss with Codex in your tmux/session and let Codex call `rtk ... --json`.

When `tmux` is installed and QuantOps is started from an interactive terminal,
it opens a `quantops-<hash>` tmux session automatically. The hash is derived
from `QUANTOPS_SESSION`, `CODEX_SESSION_ID`, `OMX_SESSION_ID`, `OMX_SESSION`,
`TMUX_PANE`, or the project path, in that order. The top pane is the command
chat, and the bottom pane is a live HUD like:

```text
[QuantOps] main | mode:quant | watchlist:5 | quotes:5/10 samples | classify-ready:0 | codex:ready | last:ready | updated:2026-05-04T02:12:19Z
```

Use `QUANTOPS_NO_TMUX=1 rtk` or `rtk --no-tmux`
to start the plain non-tmux interactive shell. The Rust TUI leaves terminal
mouse selection available by default, so normal mouse drag can copy visible
text. If you prefer app-level mouse wheel scrolling instead, start it with
`QUANTOPS_TUI_MOUSE=1 rtk`; use copy-friendly subcommands such as
`rtk idea status latest --plain` when you need stable text output.
Inside the managed tmux runtime, `exit`, `quit`, or `:q` closes the whole
QuantOps session, including the HUD pane.

Then type. Press `Tab` to autocomplete commands, nested subcommands, slash modes,
and tmux options such as `tmux start --session`. This surface is mainly for
debugging and dashboards; the recommended research flow is still Codex calling
copy-friendly `rtk ... --json` commands:

```text
QuantOps quant ❯ /help
QuantOps quant ❯ codex-guide
QuantOps quant ❯ runtime info --json
QuantOps quant ❯ doctor
QuantOps quant ❯ data download TSM --period 5y --json
QuantOps quant ❯ data validate TSM --json
QuantOps quant ❯ stats TSM --json
QuantOps quant ❯ compare TSM SOXX NVDA --json
QuantOps quant ❯ NVDA 실적 모멘텀을 검증하고 싶어
QuantOps quant ❯ /skills
QuantOps quant ❯ /tools
QuantOps quant ❯ $quantops-idea-coach --lang ko
QuantOps quant ❯ /brief
QuantOps quant ❯ /research AAPL
QuantOps quant ❯ /audit
QuantOps quant ❯ /research AAPL --topic momentum
QuantOps quant ❯ /hud
QuantOps quant ❯ /hud tmux
QuantOps quant ❯ /runtime line
QuantOps quant ❯ /codex
QuantOps codex ❯ explain my AAPL history file
QuantOps codex ❯ /quant
QuantOps quant ❯ exit
```

## Guided research flow

For agent-first use, ask Codex what you want to investigate and let it call the
runtime. The CLI exposes both a concise help surface and machine-readable
contracts:

```bash
rtk --help
rtk codex-guide --json
rtk runtime info --json
rtk tools list --json
```

Recommended beginner loop through Codex:

1. Ask Codex to turn the idea into symbols and hypotheses.
2. Codex calls `rtk symbol search ... --json` and `rtk idea ...`.
3. Codex calls `rtk data download/info/validate ... --json`.
4. Codex calls `rtk stats`, `rtk compare`, `rtk research`, and `rtk event study`.
5. Codex calls `rtk backtest run ... --json` only after the data and hypothesis are clear.

## Subcommand mode

```bash
rtk codex-guide
rtk runtime info --json
rtk --help
rtk doctor
rtk collect plan AAPL
rtk collect quote AAPL
rtk collect watchlist
rtk idea new "NVDA earnings momentum"
rtk idea add-symbol latest NVDA
rtk idea add-hypothesis latest "Earnings surprise momentum persists"
rtk idea status latest
rtk idea status latest --plain
rtk lab workflow latest
rtk lab discuss latest
rtk lab discuss latest 실적 모멘텀이 가격에 반영되는지 보고 싶어
rtk lab verify latest
rtk lab backtest latest --prompt
rtk strategy list
rtk backtest run latest --strategy ma-cross
rtk data download AAPL
rtk data info AAPL
rtk data validate AAPL
rtk data refresh AAPL
rtk data watchlist refresh
rtk stats AAPL
rtk research AAPL
rtk compare AAPL SPY QQQ
rtk event define --type earnings --target-symbol AAPL
rtk event study AAPL --event-date 2026-01-15 --benchmark SPY
rtk quote fetch AAPL
rtk quote history AAPL
rtk classify AAPL
rtk portfolio snapshot
rtk brief
rtk research AAPL --topic momentum
rtk runtime line
rtk runtime snapshot
rtk hud
rtk hud --tmux
rtk tmux start
rtk order preview --symbol AAPL --side buy --qty 1 --price 100
```

Collection commands are provider-neutral and read-only by default. `collect plan` previews the tickers and existing local sample counts, `collect quote <TICKER>` stores one `tossctl quote get` sample in `data/quotes/<TICKER>.jsonl`, and `collect watchlist` runs the same collection over `data/watchlist.json`. `idea new <TITLE>` starts a local quant research idea under `data/ideas/`; `idea add-symbol`, `idea add-hypothesis`, `idea show`, and `idea status` accept the full id, a unique prefix, `latest`, title text, or a linked symbol such as `NVDA`; and `idea status latest --plain` prints a copy-friendly checklist for Codex discussions. `lab workflow <IDEA_REF>` turns a saved idea into a safe discuss → verify → backtest workflow, `lab discuss` creates research questions for Codex/Claude, `lab verify` creates a skeptical falsification checklist, and `lab backtest --prompt` creates a coding brief for a future deterministic backtest module without live trading code. In interactive mode, Tab completion suggests saved idea ids after `/idea ...` and `/lab ...` commands. `data download <SYMBOL>` stores OHLCV market data under `data/market/`, `data info <SYMBOL>` shows saved dataset coverage/freshness, `data validate <SYMBOL>` checks local OHLCV quality/readiness, `data refresh <SYMBOL>` incrementally updates an existing dataset, `stats <SYMBOL>` summarizes downloaded return, volatility, drawdown, moving-average, volume, and readiness metrics, and `research <SYMBOL>` builds an educational external-factor report under `data/research/`.

The active TypeScript runtime now runs normal market download, list, stats, and audit commands directly. The retained Python package remains a reference implementation instead of the default data-analysis execution path.

### Rust execution helpers

`rtk stats <SYMBOL> --json`, `rtk backtest run <SYMBOL> --json`, `rtk event study <SYMBOL> --event-date YYYY-MM-DD --json`, and `rtk data validate <SYMBOL> --json` use the TypeScript implementation by default, but they can use Rust helpers when the helpers are built or when explicitly requested:

```bash
cargo build --manifest-path tui/Cargo.toml --bin quantops-stats
cargo build --manifest-path tui/Cargo.toml --bin quantops-backtest
cargo build --manifest-path tui/Cargo.toml --bin quantops-event
cargo build --manifest-path tui/Cargo.toml --bin quantops-validate
# or build all helpers through rtk:
rtk setup rust
rtk stats TSM --source yahoo --json
rtk backtest run TSM --strategy ma-cross --source yahoo --json
rtk event study TSM --event-date 2026-01-15 --benchmark SOXX --source yahoo --json
rtk data validate TSM --json

# Force cargo-backed Rust execution without relying on prebuilt helpers:
QUANTOPS_STATS_ENGINE=rust-cargo rtk stats TSM --source yahoo --json
QUANTOPS_BACKTEST_ENGINE=rust-cargo rtk backtest run TSM --strategy ma-cross --source yahoo --json
QUANTOPS_EVENT_ENGINE=rust-cargo rtk event study TSM --event-date 2026-01-15 --benchmark SOXX --source yahoo --json
QUANTOPS_VALIDATE_ENGINE=rust-cargo rtk data validate TSM --json
```

`rtk doctor` reports the launcher setup, Node/runtime contract, tmux availability,
Rust helper paths, cargo availability, and build hints under `rust_stats`,
`rust_backtest`, `rust_event`, and `rust_validate`. Broker/tossctl diagnostics
are reported as optional integration status and do not block the research
harness. This keeps the stable Codex contract in `rtk ... --json` while moving
isolated compute-heavy kernels to Rust incrementally.

Safety defaults:
- no web UI
- no sensitive credential/session/account identifier storage in project data
- no order mutation command in V1
- order preview only

## Configuration

QuantOps is safe to publish as a public repository when secrets stay outside git.
Copy `.env.example` to your shell/profile or secret manager and export only the
values you need:

```bash
export QUANT_TOSSCTL=/path/to/tossctl
export ALPHA_VANTAGE_API_KEY=...
export FRED_API_KEY=...
export OPENDART_API_KEY=...
export POLYGON_API_KEY=...
export STOOQ_API_KEY=...     # optional; default downloads use Yahoo Finance
```

Local `.env*` files and runtime `data/` are ignored by git. Keep API keys,
broker credentials, account identifiers, and downloaded account snapshots out of
commits.

## Runtime and tmux HUD

QuantOps now writes a lightweight runtime snapshot to `data/runtime/state.json`.
It includes mode, last action, git branch, watchlist size, quote sample counts,
classify readiness, Codex availability, and update time. This is the first
step toward a small local runtime rather than only one-shot commands.

`tmux` is an OS-level terminal multiplexer, not a Python wheel, so it is not
listed in `pyproject.toml` dependencies. Install it with your OS package manager:

```bash
sudo apt install tmux        # Debian/Ubuntu
brew install tmux            # macOS/Homebrew
sudo pacman -S tmux          # Arch
```

`doctor` reports whether `tmux` is available. Useful commands:

```bash
quant runtime line       # one-line status
quant runtime snapshot   # JSON runtime state
quant hud                # colored HUD once
quant hud --watch        # repainting HUD loop
quant hud --tmux         # split a bottom tmux pane inside tmux
quant tmux start         # create/attach full QuantOps tmux runtime
quant tmux start --session tq-research
```

Inside interactive mode, `/hud` prints the same line and `/hud tmux` opens the
bottom tmux HUD pane when you are already inside a tmux session.

## Codex bridge

QuantOps is chat-first for humans and tool-first for agents. In interactive mode, plain text is routed to the shared `agent-chat` session, where the local agent can inspect safe tools and suggest or run only the minimum useful CLI actions:

- Just type naturally, e.g. `NVDA 실적 모멘텀을 검증하고 싶어`.
- `/codex` changes the prompt to `quantops/codex>`; normal text is sent to Codex.
- `/quant` returns to normal QuantOps commands.
- `/skills` lists QuantOps-only local skills found under `quant-skills/` or `$QUANTOPS_SKILLS_DIR`.
- `/tools` lists the safe QuantOps tool registry exposed to agents and MCP clients.
- `quant agent ko|en|auto` sets the default local agent report language; `/agent ko` remains as an interactive compatibility shortcut.
- `quant agent <request>` is the scriptable agent-facing command surface. It continues the shared `.quant` `agent-chat` session by default and can optionally ask a provider with `--provider codex|claude`. Use `--download` before allowing network/local data-download writes.
- `/session handoff` prints the recent `.quant/` session summary so Codex/Claude can continue the conversation without raw credentials.
- `$skill-name ...` invokes a QuantOps local skill from interactive quant/TUI; Tab completion suggests quant-only skills such as `$quantops-idea-coach`.
- `/brief` or `/today` asks Codex for a local-data session brief and next QuantOps commands.
- `/research <TICKER>` combines local OHLCV/stat/audit context with a Codex/web event-summary prompt, saves a redacted report under `data/research/`, and avoids buy/sell/hold advice or single-score conclusions.
- `/audit [TICKER]` runs deterministic local data-quality checks; add `explain` or `--explain` to ask Codex to explain the findings.
- `/research <SYMBOL> [--topic <TEXT>] [--codex]` builds a redacted local market/stats/audit context, optionally asks Codex for external-factor research, and saves the report under `data/research/`. It is research-only: no buy/sell/hold advice and no single score.
- `/hud` shows a compact status line with current mode, watchlist count, quote samples, Codex availability, and last action.

Market data defaults:
- `quant idea new "NVDA earnings momentum"` creates a local QuantOps idea record before you collect evidence.
- `quant idea status latest` shows whether each linked symbol has market data, validation status, saved research, and next QuantOps commands. You can also use a unique id prefix, title text, or a linked symbol instead of the full id.
- `quant idea status latest --plain` prints a copy-friendly version for Codex/Claude discussions.
- `quant lab workflow latest` shows the discuss → verify → backtest workflow for the saved idea.
- `quant lab discuss latest <what you want to discuss>` starts a focused local discussion without quotes in the interactive prompt, records it in the shared `agent-chat` session, and tells you to continue with plain natural-language chat; add `--codex` to ask Codex when available.
- `rtk lab verify latest` builds a skeptical validation/falsification checklist.
- `rtk lab backtest latest --prompt` prints the backtest coding prompt to copy into Codex/Claude.
- `rtk strategy list` shows deterministic strategy templates such as `ma-cross`, `momentum`, `mean-reversion`, and `buy-hold`.
- `rtk backtest run latest --strategy ma-cross` runs a deterministic local backtest for the latest idea's first symbol; it stores results under `data/backtests/` and never touches live trading.
- `rtk data download AAPL --period 1y` uses Yahoo Finance's chart endpoint by default.
- `rtk data info AAPL` shows saved source, interval, row count, date coverage, freshness age, and next refresh command.
- `rtk data validate AAPL` checks local rows for duplicate dates, invalid OHLCV values, stale data, and short histories.
- `rtk data refresh AAPL` refreshes from the next day after the latest saved row through today; if no saved dataset exists, it falls back to the provider's default range.
- `rtk data watchlist refresh` refreshes every ticker in `data/watchlist.json`.
- `rtk data download AAPL --source stooq --period 1y` uses Stooq when `STOOQ_API_KEY` is available or Stooq allows CSV access.
- `rtk stats AAPL` reads the default Yahoo dataset unless you pass another `--source`.

## LLM tool/workbench mode

QuantOps exposes a curated tool registry instead of letting LLMs run arbitrary shell commands:

```bash
rtk tools list --json
rtk tools run data.info --symbol NVDA --json
rtk tools run strategy.list
rtk tools run backtest.run --symbol NVDA --strategy ma-cross
rtk agent ko
rtk agent "NVDA earnings momentum research"
rtk agent "NVDA earnings momentum research" --download --provider codex
rtk provider list --json
rtk session handoff
rtk mcp
```

The registry currently includes safe research/data tools such as `data.info`, `data.download`, `data.validate`, `stats.run`, `research.run`, `idea.create`, `idea.add-symbol`, `lab.workflow`, `lab.stage`, `strategy.list`, and `backtest.run`. It intentionally does not expose order placement, account mutation, or raw broker commands. `.quant/` stores session handoff state while `data/` remains the market-data store. `rtk mcp` serves the same registry over stdio MCP (`initialize`, `tools/list`, `tools/call`) for external Codex/Claude-style clients.

Codex is launched as `codex exec --sandbox read-only --cd <project> ...` so the first integration is intentionally read-only.
QuantOps filters Codex CLI transcript noise such as hook lines and sandbox warnings, then renders the model response in a colored Codex window.
When invoking a skill from a regular shell instead of the interactive prompt, quote the `$...` token (for example `quant '$quantops-idea-coach --lang ko'`) so your shell does not expand it as an environment variable.

Codex safety boundaries:
- Codex receives summarized/redacted local context, not raw credentials.
- Codex should recommend research steps and supported QuantOps commands only.
- Codex must not give direct buy/sell/hold instructions.
- Research reports use uncertainty wording, avoid single buy/sell scores, and separate local facts from external context.
- Trading remains preview-only; QuantOps has no real order mutation command.
