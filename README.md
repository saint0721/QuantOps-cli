# TossQuant

TypeScript-first terminal quant runtime around `tossctl` read-only data. The previous Python CLI remains in `tossquant_cli/` as a reference implementation while the active `quant` and `tossquant` launchers point at `src/cli.ts`.

## TypeScript runtime

TossQuant now runs on Node.js/TypeScript. It intentionally uses Node 24+ native
TypeScript execution, so there are no npm runtime dependencies yet.

```bash
node --version   # requires >= 24
npm test
node ./src/cli.ts setup bin   # installs ~/.local/bin/quant and ~/.local/bin/tossquant
quant                       # starts the tmux-backed runtime when tmux is available
```

The legacy Python prototype is still available for comparison:

```bash
python3 -m tossquant_cli --no-tmux
```


### One-word launcher

Run this once from the repo:

```bash
node ./src/cli.ts setup bin
```

It creates symlinks in `~/.local/bin`:

```text
~/.local/bin/quant -> <repo>/src/cli.ts
~/.local/bin/tossquant -> <repo>/src/cli.ts
```

After that, `quant` is enough. If `tmux` is installed and you are in an
interactive terminal, it automatically starts the TossQuant tmux runtime with the
live HUD pane. Use `quant --no-tmux` or `TOSSQUANT_NO_TMUX=1 quant` for plain mode.

## Interactive mode

```bash
quant
# or
quant
```

When `tmux` is installed and TossQuant is started from an interactive terminal,
it opens a `tossquant-<hash>` tmux session automatically. The hash is derived
from `TOSSQUANT_SESSION`, `CODEX_SESSION_ID`, `OMX_SESSION_ID`, `OMX_SESSION`,
`TMUX_PANE`, or the project path, in that order. The top pane is the command
chat, and the bottom pane is a live HUD like:

```text
[TossQuant] main | mode:quant | watchlist:5 | quotes:5/10 samples | classify-ready:0 | codex:ready | last:ready | updated:2026-05-04T02:12:19Z
```

Use `TOSSQUANT_NO_TMUX=1 quant` or `quant --no-tmux`
to start the plain non-tmux interactive shell. If your terminal mouse selection
is captured by the Rust TUI, start it with `TOSSQUANT_TUI_MOUSE=off quant` or
use copy-friendly subcommands such as `quant idea status latest --plain`.
Inside the managed tmux runtime, `exit`, `quit`, or `:q` closes the whole
TossQuant session, including the HUD pane.

Then type. Press `Tab` to autocomplete commands, nested subcommands, slash modes,
and tmux options such as `tmux start --session`:

```text
TossQuant quant ❯ /help
TossQuant quant ❯ doctor
TossQuant quant ❯ collect plan AAPL
TossQuant quant ❯ collect quote AAPL
TossQuant quant ❯ history AAPL
TossQuant quant ❯ classify AAPL
TossQuant quant ❯ portfolio
TossQuant quant ❯ /ask what should I study next?
TossQuant quant ❯ /skills
TossQuant quant ❯ /tools
TossQuant quant ❯ /agent ko
TossQuant quant ❯ /agent NVDA earnings momentum research
TossQuant quant ❯ $tossquant-idea-coach --lang ko
TossQuant quant ❯ /brief
TossQuant quant ❯ /research AAPL
TossQuant quant ❯ /audit
TossQuant quant ❯ /research AAPL --topic momentum
TossQuant quant ❯ /hud
TossQuant quant ❯ /hud tmux
TossQuant quant ❯ /runtime line
TossQuant quant ❯ /codex
TossQuant codex ❯ explain my AAPL history file
TossQuant codex ❯ /quant
TossQuant quant ❯ exit
```

## Guided learning flow

Inside interactive mode, these slash commands explain what to do next instead of only listing syntax:

```text
TossQuant quant ❯ /start
TossQuant quant ❯ /status
TossQuant quant ❯ /next
TossQuant quant ❯ /watchlist add AAPL
TossQuant quant ❯ /watchlist list
TossQuant quant ❯ /watchlist fetch
TossQuant quant ❯ /learn momentum
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

TossQuant is safe to publish as a public repository when secrets stay outside git.
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

TossQuant now writes a lightweight runtime snapshot to `data/runtime/state.json`.
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
quant tmux start         # create/attach full TossQuant tmux runtime
quant tmux start --session tq-research
```

Inside interactive mode, `/hud` prints the same line and `/hud tmux` opens the
bottom tmux HUD pane when you are already inside a tmux session.

## Codex bridge

TossQuant is not an always-on chatbot. It starts in `quant` mode and only calls Codex when you explicitly ask:

- `/ask <question>` runs one Codex request.
- `/codex` changes the prompt to `tossquant/codex>`; normal text is sent to Codex.
- `/quant` returns to normal TossQuant commands.
- `/skills` lists Codex skills found under `$CODEX_HOME/skills` or `~/.codex/skills`.
- `/tools` lists the safe TossQuant tool registry exposed to agents and MCP clients.
- `/agent ko|en|auto` sets the default local agent report language.
- `/agent <request>` runs a beginner-friendly local tool loop, continues the shared `.quant` `agent-chat` session by default, and can optionally ask a provider with `--provider codex|claude`. Use `--download` before allowing network/local data-download writes.
- `/session handoff` prints the recent `.quant/` session summary so Codex/Claude can continue the conversation without raw credentials.
- `$skill-name ...` invokes an installed Codex skill from interactive quant/TUI; Tab completion suggests installed skills such as `$tossquant-idea-coach`.
- `/brief` or `/today` asks Codex for a local-data session brief and next TossQuant commands.
- `/research <TICKER>` combines local OHLCV/stat/audit context with a Codex/web event-summary prompt, saves a redacted report under `data/research/`, and avoids buy/sell/hold advice or single-score conclusions.
- `/audit [TICKER]` runs deterministic local data-quality checks; add `explain` or `--explain` to ask Codex to explain the findings.
- `/research <SYMBOL> [--topic <TEXT>] [--codex]` builds a redacted local market/stats/audit context, optionally asks Codex for external-factor research, and saves the report under `data/research/`. It is research-only: no buy/sell/hold advice and no single score.
- `/hud` shows a compact status line with current mode, watchlist count, quote samples, Codex availability, and last action.

Market data defaults:
- `quant idea new "NVDA earnings momentum"` creates a local ResearchOps record before you collect evidence.
- `quant idea status latest` shows whether each linked symbol has market data, validation status, saved research, and next TossQuant commands. You can also use a unique id prefix, title text, or a linked symbol instead of the full id.
- `quant idea status latest --plain` prints a copy-friendly version for Codex/Claude discussions.
- `quant lab workflow latest` shows the discuss → verify → backtest workflow for the saved idea.
- `quant lab discuss latest` builds a local discussion checklist; add `--codex` to ask Codex when available.
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

TossQuant exposes a curated tool registry instead of letting LLMs run arbitrary shell commands:

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
TossQuant filters Codex CLI transcript noise such as hook lines and sandbox warnings, then renders the model response in a colored Codex window.
When invoking a skill from a regular shell instead of the interactive prompt, quote the `$...` token (for example `quant '$tossquant-idea-coach --lang ko'`) so your shell does not expand it as an environment variable.

Codex safety boundaries:
- Codex receives summarized/redacted local context, not raw credentials.
- Codex should recommend research steps and supported TossQuant commands only.
- Codex must not give direct buy/sell/hold instructions.
- Research reports use uncertainty wording, avoid single buy/sell scores, and separate local facts from external context.
- Trading remains preview-only; TossQuant has no real order mutation command.
