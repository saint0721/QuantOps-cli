# QuantOps

QuantOps is a headless quant research runtime for Codex-style workflows.
The product direction is simple: **user talks to Codex → Codex calls `rtk ... --json` → QuantOps returns deterministic data, validation, research, backtest, session, and artifact context**.

The active `rtk`, `quant`, and `quantops` launchers point at `src/cli.ts`. Python remains available only as a compatibility/reference module through `quantops_cli`.

## Runtime contract

Use QuantOps from a Codex shell/session. Prefer JSON for every command that Codex will parse:

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
rtk session current --json
```

Runtime decisions:

- Primary interface: shell CLI with stable `--json` outputs.
- Primary human UX: Codex conversation, not a QuantOps-local chat surface.
- QuantOps role: symbol lookup, market data, validation, stats, comparison, research context, event study, backtest, and session/artifact handoff.
- Secondary/debug-only surfaces: interactive launchers, terminal dashboards, and local compatibility shortcuts.
- Safety: no buy/sell/hold advice, no single trade score, and no live trading mutation by default.

## Install and launch

QuantOps runs on Node.js/TypeScript and intentionally has no npm runtime dependencies.

```bash
node --version   # requires >= 24
npm test
node ./src/cli.ts setup bin
```

`setup bin` creates symlinks in `~/.local/bin`:

```text
~/.local/bin/rtk -> <repo>/src/cli.ts
~/.local/bin/quant -> <repo>/src/cli.ts
~/.local/bin/quantops -> <repo>/src/cli.ts
```

`rtk` is the preferred launcher. `quant` and `quantops` remain aliases for compatibility.
For headless use, call subcommands directly with `--json`; use `rtk --no-tmux` or `QUANTOPS_NO_TMUX=1 rtk` only when you need the plain interactive shell for debugging.

The Python reference prototype remains available for comparison:

```bash
python3 -m quantops_cli --no-tmux
```

## Supported command families

### Codex guide and runtime info

```bash
rtk codex-guide --json
rtk runtime info --json
rtk doctor
```

`codex-guide` prints the machine-readable contract Codex should follow. `runtime info` and `doctor` report local runtime readiness, launcher setup, optional helper availability, and safety state.

### Symbol resolution

```bash
rtk symbol search TSMC --json
rtk symbol search 삼성전자 --json
```

Use `symbol search` before data work when the user's language is ambiguous or ticker-specific context is needed.

### Market data

```bash
rtk data info TSM --json
rtk data download TSM --period 5y --json
rtk data download TSM --source alphavantage --period 1y --json
rtk data refresh TSM --json
rtk data validate TSM --json
```

`data download` stores OHLCV market data under `data/market/`. `data info` reports coverage/freshness, `data refresh` updates saved datasets, and `data validate` checks readiness and common data-quality problems.

Supported provider setup checks include:

```bash
rtk sources alphavantage
rtk sources twelve
rtk sources polygon
rtk sources fmp
rtk provider list --json
```

### Stats and comparison

```bash
rtk stats TSM --json
rtk compare TSM SOXX NVDA ASML --json
```

`stats` summarizes local returns, volatility, drawdown, moving averages, volume, and readiness metrics. `compare` puts a target beside peers or benchmarks for Codex to interpret with uncertainty.

### Research context

```bash
rtk research TSM --topic "earnings momentum" --json
```

`research` builds educational external-factor context and stores redacted reports under `data/research/`. Codex should separate local facts from external context and avoid direct trading instructions.

### Event studies

```bash
rtk event define --type earnings --target-symbol TSM --benchmark SOXX --json
rtk event study TSM --event-date 2026-01-15 --benchmark SOXX --json
```

Use event commands to turn news, earnings, competitor moves, or macro shocks into testable event windows.

### Backtests

```bash
rtk backtest strategies --json
rtk backtest run TSM --strategy ma-cross --json
```

Backtests run against saved local data and write results under `data/backtests/`. They never place live orders.

### Session and artifact handoff

```bash
rtk session current --json
rtk session list --json
rtk session handoff <SESSION_ID>
```

`session current --json` and `session list --json` expose redacted session metadata for Codex. `session handoff <SESSION_ID>` prints a copy-friendly handoff so later Codex turns can continue the investigation without credentials or raw account details.

## Rust execution helpers

The TypeScript runtime handles normal commands directly. Selected compute-heavy commands can use Rust helpers when built or explicitly requested:

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

# Force cargo-backed execution:
QUANTOPS_STATS_ENGINE=rust-cargo rtk stats TSM --source yahoo --json
QUANTOPS_BACKTEST_ENGINE=rust-cargo rtk backtest run TSM --strategy ma-cross --source yahoo --json
QUANTOPS_EVENT_ENGINE=rust-cargo rtk event study TSM --event-date 2026-01-15 --benchmark SOXX --source yahoo --json
QUANTOPS_VALIDATE_ENGINE=rust-cargo rtk data validate TSM --json
```

`rtk doctor` reports helper paths, cargo availability, and build hints under `rust_stats`, `rust_backtest`, `rust_event`, and `rust_validate`.

## Configuration

QuantOps is safe to publish as a public repository when secrets stay outside git.
Export only the values you need from your shell/profile or secret manager:

```bash
export QUANT_TOSSCTL=/path/to/tossctl
export ALPHA_VANTAGE_API_KEY=...
export FRED_API_KEY=...
export OPENDART_API_KEY=...
export POLYGON_API_KEY=...
export STOOQ_API_KEY=...     # optional; default downloads use Yahoo Finance
```

Local `.env*` files and runtime `data/` are ignored by git. Keep API keys, broker credentials, account identifiers, and downloaded account snapshots out of commits.

## Safety boundaries

- No web UI.
- No sensitive credential/session/account identifier storage in project data.
- No order mutation command in V1.
- Broker/tossctl diagnostics are optional integration checks and do not block the research harness.
- Research reports must use uncertainty wording, avoid single buy/sell scores, and separate local facts from external context.
