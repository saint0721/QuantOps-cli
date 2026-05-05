---
name: quantops-data-backtest-check
description: "Use when validating a QuantOps research idea before backtesting: verify local OHLCV readiness, data quality, stats/regime context, event-study inputs, benchmark choice, leakage controls, and decide whether a strategy is blocked, needs more evidence, or is ready for deterministic backtest."
---

# QuantOps Data Backtest Check

Use this skill before writing or trusting a backtest. It turns a research idea into a validation checklist and the minimum `rtk` commands needed to prove readiness.

Goal:

`idea/hypothesis → data readiness → statistical context → event/benchmark checks → backtest readiness verdict`

## Safety boundaries

- No investment advice or buy/sell/hold conclusion.
- No single score.
- No live trading code.
- Do not treat a backtest as proof of profitability.
- Separate observed local data facts from external-event inference.

## Required inputs

Resolve or ask for:

- Symbol or universe.
- Hypothesis in one sentence.
- Time horizon and bar interval.
- Benchmark/baseline.
- Candidate strategy rules and parameters.
- Event dates if the thesis is news/event-driven.

If an idea exists, start with:

```bash
rtk idea status latest --plain
rtk lab workflow latest --json
```

## Data readiness commands

For each symbol and benchmark:

```bash
rtk data info <SYMBOL> --json
rtk data download <SYMBOL> --period 5y --json
rtk data validate <SYMBOL> --json
rtk stats <SYMBOL> --json
```

Only run `data download` when local data is missing/stale or the user allowed local writes. Otherwise report the exact command as the next step.

## Event and external context

For event-driven ideas:

```bash
rtk event define --target-symbol <SYMBOL> --benchmark <BENCHMARK> --topic "<TOPIC>" --json
rtk event study <SYMBOL> --event-date YYYY-MM-DD --benchmark <BENCHMARK> --json
rtk research <SYMBOL> --topic "<TOPIC>" --json
```

Check whether the event date is known and whether benchmark data covers the event window.

## Backtest readiness gates

Classify readiness as exactly one:

- `blocked`: missing data, failing validation, missing benchmark, undefined hypothesis, or unclear rules.
- `needs-more-evidence`: data exists, but causal/event context or baseline is weak.
- `ready-for-backtest`: data is valid, hypothesis is testable, rules are parameterized, and leakage controls are explicit.

Before `ready-for-backtest`, confirm:

- Validation has no serious errors.
- Dataset coverage matches the claimed horizon.
- Benchmark/baseline exists.
- Rules do not use future data.
- Parameters are declared before evaluation.
- Metrics include return, drawdown, volatility, trade count/exposure, and benchmark comparison.
- Out-of-sample or walk-forward plan is named when possible.

## Output shape

Default Korean when the user writes Korean:

````text
## 백테스트 준비도
blocked | needs-more-evidence | ready-for-backtest

## 확인한 데이터
- ...

## 막힌 부분
- ...

## 실행/권장 rtk 명령
```bash
rtk ... --json
```

## 누수/편향 체크
- ...

## 다음 단계
- ...
````

For English, translate headings and keep command text unchanged.

## Stop conditions

Stop before backtest when:

- `rtk data validate` returns errors.
- Data coverage is too short for the proposed strategy.
- The hypothesis requires unavailable data.
- The user asks for actual order execution.
