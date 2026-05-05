# QuantOps-cli Agent Guide

This file is the repository-local operating contract for agents working in QuantOps-cli.

## Project shape

- `src/` is the active TypeScript runtime. Keep `src/cli.ts` as the single CLI entrypoint/dispatcher and do not recreate a nested `src/cli/` folder.
- `src/ui/` owns terminal rendering concerns such as chat boxes, prompt styling, and other reusable UI primitives.
- `src/__tests__/` contains TypeScript tests, split by module/file. Prefer adding `src/__tests__/<module>.test.ts` instead of re-creating root `tests-ts/`.
- `tossquant_cli/` is the retained Python analysis/reference implementation. Do not delete it just because the active runtime is TypeScript.
- `tossquant_cli/__tests__/` contains Python tests. Do not re-create a root `tests/` directory.
- `bin/` is local-only and ignored. Do not add executable launchers in `bin/` to git; `setup bin` should link tracked source entrypoints.
- `.omx/` and `data/` are local runtime state and must stay untracked.

## Module rules

- Put reusable rendering in `src/ui/*`.
- Keep CLI command dispatch, completion tables, and small argument helpers in `src/cli.ts`; do not add files under `src/cli/`.
- Keep broker/tossctl integration in `src/toss.ts`.
- Keep runtime state/HUD model logic in `src/runtime.ts` and tmux orchestration in `src/hud.ts` unless a follow-up refactor creates narrower modules.
- Keep data redaction and persistence in `src/storage.ts`.
- Avoid new dependencies unless the user explicitly asks for them.

## UI rules

- Chat UI uses `#eeeeee` as a background, not as foreground text.
- Chat text should remain black/default-readable on the light background.
- In interactive mode, user commands, QuantOps results, warnings, runtime lines, and Codex responses should be visually distinct.
- In subcommand mode, preserve machine-friendly JSON/stdout behavior.
- The tmux HUD belongs in the bottom pane; do not print persistent HUD spam into the top command pane.

## Command execution rules

- Run local QuantOps commands through `rtk` by default. Prefer `rtk <command ...>` over calling `node ./src/cli.ts`, `quant`, or `quantops` directly unless a test explicitly needs the raw entrypoint.
- Keep direct `node ./src/cli.ts ...` usage limited to entrypoint-specific tests, launcher installation checks, or fallback diagnostics where `rtk` itself is the suspected problem.

## Testing rules

- TypeScript: run `npm test` for all TS tests or `node --test src/__tests__/<file>.test.ts` for a single module.
- Python: run `python3 -m unittest discover -s tossquant_cli/__tests__`.
- Compile check: run `python3 -m compileall tossquant_cli` after Python-adjacent changes.
- Smoke check: run `npm run smoke`; for interactive UI changes also run a piped `quant --no-tmux` smoke.

## Commit rules

- Follow the Lore commit protocol from the session/root instructions.
- Include verification evidence in commit trailers.
- Keep diffs reviewable and reversible.
