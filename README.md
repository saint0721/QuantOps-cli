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
python3 -m quant_cli_lab order preview --symbol AAPL --side buy --qty 1 --price 100
```

Safety defaults:
- no web UI
- no sensitive credential/session/account identifier storage in project data
- no order mutation command in V1
- order preview only

## Codex bridge

TossQuant is not an always-on chatbot. It starts in `quant` mode and only calls Codex when you explicitly ask:

- `/ask <question>` runs one Codex request.
- `/codex` changes the prompt to `tossquant/codex>`; normal text is sent to Codex.
- `/quant` returns to normal TossQuant commands.

Codex is launched as `codex exec --sandbox read-only --cd <project> ...` so the first integration is intentionally read-only.
