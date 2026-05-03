# TossQuant

Codex/Claude-style terminal-first quant learning CLI around `tossctl` read-only data.

## Interactive mode

```bash
./bin/tossquant
# or
./bin/quant
```

Then type:

```text
tossquant> /help
tossquant> doctor
tossquant> quote AAPL
tossquant> history AAPL
tossquant> classify AAPL
tossquant> portfolio
tossquant> /ask what should I study next?
tossquant> /codex
tossquant/codex> explain my AAPL history file
tossquant/codex> /quant
tossquant> exit
```

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
