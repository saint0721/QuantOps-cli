from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

DEFAULT_TOSSCTL = "/home/saint/.local/bin/tossctl"


@dataclass(frozen=True)
class TossResult:
    ok: bool
    command: list[str]
    stdout: str
    stderr: str
    returncode: int

    def json(self) -> Any:
        return json.loads(self.stdout)


def tossctl_path() -> str:
    configured = os.environ.get("QUANT_TOSSCTL", DEFAULT_TOSSCTL)
    return configured if os.path.exists(configured) else (shutil.which("tossctl") or configured)


def run_toss(args: list[str], *, output_json: bool = True, check: bool = False) -> TossResult:
    cmd = [tossctl_path(), *args]
    if output_json and "--output" not in args:
        cmd.extend(["--output", "json"])
    proc = subprocess.run(cmd, text=True, capture_output=True, check=False)
    result = TossResult(proc.returncode == 0, cmd, proc.stdout, proc.stderr, proc.returncode)
    if check and not result.ok:
        raise RuntimeError(f"tossctl failed ({proc.returncode}): {proc.stderr or proc.stdout}")
    return result


def quote(symbol: str) -> TossResult:
    return run_toss(["quote", "get", symbol.upper()])


def account_summary() -> TossResult:
    return run_toss(["account", "summary"])


def portfolio_positions() -> TossResult:
    return run_toss(["portfolio", "positions"])


def auth_status() -> TossResult:
    return run_toss(["auth", "status"], output_json=False)


def version() -> TossResult:
    return run_toss(["version"], output_json=False)


def order_preview(flags: list[str]) -> TossResult:
    return run_toss(["order", "preview", *flags])
