from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SENSITIVE_KEYS = {
    "token", "access_token", "refresh_token", "session", "session_id", "cookie", "cookies",
    "authorization", "account_number", "account_no", "accountnumber", "accountno", "accountid", "account_id", "acctno", "acct_no", "secret", "password",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def data_dir(base: str | Path | None = None) -> Path:
    root = Path(base) if base else Path.cwd() / "data"
    root.mkdir(parents=True, exist_ok=True)
    return root


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned = {}
        for key, item in value.items():
            norm = str(key).lower().replace("-", "_")
            cleaned[key] = "<redacted>" if norm in SENSITIVE_KEYS else redact(item)
        return cleaned
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def quote_history_path(ticker: str, base: str | Path | None = None) -> Path:
    return data_dir(base) / "quotes" / f"{ticker.upper()}.jsonl"


def snapshot_path(name: str, base: str | Path | None = None) -> Path:
    return data_dir(base) / "snapshots" / f"{name}.jsonl"
