from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from quant_cli_lab.analysis import classify, history_rows
from quant_cli_lab.storage import append_jsonl, quote_history_path, read_jsonl, read_watchlist, redact, write_watchlist
from quant_cli_lab.cli import completion_candidates, handle_watchlist, prompt_for_mode, run_codex_prompt, status_summary
from quant_cli_lab.toss import run_toss


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

    def test_completion_candidates_include_commands_and_nested_commands(self):
        self.assertIn("doctor", completion_candidates("", "quant"))
        self.assertIn("/codex", completion_candidates("", "quant"))
        self.assertEqual(completion_candidates("quote ", "quant"), ["fetch", "history"])
        self.assertEqual(completion_candidates("portfolio ", "quant"), ["snapshot"])
        self.assertIn("add", completion_candidates("/watchlist ", "quant"))
        self.assertIn("momentum", completion_candidates("/learn ", "quant"))
        self.assertIn("/quant", completion_candidates("hello", "codex"))

    def test_prompt_for_mode_is_readline_safe_and_mode_specific(self):
        plain_prompt = prompt_for_mode("quant")
        quant_prompt = prompt_for_mode("quant", readline_safe=True)
        codex_prompt = prompt_for_mode("codex", readline_safe=True)
        self.assertIn("TossQuant", plain_prompt)
        self.assertIn("quant", plain_prompt)
        self.assertNotIn("\001", plain_prompt)
        self.assertIn("quant", quant_prompt)
        self.assertIn("codex", codex_prompt)
        self.assertIn("\001", quant_prompt)
        self.assertIn("\002", quant_prompt)

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

    def test_handle_watchlist_add_and_remove(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(handle_watchlist(["/watchlist", "add", "AAPL"], tmp), 0)
            self.assertEqual(read_watchlist(tmp), ["AAPL"])
            self.assertEqual(handle_watchlist(["/watchlist", "remove", "AAPL"], tmp), 0)
            self.assertEqual(read_watchlist(tmp), [])

    def test_run_codex_prompt_uses_read_only_sandbox(self):
        with mock.patch("shutil.which", return_value="/usr/local/bin/codex"), mock.patch("subprocess.run") as run:
            run.return_value = mock.Mock(returncode=0)
            code = run_codex_prompt("explain this project")
            self.assertEqual(code, 0)
            command = run.call_args.args[0]
            self.assertEqual(command[:4], ["/usr/local/bin/codex", "exec", "--sandbox", "read-only"])
            self.assertIn("--cd", command)
            self.assertEqual(command[-1], "explain this project")

    def test_run_codex_prompt_requires_codex_binary(self):
        with mock.patch("shutil.which", return_value=None):
            self.assertEqual(run_codex_prompt("hello"), 127)


if __name__ == "__main__":
    unittest.main()
