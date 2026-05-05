# QuantOps

Agentic quant operations CLI for turning ideas into data checks, external research, skeptical verification, backtests, and future guarded execution workflows. The active `quant` and `quantops` launchers point at `src/cli.ts`; a Python reference implementation remains available through the `quantops_cli` compatibility module.

## TypeScript runtime

QuantOps now runs on Node.js/TypeScript. It intentionally uses Node 24+ native
TypeScript execution, so there are no npm runtime dependencies yet.

```bash
node --version   # requires >= 24
npm test
node ./src/cli.ts setup bin   # installs ~/.local/bin/quant and ~/.local/bin/quantops
quant                       # starts the tmux-backed runtime when tmux is available
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
~/.local/bin/quant -> <repo>/src/cli.ts
~/.local/bin/quantops -> <repo>/src/cli.ts
```

After that, `quant` is enough. If `tmux` is installed and you are in an
interactive terminal, it automatically starts the QuantOps tmux runtime with the
live HUD pane. Use `quant --no-tmux` or `QUANTOPS_NO_TMUX=1 quant` for plain mode.

## Interactive mode

```bash
quant
# or
quantops
```

When `tmux` is installed and QuantOps is started from an interactive terminal,
it opens a `quantops-<hash>` tmux session automatically. The hash is derived
from `QUANTOPS_SESSION`, `CODEX_SESSION_ID`, `OMX_SESSION_ID`, `OMX_SESSION`,
`TMUX_PANE`, or the project path, in that order. The top pane is the command
chat, and the bottom pane is a live HUD like:

```text
[QuantOps] main | mode:quant | watchlist:5 | quotes:5/10 samples | classify-ready:0 | codex:ready | last:ready | updated:2026-05-04T02:12:19Z
```

Use `QUANTOPS_NO_TMUX=1 quant` or `quant --no-tmux`
to start the plain non-tmux interactive shell. If your terminal mouse selection
is captured by the Rust TUI, start it with `QUANTOPS_TUI_MOUSE=off quant` or
use copy-friendly subcommands such as `quant idea status latest --plain`.
Inside the managed tmux runtime, `exit`, `quit`, or `:q` closes the whole
QuantOps session, including the HUD pane.

Then type. Press `Tab` to autocomplete commands, nested subcommands, slash modes,
and tmux options such as `tmux start --session`:

```text
QuantOps quant ❯ /help
QuantOps quant ❯ doctor
QuantOps quant ❯ collect plan AAPL
QuantOps quant ❯ collect quote AAPL
QuantOps quant ❯ history AAPL
QuantOps quant ❯ classify AAPL
QuantOps quant ❯ portfolio
QuantOps quant ❯ NVDA 실적 모멘텀을 검증하고 싶어
QuantOps quant ❯ /skills
QuantOps quant ❯ /tools
QuantOps quant ❯ agent ko
QuantOps quant ❯ agent NVDA earnings momentum research
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

## Guided learning flow

Inside interactive mode, these slash commands explain what to do next instead of only listing syntax:

```text
QuantOps quant ❯ /start
QuantOps quant ❯ /status
QuantOps quant ❯ /next
QuantOps quant ❯ /watchlist add AAPL
QuantOps quant ❯ /watchlist list
QuantOps quant ❯ /watchlist fetch
QuantOps quant ❯ /learn momentum
```

Recommended beginner loop:

1. `/start` to see the workflow.
2. `/watchlist add AAPL` to choose one symbol.
3. `collect quote AAPL` several times over time.
4. `/status` to check whether enough samples exist.
5. `classify AAPL` once at least 3 samples are saved.

## Subcommand mode

```bash
quant doctor
quant collect plan AAPL
quant collect quote AAPL
quant collect watchlist
quant idea new "NVDA earnings momentum"
quant idea add-symbol latest NVDA
quant idea add-hypothesis latest "Earnings surprise momentum persists"
quant idea status latest
quant idea status latest --plain
quant lab workflow latest
quant lab discuss latest
quant lab discuss latest 실적 모멘텀이 가격에 반영되는지 보고 싶어
quant lab verify latest
quant lab backtest latest --prompt
quant strategy list
quant backtest run latest --strategy ma-cross
quant data download AAPL
quant data info AAPL
quant data validate AAPL
quant data refresh AAPL
quant data watchlist refresh
quant stats AAPL
quant research AAPL
quant quote fetch AAPL
quant quote history AAPL
quant classify AAPL
quant portfolio snapshot
quant brief
quant research AAPL --topic momentum
quant runtime line
quant runtime snapshot
quant hud
quant hud --tmux
quant tmux start
quant order preview --symbol AAPL --side buy --qty 1 --price 100
```

Collection commands are provider-neutral and read-only by default. `collect plan` previews the tickers and existing local sample counts, `collect quote <TICKER>` stores one `tossctl quote get` sample in `data/quotes/<TICKER>.jsonl`, and `collect watchlist` runs the same collection over `data/watchlist.json`. `idea new <TITLE>` starts a local quant research idea under `data/ideas/`; `idea add-symbol`, `idea add-hypothesis`, `idea show`, and `idea status` accept the full id, a unique prefix, `latest`, title text, or a linked symbol such as `NVDA`; and `idea status latest --plain` prints a copy-friendly checklist for Codex discussions. `lab workflow <IDEA_REF>` turns a saved idea into a safe discuss → verify → backtest workflow, `lab discuss` creates research questions for Codex/Claude, `lab verify` creates a skeptical falsification checklist, and `lab backtest --prompt` creates a coding brief for a future deterministic backtest module without live trading code. In interactive mode, Tab completion suggests saved idea ids after `/idea ...` and `/lab ...` commands. `data download <SYMBOL>` stores OHLCV market data under `data/market/`, `data info <SYMBOL>` shows saved dataset coverage/freshness, `data validate <SYMBOL>` checks local OHLCV quality/readiness, `data refresh <SYMBOL>` incrementally updates an existing dataset, `stats <SYMBOL>` summarizes downloaded return, volatility, drawdown, moving-average, volume, and readiness metrics, and `research <SYMBOL>` builds an educational external-factor report under `data/research/`.

The active TypeScript runtime now runs normal market download, list, stats, and audit commands directly. The retained Python package remains a reference implementation instead of the default data-analysis execution path.

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
- `quant lab verify latest` builds a skeptical validation/falsification checklist.
- `quant lab backtest latest --prompt` prints the backtest coding prompt to copy into Codex/Claude.
- `quant strategy list` shows deterministic strategy templates such as `ma-cross`, `momentum`, `mean-reversion`, and `buy-hold`.
- `quant backtest run latest --strategy ma-cross` runs a deterministic local backtest for the latest idea's first symbol; it stores results under `data/backtests/` and never touches live trading.
- `quant data download AAPL --period 1y` uses Yahoo Finance's chart endpoint by default.
- `quant data info AAPL` shows saved source, interval, row count, date coverage, freshness age, and next refresh command.
- `quant data validate AAPL` checks local rows for duplicate dates, invalid OHLCV values, stale data, and short histories.
- `quant data refresh AAPL` refreshes from the next day after the latest saved row through today; if no saved dataset exists, it falls back to the provider's default range.
- `quant data watchlist refresh` refreshes every ticker in `data/watchlist.json`.
- `quant data download AAPL --source stooq --period 1y` uses Stooq when `STOOQ_API_KEY` is available or Stooq allows CSV access.
- `quant stats AAPL` reads the default Yahoo dataset unless you pass another `--source`.

## LLM tool/workbench mode

QuantOps exposes a curated tool registry instead of letting LLMs run arbitrary shell commands:

```bash
quant tools list --json
quant tools run data.info --symbol NVDA --json
quant tools run strategy.list
quant tools run backtest.run --symbol NVDA --strategy ma-cross
quant agent ko
quant agent "NVDA earnings momentum research"
quant agent "NVDA earnings momentum research" --download --provider codex
quant provider list --json
quant session handoff
quant mcp
```

The registry currently includes safe research/data tools such as `data.info`, `data.download`, `data.validate`, `stats.run`, `research.run`, `idea.create`, `idea.add-symbol`, `lab.workflow`, `lab.stage`, `strategy.list`, and `backtest.run`. It intentionally does not expose order placement, account mutation, or raw broker commands. `.quant/` stores session handoff state while `data/` remains the market-data store. `quant mcp` serves the same registry over stdio MCP (`initialize`, `tools/list`, `tools/call`) for external Codex/Claude-style clients.

Codex is launched as `codex exec --sandbox read-only --cd <project> ...` so the first integration is intentionally read-only.
QuantOps filters Codex CLI transcript noise such as hook lines and sandbox warnings, then renders the model response in a colored Codex window.
When invoking a skill from a regular shell instead of the interactive prompt, quote the `$...` token (for example `quant '$quantops-idea-coach --lang ko'`) so your shell does not expand it as an environment variable.

Codex safety boundaries:
- Codex receives summarized/redacted local context, not raw credentials.
- Codex should recommend research steps and supported QuantOps commands only.
- Codex must not give direct buy/sell/hold instructions.
- Research reports use uncertainty wording, avoid single buy/sell scores, and separate local facts from external context.
- Trading remains preview-only; QuantOps has no real order mutation command.
