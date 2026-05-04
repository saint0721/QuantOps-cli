from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path

from .runtime import build_runtime_snapshot, read_runtime_snapshot, record_runtime, render_runtime_line, write_runtime_snapshot

RESET = "\033[0m"
HUD_COLOR = "\033[2m\033[94m"
DEFAULT_TMUX_SESSION = "tossquant"


def color(text: str, ansi: str) -> str:
    return f"{ansi}{text}{RESET}"


def print_hud_once(*, base: str | Path | None = "data", mode: str = "quant", last_action: str = "ready") -> str:
    snapshot = record_runtime(mode=mode, last_action=last_action, base=base)
    line = render_runtime_line(snapshot)
    print(color(line, HUD_COLOR))
    return line


def watch_hud(*, base: str | Path | None = "data", interval: float = 1.0) -> int:
    while True:
        snapshot = read_runtime_snapshot(base)
        if snapshot is None:
            snapshot = build_runtime_snapshot(base=base)
            write_runtime_snapshot(snapshot, base)
        line = render_runtime_line(snapshot)
        print("\033[2J\033[H" + color(line, HUD_COLOR), flush=True)
        time.sleep(max(interval, 0.2))


def tmux_path() -> str | None:
    return shutil.which("tmux")


def tmux_install_hint() -> str:
    return "install tmux with your OS package manager, e.g. apt install tmux, brew install tmux, or pacman -S tmux"


def in_tmux() -> bool:
    return bool(os.environ.get("TMUX"))


def shell_command(parts: list[str]) -> str:
    return " ".join(shlex.quote(str(part)) for part in parts)


def hud_watch_command(*, base: str | Path | None = "data", interval: float = 1.0) -> str:
    return shell_command(
        [
            sys.executable,
            "-m",
            "tossquant_cli.cli",
            "--data-dir",
            str(base or "data"),
            "hud",
            "--watch",
            "--interval",
            str(interval),
        ]
    )


def interactive_command() -> str:
    return shell_command([sys.executable, "-m", "tossquant_cli.cli", "--no-tmux"])


def launch_tmux_hud(*, base: str | Path | None = "data", height: int = 3, interval: float = 1.0, cwd: str | Path | None = None) -> tuple[int, str]:
    tmux = tmux_path()
    if not tmux:
        return 127, f"tmux not found in PATH; {tmux_install_hint()}"
    if not in_tmux():
        return 2, "not inside a tmux session; run tossquant with no arguments or start tmux first"

    height = max(1, int(height))
    command = hud_watch_command(base=base, interval=interval)
    args = [tmux, "split-window", "-v", "-l", str(height)]
    if cwd is not None:
        args.extend(["-c", str(cwd)])
    args.append(command)
    completed = subprocess.run(args, text=True, capture_output=True, check=False)
    message = (completed.stderr or completed.stdout or "tmux HUD launched").strip()
    return int(completed.returncode), message


def launch_tmux_runtime(
    *,
    base: str | Path | None = "data",
    session: str = DEFAULT_TMUX_SESSION,
    height: int = 3,
    interval: float = 1.0,
    cwd: str | Path | None = None,
) -> tuple[int, str]:
    tmux = tmux_path()
    if not tmux:
        return 127, f"tmux not found in PATH; {tmux_install_hint()}"
    if in_tmux():
        return 2, "already inside tmux; use /hud tmux to add the TossQuant HUD pane"

    cwd_path = Path(cwd or Path.cwd())
    height = max(1, int(height))
    target = f"{session}:main"
    main_command = interactive_command()
    hud_command = hud_watch_command(base=base, interval=interval)

    create = subprocess.run(
        [tmux, "new-session", "-d", "-s", session, "-n", "main", "-c", str(cwd_path), main_command],
        text=True,
        capture_output=True,
        check=False,
    )
    if create.returncode != 0:
        existing = subprocess.run([tmux, "has-session", "-t", session], text=True, capture_output=True, check=False)
        if existing.returncode == 0:
            attach = subprocess.run([tmux, "attach-session", "-t", session], text=True, capture_output=True, check=False)
            return int(attach.returncode), "attached existing TossQuant tmux session"
        return int(create.returncode), (create.stderr or create.stdout or "failed to create tmux session").strip()

    split = subprocess.run(
        [tmux, "split-window", "-t", target, "-v", "-l", str(height), "-c", str(cwd_path), hud_command],
        text=True,
        capture_output=True,
        check=False,
    )
    if split.returncode != 0:
        return int(split.returncode), (split.stderr or split.stdout or "failed to create HUD pane").strip()

    subprocess.run([tmux, "select-pane", "-t", f"{target}.0"], text=True, capture_output=True, check=False)
    attach = subprocess.run([tmux, "attach-session", "-t", session], text=True, capture_output=True, check=False)
    return int(attach.returncode), "TossQuant tmux runtime closed"
