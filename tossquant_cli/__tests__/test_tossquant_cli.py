from __future__ import annotations

import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

from tossquant_cli.analysis import classify, history_rows
from tossquant_cli.audit import audit_all
from tossquant_cli.codex_tools import build_local_context, build_task_prompt, filtered_codex_output, run_codex_task
from tossquant_cli.storage import append_jsonl, quote_history_path, read_jsonl, read_watchlist, redact, write_watchlist
from tossquant_cli.cli import command_audit, completion_candidates, handle_audit, handle_watchlist, main, prompt_for_mode, run_codex_prompt, slash_command_name, status_summary
from tossquant_cli.hud import launch_tmux_hud, launch_tmux_runtime
from tossquant_cli.runtime import build_runtime_snapshot, read_runtime_snapshot, record_runtime, render_runtime_line, runtime_state_path
from tossquant_cli.toss import run_toss, tossctl_path


class QuantCliLabTests(unittest.TestCase):
    def test_redact_removes_sensitive_keys_nested(self):
        payload = {"token": "abc", "nested": {"account_id": "123", "price": 10}}
        self.assertEqual(redact(payload)["token"], "<redacted>")
        self.assertEqual(redact(payload)["nested"]["account_id"], "<redacted>")
        self.assertEqual(redact(payload)["nested"]["price"], 10)

    def test_quote_history_rows_compute_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = quote_history_path("AAPL", tmp)
            append_jsonl(path, {"ticker": "AAPL", "fetched_at": "t1", "payload": {"price": 100}})
            append_jsonl(path, {"ticker": "AAPL", "fetched_at": "t2", "payload": {"price": 110}})
            rows = history_rows(read_jsonl(path))
            self.assertEqual(rows[0]["price"], 100)
            self.assertAlmostEqual(rows[1]["change"], 0.10)

    def test_classifier_labels_momentum_and_insufficient_data(self):
        self.assertEqual(classify([])["classification"], "insufficient-data")
        records = [
            {"ticker": "A", "fetched_at": "t1", "payload": {"price": 100}},
            {"ticker": "A", "fetched_at": "t2", "payload": {"price": 103}},
            {"ticker": "A", "fetched_at": "t3", "payload": {"price": 106}},
        ]
        self.assertEqual(classify(records)["classification"], "momentum-candidate")

    def test_run_toss_adds_json_output(self):
        with mock.patch("subprocess.run") as run:
            run.return_value = mock.Mock(returncode=0, stdout="{}", stderr="")
            result = run_toss(["quote", "get", "AAPL"])
            self.assertTrue(result.ok)
            self.assertIn("--output", run.call_args.args[0])

    def test_tossctl_path_prefers_env_without_hardcoded_user_path(self):
        with mock.patch.dict("os.environ", {"QUANT_TOSSCTL": "/opt/bin/tossctl"}):
            self.assertEqual(tossctl_path(), "/opt/bin/tossctl")
        with mock.patch.dict("os.environ", {}, clear=True), mock.patch("shutil.which", return_value="/usr/bin/tossctl"):
            self.assertEqual(tossctl_path(), "/usr/bin/tossctl")

    def test_completion_candidates_include_commands_and_nested_commands(self):
        self.assertIn("doctor", completion_candidates("", "quant"))
        self.assertIn("brief", completion_candidates("", "quant"))
        self.assertIn("audit", completion_candidates("", "quant"))
        self.assertIn("strategy", completion_candidates("", "quant"))
        self.assertIn("/codex", completion_candidates("", "quant"))
        self.assertEqual(completion_candidates("quote ", "quant"), ["fetch", "history"])
        self.assertEqual(completion_candidates("portfolio ", "quant"), ["snapshot"])
        self.assertIn("line", completion_candidates("runtime ", "quant"))
        self.assertIn("--tmux", completion_candidates("hud ", "quant"))
        self.assertIn("add", completion_candidates("/watchlist ", "quant"))
        self.assertIn("tmux", completion_candidates("/hud ", "quant"))
        self.assertIn("snapshot", completion_candidates("/runtime ", "quant"))
        self.assertIn("momentum", completion_candidates("/learn ", "quant"))
        self.assertIn("/brief", completion_candidates("", "quant"))
        self.assertIn("/today", completion_candidates("", "quant"))
        self.assertIn("/audit", completion_candidates("", "quant"))
        self.assertIn("/strategy", completion_candidates("", "quant"))
        self.assertIn("/hud", completion_candidates("", "quant"))
        self.assertIn("hud", completion_candidates("", "quant"))
        self.assertIn("runtime", completion_candidates("", "quant"))
        self.assertIn("tmux", completion_candidates("", "quant"))
        self.assertIn("start", completion_candidates("tmux ", "quant"))
        self.assertIn("momentum", completion_candidates("/strategy AAPL ", "quant"))
        self.assertIn("/quant", completion_candidates("hello", "codex"))

    def test_prompt_for_mode_is_readline_safe_and_mode_specific(self):
        plain_prompt = prompt_for_mode("quant")
        hud_prompt = prompt_for_mode("quant", status_line="[TossQuant] main | mode:quant")
        quant_prompt = prompt_for_mode("quant", readline_safe=True)
        codex_prompt = prompt_for_mode("codex", readline_safe=True)
        self.assertIn("TossQuant", plain_prompt)
        self.assertIn("quant", plain_prompt)
        self.assertIn("[TossQuant] main", hud_prompt)
        self.assertIn("\n", hud_prompt)
        self.assertNotIn("\001", plain_prompt)
        self.assertIn("quant", quant_prompt)
        self.assertIn("codex", codex_prompt)
        self.assertIn("\001", quant_prompt)
        self.assertIn("\002", quant_prompt)

    def test_slash_command_name_requires_exact_first_token(self):
        self.assertEqual(slash_command_name("/audit AAPL"), "/audit")
        self.assertEqual(slash_command_name("/strategy AAPL momentum"), "/strategy")
        self.assertEqual(slash_command_name("/auditfoo"), "/auditfoo")
        self.assertEqual(slash_command_name("/strategyfoo"), "/strategyfoo")
        self.assertIsNone(slash_command_name("audit AAPL"))

    def test_watchlist_storage_and_status_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_watchlist(["aapl", "SPY", "aapl"], tmp)
            self.assertEqual(read_watchlist(tmp), ["AAPL", "SPY"])
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "payload": {"price": 1}})
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "payload": {"price": 2}})
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "payload": {"price": 3}})
            summary = status_summary(tmp)
            self.assertEqual(summary["watchlist"], ["AAPL", "SPY"])
            self.assertEqual(summary["counts"]["AAPL"], 3)
            self.assertIn("AAPL", summary["ready"])
            self.assertIn("SPY", summary["needs_more"])

    def test_runtime_snapshot_counts_watchlist_quotes_and_writes_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_watchlist(["AAPL", "SPY"], tmp)
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "fetched_at": "t1", "payload": {"price": 1}})
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "fetched_at": "t2", "payload": {"price": 2}})
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "fetched_at": "t3", "payload": {"price": 3}})
            with mock.patch("tossquant_cli.runtime.shutil.which", return_value="/usr/local/bin/codex"), mock.patch("tossquant_cli.runtime._git_branch", return_value="main"):
                snapshot = build_runtime_snapshot(mode="quant", last_action="test", base=tmp)
                saved = record_runtime(mode="quant", last_action="test", base=tmp)
            self.assertEqual(snapshot["watchlist_count"], 2)
            self.assertEqual(snapshot["quote_files"], 1)
            self.assertEqual(snapshot["quote_samples"], 3)
            self.assertEqual(snapshot["classify_ready"], ["AAPL"])
            self.assertEqual(snapshot["codex"], "ready")
            self.assertTrue(runtime_state_path(tmp).exists())
            self.assertEqual(read_runtime_snapshot(tmp)["last_action"], saved["last_action"])

    def test_runtime_line_contains_core_hud_fields(self):
        line = render_runtime_line(
            {
                "branch": "main",
                "mode": "codex",
                "watchlist_count": 2,
                "quote_files": 1,
                "quote_samples": 3,
                "classify_ready": ["AAPL"],
                "codex": "ready",
                "last_action": "/brief",
                "updated_at": "2026-05-04T00:00:00Z",
            }
        )
        self.assertIn("[TossQuant] main", line)
        self.assertIn("mode:codex", line)
        self.assertIn("quotes:1/3 samples", line)
        self.assertIn("last:/brief", line)

    def test_launch_tmux_hud_requires_binary_and_session(self):
        with mock.patch("tossquant_cli.hud.shutil.which", return_value=None):
            code, message = launch_tmux_hud(base="data")
        self.assertEqual(code, 127)
        self.assertIn("tmux not found", message)
        with mock.patch("tossquant_cli.hud.shutil.which", return_value="/usr/bin/tmux"), mock.patch.dict("os.environ", {}, clear=True):
            code, message = launch_tmux_hud(base="data")
        self.assertEqual(code, 2)
        self.assertIn("not inside a tmux", message)

    def test_launch_tmux_hud_splits_bottom_pane_inside_tmux(self):
        with mock.patch("tossquant_cli.hud.shutil.which", return_value="/usr/bin/tmux"), mock.patch.dict("os.environ", {"TMUX": "session"}), mock.patch("tossquant_cli.hud.subprocess.run") as run:
            run.return_value = mock.Mock(returncode=0, stdout="", stderr="")
            code, message = launch_tmux_hud(base="/tmp/data", height=4, interval=0.5)
        self.assertEqual(code, 0)
        self.assertIn("launched", message)
        command = run.call_args.args[0]
        self.assertEqual(command[:5], ["/usr/bin/tmux", "split-window", "-v", "-l", "4"])
        self.assertIn("tossquant_cli.cli", command[-1])
        self.assertIn("--watch", command[-1])

    def test_launch_tmux_runtime_creates_main_and_bottom_hud_then_attaches(self):
        calls = []

        def fake_run(command, **kwargs):
            calls.append(command)
            return mock.Mock(returncode=0, stdout="", stderr="")

        with mock.patch("tossquant_cli.hud.shutil.which", return_value="/usr/bin/tmux"), mock.patch.dict("os.environ", {}, clear=True), mock.patch("tossquant_cli.hud.subprocess.run", side_effect=fake_run):
            code, message = launch_tmux_runtime(base="data", session="tossquant-test", height=3, interval=1.0, cwd="/repo")
        self.assertEqual(code, 0)
        self.assertIn("closed", message)
        self.assertEqual(calls[0][:6], ["/usr/bin/tmux", "new-session", "-d", "-s", "tossquant-test", "-n"])
        self.assertIn("--no-tmux", calls[0][-1])
        self.assertEqual(calls[1][:6], ["/usr/bin/tmux", "split-window", "-t", "tossquant-test:main", "-v", "-l"])
        self.assertIn("hud --watch", calls[1][-1])
        self.assertEqual(calls[-1], ["/usr/bin/tmux", "attach-session", "-t", "tossquant-test"])

    def test_main_auto_starts_tmux_when_interactive_and_available(self):
        with mock.patch("tossquant_cli.cli.should_auto_start_tmux", return_value=True), mock.patch("tossquant_cli.cli.launch_tmux_runtime", return_value=(0, "closed")) as launch:
            self.assertEqual(main([]), 0)
        launch.assert_called_once()

    def test_main_no_tmux_flag_runs_interactive_directly(self):
        with mock.patch("tossquant_cli.cli.run_interactive", return_value=0) as interactive, mock.patch("tossquant_cli.cli.launch_tmux_runtime") as launch:
            self.assertEqual(main(["--no-tmux"]), 0)
        interactive.assert_called_once()
        launch.assert_not_called()

    def test_handle_watchlist_add_and_remove(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(handle_watchlist(["/watchlist", "add", "AAPL"], tmp), 0)
            self.assertEqual(read_watchlist(tmp), ["AAPL"])
            self.assertEqual(handle_watchlist(["/watchlist", "remove", "AAPL"], tmp), 0)
            self.assertEqual(read_watchlist(tmp), [])

    def test_run_codex_prompt_uses_read_only_sandbox(self):
        with mock.patch("shutil.which", return_value="/usr/local/bin/codex"), mock.patch("subprocess.run") as run:
            run.return_value = mock.Mock(returncode=0, stdout="codex\nanswer\n", stderr="")
            with redirect_stdout(StringIO()):
                code = run_codex_prompt("explain this project")
            self.assertEqual(code, 0)
            command = run.call_args.args[0]
            self.assertEqual(command[:4], ["/usr/local/bin/codex", "exec", "--sandbox", "read-only"])
            self.assertIn("--cd", command)
            self.assertEqual(command[-1], "explain this project")

    def test_run_codex_prompt_requires_codex_binary(self):
        with mock.patch("shutil.which", return_value=None):
            self.assertEqual(run_codex_prompt("hello"), 127)

    def test_build_local_context_is_bounded_and_redacted(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_watchlist(["AAPL"], tmp)
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "fetched_at": "t1", "payload": {"price": 100, "token": "secret"}})
            context = build_local_context(tmp)
            self.assertEqual(context["watchlist"], ["AAPL"])
            self.assertEqual(context["quotes"][0]["samples"], 1)
            self.assertNotIn("secret", str(context))
            self.assertEqual(context["quotes"][0]["latest"]["price"], 100.0)

    def test_run_codex_task_uses_read_only_sandbox_and_safety_prompt(self):
        with mock.patch("shutil.which", return_value="/usr/local/bin/codex"), mock.patch("subprocess.run") as run:
            run.return_value = mock.Mock(returncode=0, stdout="codex\nbrief answer\n", stderr="")
            with redirect_stdout(StringIO()):
                code = run_codex_task("brief", "recommend next commands", {"watchlist": []}, cwd="/tmp/project")
            self.assertEqual(code, 0)
            command = run.call_args.args[0]
            self.assertEqual(command[:4], ["/usr/local/bin/codex", "exec", "--sandbox", "read-only"])
            self.assertEqual(command[5], "/tmp/project")
            self.assertIn("Do not recommend direct buy/sell/hold decisions", command[-1])
            self.assertIn("Currently supported TossQuant commands", command[-1])
            self.assertIn("/strategy <TICKER> momentum", command[-1])
            self.assertNotIn("order preview", command[-1])
            self.assertIn("recommend next commands", command[-1])

    def test_filtered_codex_output_removes_hooks_warning_and_prompt(self):
        raw = "\n".join(
            [
                "OpenAI Codex v0.128.0",
                "--------",
                "user",
                "secret prompt should disappear",
                "warning: Codex could not find bubblewrap on PATH.",
                "hook: Stop",
                "codex",
                "visible answer",
                "hook: Stop Completed",
                "tokens used",
                "1,234",
            ]
        )
        filtered = filtered_codex_output(raw)
        self.assertIn("visible answer", filtered)
        self.assertNotIn("secret prompt", filtered)
        self.assertNotIn("bubblewrap", filtered)
        self.assertNotIn("hook:", filtered)

    def test_build_task_prompt_redacts_context(self):
        prompt = build_task_prompt("audit", "explain", {"token": "secret", "price": 10})
        self.assertNotIn("secret", prompt)
        self.assertIn("<redacted>", prompt)

    def test_audit_reports_missing_and_malformed_quote_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_watchlist(["AAPL", "SPY"], tmp)
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "payload": {"price": 100}})
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "fetched_at": "t2", "payload": {"price": 200}})
            findings = audit_all(tmp)
            codes = {item["code"] for item in findings}
            self.assertIn("missing_quote_history", codes)
            self.assertIn("missing_fetched_at", codes)
            self.assertIn("large_price_jump", codes)

    def test_audit_detects_sensitive_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "fetched_at": "2026-05-04T00:00:00Z", "payload": {"price": 1}, "account_id": "acct-123"})
            findings = audit_all(tmp, "AAPL")
            self.assertIn("sensitive_key", {item["code"] for item in findings})

    def test_audit_reports_malformed_jsonl_without_crashing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = quote_history_path("AAPL", tmp)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{"ticker": "AAPL", "fetched_at": "2026-05-04T00:00:00Z", "payload": {"price": 1}}\nnot-json\n', encoding="utf-8")
            findings = audit_all(tmp, "AAPL")
            self.assertIn("malformed_record", {item["code"] for item in findings})

    def test_audit_explain_handles_malformed_jsonl_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = quote_history_path("AAPL", tmp)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('not-json\n{"ticker": "AAPL", "fetched_at": "2026-05-04T00:00:00Z", "payload": {"price": 1}}\n', encoding="utf-8")
            args = mock.Mock(data_dir=tmp, ticker="AAPL", explain=True)
            with mock.patch("tossquant_cli.cli.run_codex_task", return_value=0) as run_task:
                with redirect_stdout(StringIO()):
                    self.assertEqual(command_audit(args), 0)
            context = run_task.call_args.args[2]
            self.assertIn("audit_findings", context)
            self.assertIn("warnings", context["quotes"][0])

    def test_handle_audit_accepts_dash_dash_explain(self):
        with mock.patch("tossquant_cli.cli.command_audit", return_value=0) as audit:
            self.assertEqual(handle_audit(["/audit", "AAPL", "--explain"], "data"), 0)
        args = audit.call_args.args[0]
        self.assertEqual(args.ticker, "AAPL")
        self.assertTrue(args.explain)

    def test_audit_reports_invalid_timestamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            append_jsonl(quote_history_path("AAPL", tmp), {"ticker": "AAPL", "fetched_at": "not-a-time", "payload": {"price": 1}})
            findings = audit_all(tmp, "AAPL")
            self.assertIn("invalid_timestamp", {item["code"] for item in findings})


if __name__ == "__main__":
    unittest.main()
