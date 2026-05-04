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
to start the plain non-tmux interactive shell. Inside the managed tmux runtime,
`exit`, `quit`, or `:q` closes the whole TossQuant session, including the HUD pane.

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
TossQuant quant ❯ /brief
TossQuant quant ❯ /audit
TossQuant quant ❯ /strategy AAPL momentum
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
quant data download AAPL
quant stats AAPL
quant quote fetch AAPL
quant quote history AAPL
quant classify AAPL
quant portfolio snapshot
quant brief
quant runtime line
quant runtime snapshot
quant hud
quant hud --tmux
quant tmux start
quant order preview --symbol AAPL --side buy --qty 1 --price 100
```

Collection commands are provider-neutral and read-only by default. `collect plan` previews the tickers and existing local sample counts, `collect quote <TICKER>` stores one `tossctl quote get` sample in `data/quotes/<TICKER>.jsonl`, and `collect watchlist` runs the same collection over `data/watchlist.json`. `data download <SYMBOL>` stores OHLCV market data under `data/market/`, and `stats <SYMBOL>` summarizes downloaded return, volatility, drawdown, moving-average, volume, and readiness metrics.

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
- `/brief` or `/today` asks Codex for a local-data session brief and next TossQuant commands.
- `/audit [TICKER]` runs deterministic local data-quality checks; add `explain` or `--explain` to ask Codex to explain the findings.
- `/strategy <TICKER> <TOPIC>` asks Codex for an educational research plan. Topics: `momentum`, `mean-reversion`, `event-study`, `risk`.
- `/hud` shows a compact status line with current mode, watchlist count, quote samples, Codex availability, and last action.

Market data defaults:
- `quant data download AAPL --period 1y` uses Yahoo Finance's chart endpoint by default.
- `quant data download AAPL --source stooq --period 1y` uses Stooq when `STOOQ_API_KEY` is available or Stooq allows CSV access.
- `quant stats AAPL` reads the default Yahoo dataset unless you pass another `--source`.

Codex is launched as `codex exec --sandbox read-only --cd <project> ...` so the first integration is intentionally read-only.
TossQuant filters Codex CLI transcript noise such as hook lines and sandbox warnings, then renders the model response in a colored Codex window.

Codex safety boundaries:
- Codex receives summarized/redacted local context, not raw credentials.
- Codex should recommend research steps and supported TossQuant commands only.
- Codex must not give direct buy/sell/hold instructions.
- Trading remains preview-only; TossQuant has no real order mutation command.
