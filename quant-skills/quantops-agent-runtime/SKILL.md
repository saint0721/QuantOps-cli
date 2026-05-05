---
name: quantops-agent-runtime
description: "Use when Codex or another agent needs to operate QuantOps as a local rtk-based CLI harness: verify runtime health, inspect available tools, choose safe JSON commands, preserve session handoff, and avoid using the deprecated QuantOps-local chat/TUI as the primary UX."
---

# QuantOps Agent Runtime

Use this skill when the human is talking in Codex/tmux and the agent needs QuantOps to execute local quant tasks through `rtk`.

Core contract:

`human request → Codex reasoning → rtk ... --json → summarize artifacts → next rtk command`

Do not treat QuantOps as the primary chat UI. Use it as a deterministic local harness.

## Safety boundaries

Always enforce:

- No buy/sell/hold advice.
- No single trade score.
- No live order placement or account mutation.
- Use read-only/local-write research commands only.
- Keep broker/tossctl status optional unless the user specifically asks about broker integration.
- Summarize evidence and uncertainty separately.

## First-contact checks

Run these before deeper work, unless already verified in the session:

```bash
rtk doctor
rtk runtime info --json
rtk tools list --json
```

If `rtk` is missing, use:

```bash
node ./src/cli.ts --no-tmux setup bin --force
```

Then retry `rtk --no-tmux --help` and `rtk doctor`.

## Command selection rules

Prefer machine-readable commands:

```bash
rtk <command> --json
```

Use tool registry commands when selecting from safe capabilities:

```bash
rtk tools list --json
rtk tools run data.info --symbol TSM --json
rtk tools run data.validate --symbol TSM --json
rtk tools run stats.run --symbol TSM --json
rtk tools run backtest.run --symbol TSM --strategy ma-cross --json
```

Use direct commands when the workflow is clearer:

```bash
rtk symbol search "TSMC" --source yahoo --json
rtk data download TSM --period 5y --json
rtk data validate TSM --json
rtk stats TSM --json
rtk compare TSM SOXX NVDA --json
rtk research TSM --topic "earnings momentum" --json
rtk event study TSM --event-date YYYY-MM-DD --benchmark SOXX --json
rtk backtest run TSM --strategy ma-cross --json
```

## Session handoff

When a conversation should continue across agents or chats, capture the redacted state:

```bash
rtk session handoff
```

Use `.quant/` session summaries and `data/` artifacts. Do not paste raw credentials, broker account identifiers, cookies, or unredacted provider URLs.

## Report shape

Default Korean when the user writes Korean:

````text
## 확인한 런타임
- rtk: ...
- tools: ...
- data/artifacts: ...

## 실행한 명령
```bash
rtk ... --json
```

## 관찰된 증거
- 로컬 데이터 사실: ...
- 추론/가설: ...

## 다음 rtk 명령
```bash
rtk ... --json
```
````

For English, use the same sections translated. Keep commands in English exactly.

## Stop conditions

Stop and ask for clarification when:

- The user asks for live trading or order mutation.
- The requested task needs private/unavailable data.
- `rtk doctor` fails on Node/runtime health, not merely optional broker status.
- The next command would download/write data and the user has not allowed local writes.
