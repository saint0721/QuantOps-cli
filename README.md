# TossQuant

Codex/Claude-style terminal-first quant learning CLI around `tossctl` read-only data.

## Interactive mode

```bash
./bin/tossquant
# or
./bin/quant
```

Then type. Press `Tab` to autocomplete commands and slash modes:

```text
TossQuant quant ❯ /help
TossQuant quant ❯ doctor
TossQuant quant ❯ quote AAPL
TossQuant quant ❯ history AAPL
TossQuant quant ❯ classify AAPL
TossQuant quant ❯ portfolio
TossQuant quant ❯ /ask what should I study next?
TossQuant quant ❯ /brief
TossQuant quant ❯ /audit
TossQuant quant ❯ /strategy AAPL momentum
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
3. `quote AAPL` several times over time.
4. `/status` to check whether enough samples exist.
5. `classify AAPL` once at least 3 samples are saved.

## Subcommand mode

```bash
python3 -m quant_cli_lab doctor
python3 -m quant_cli_lab quote fetch AAPL
python3 -m quant_cli_lab quote history AAPL
python3 -m quant_cli_lab classify AAPL
python3 -m quant_cli_lab portfolio snapshot
python3 -m quant_cli_lab brief
python3 -m quant_cli_lab audit AAPL --explain
python3 -m quant_cli_lab strategy AAPL momentum
python3 -m quant_cli_lab order preview --symbol AAPL --side buy --qty 1 --price 100
```

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
```

Local `.env*` files and runtime `data/` are ignored by git. Keep API keys,
broker credentials, account identifiers, and downloaded account snapshots out of
commits.

## Codex bridge

TossQuant is not an always-on chatbot. It starts in `quant` mode and only calls Codex when you explicitly ask:

- `/ask <question>` runs one Codex request.
- `/codex` changes the prompt to `tossquant/codex>`; normal text is sent to Codex.
- `/quant` returns to normal TossQuant commands.
- `/brief` or `/today` asks Codex for a local-data session brief and next TossQuant commands.
- `/audit [TICKER]` runs deterministic local data-quality checks; add `explain` or `--explain` to ask Codex to explain the findings.
- `/strategy <TICKER> <TOPIC>` asks Codex for an educational research plan. Topics: `momentum`, `mean-reversion`, `event-study`, `risk`.

Codex is launched as `codex exec --sandbox read-only --cd <project> ...` so the first integration is intentionally read-only.

Codex safety boundaries:
- Codex receives summarized/redacted local context, not raw credentials.
- Codex should recommend research steps and supported TossQuant commands only.
- Codex must not give direct buy/sell/hold instructions.
- Trading remains preview-only; TossQuant has no real order mutation command.
