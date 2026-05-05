---
name: tossquant-research-lab
description: "Use when turning a saved TossQuant idea into a structured quant research workflow with data readiness checks, external-factor research, skeptical verification, Korean/English reporting, and backtest planning. Trigger for TossQuant idea, research, lab, hypothesis, strategy validation, or backtest workflow requests."
---

# TossQuant Research Lab

Use this skill to guide a saved TossQuant idea through a safe research workflow:

`idea → data readiness → research → discussion → verification → backtest brief → next action`

This skill orchestrates TossQuant CLI commands and explains their results. It does **not** provide investment advice, live trading signals, or order mutation.

## Language policy

Default to Korean when the user writes Korean. Otherwise match the user's language.

Support explicit language selectors in the user's request:

- `--lang ko`, `한국어`, `Korean`: Korean output.
- `--lang en`, `English`: English output.
- `--lang bilingual`, `한영`, `both`: Korean first, then concise English labels/summaries.

If no selector is provided:

1. Korean user text → Korean report.
2. English user text → English report.
3. Mixed/unclear text → Korean report with English command names unchanged.

Keep CLI commands exactly as executable command text; do not translate command flags.

## Safety boundaries

Always enforce these boundaries:

- Do not provide buy/sell/hold advice.
- Do not create a single numeric trading score.
- Do not suggest or perform live order placement.
- Do not mutate broker, account, or portfolio state.
- Treat all conclusions as hypotheses, not trading recommendations.
- Separate local data facts from external/event inference.
- Prefer uncertainty language unless evidence is explicit and strong.

## Command preference

When acting inside the TossQuant-cli repository, prefer repo-local command routing where available:

- Prefer `rtk <command ...>` if `rtk` is available.
- Otherwise use `quant <command ...>` for user-facing examples.
- Use `node ./src/cli.ts ...` only for raw entrypoint diagnostics or tests.

For user-facing guidance, show commands as `quant ...` or slash commands `/...`.

## Workflow

### 1. Resolve the idea

Use the idea reference the user gave. If none is provided, use `latest`.

Run or suggest:

```bash
quant idea status <IDEA_REF>
```

Accepted references include:

- `latest`
- full idea id
- unique id prefix
- title text
- linked symbol such as `NVDA`

### 2. Check readiness

From `idea status`, identify blockers:

- No symbol → suggest `quant idea add-symbol <IDEA_REF> <SYMBOL>`.
- Missing market data → suggest `quant data download <SYMBOL> --period 1y`.
- Missing validation → suggest `quant data validate <SYMBOL>`.
- Missing stats → suggest `quant stats <SYMBOL>`.
- Missing external research → suggest `quant research <SYMBOL> --topic "<IDEA_TITLE_OR_HYPOTHESIS>"`.

If data is missing, stop at the next concrete data command instead of pretending the idea is ready.

### 3. Run or guide research

Use:

```bash
quant research <SYMBOL> --topic "<TOPIC>"
```

For local-only/no-Codex mode:

```bash
quant research <SYMBOL> --topic "<TOPIC>" --no-codex
```

Explain that research combines local OHLCV/stats/audit context with read-only external-event analysis and saves reports under:

```text
data/research/<SYMBOL>.jsonl
```

### 4. Discuss the idea

Use:

```bash
quant lab discuss <IDEA_REF> --no-codex
```

Expected output to summarize:

- research questions
- missing evidence
- search/source tasks
- expected proof or disproof from each next command

### 5. Verify skeptically

Use:

```bash
quant lab verify <IDEA_REF> --no-codex
```

Check for:

- data leakage
- survivorship bias
- cherry-picking
- confounders
- insufficient sample size
- weak causal claims
- missing baseline/benchmark
- unclear entry/exit rule definitions

Classify readiness as one of:

- `blocked`: cannot proceed until missing data/research is fixed.
- `needs-more-evidence`: research can continue, but backtest design is premature.
- `ready-for-backtest-brief`: enough context exists to draft a deterministic backtest plan.

### 6. Produce backtest brief

Use:

```bash
quant lab backtest <IDEA_REF> --prompt
```

Summarize the brief into:

- hypothesis
- universe
- local data inputs
- parameterized strategy rules
- benchmark/baseline
- metrics
- leakage controls
- fixtures/tests needed
- explicit non-goals

Do not write live trading code unless the user separately asks for implementation and the repo has a tested non-mutating backtest module plan.

### 7. Final response shape

Use the selected language. Default Korean final shape:

```text
## 현재 상태
- Idea: ...
- Symbols: ...
- Readiness: ...

## 막힌 부분
- ...

## 다음 명령
```bash
quant ...
```

## 검증 관점
- ...

## 백테스트 준비도
blocked | needs-more-evidence | ready-for-backtest-brief
```

For English, translate section headings:

```text
## Current state
## Blockers
## Next commands
## Verification lens
## Backtest readiness
```

For bilingual, use Korean headings with short English labels in parentheses:

```text
## 현재 상태 (Current state)
## 막힌 부분 (Blockers)
## 다음 명령 (Next commands)
## 검증 관점 (Verification lens)
## 백테스트 준비도 (Backtest readiness)
```

## Common examples

Korean:

```text
$tossquant-research-lab latest --lang ko
```

English:

```text
$tossquant-research-lab latest --lang en
```

Bilingual:

```text
$tossquant-research-lab NVDA --lang bilingual
```

## Stop conditions

Stop and report the blocker when:

- no saved idea can be resolved,
- no symbol is attached,
- market data is missing,
- validation fails with serious data quality issues,
- external research is required but unavailable and the user requested Codex-backed research,
- the user asks for buy/sell/hold advice or live order behavior.
