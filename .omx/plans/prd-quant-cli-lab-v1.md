# PRD — Quant CLI Lab V1

## Goal
Create a CLI-first quant learning/analysis tool that wraps tossctl read-only data, stores sanitized local snapshots, and classifies tickers from quote history.

## Non-goals
- No web UI.
- No sensitive credential/session/account identifier storage in project data.
- No real order mutation in V1.

## Commands
- `quant doctor`
- `quant quote fetch <TICKER>`
- `quant quote history <TICKER>`
- `quant classify <TICKER>`
- `quant portfolio snapshot`
- `quant order preview ...`

## Safety
- `tossctl` path configurable via `QUANT_TOSSCTL`, default `/home/saint/.local/bin/tossctl`.
- Store raw outputs only after redaction.
- Trading mutations are absent; preview only.
