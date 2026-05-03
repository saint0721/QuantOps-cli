from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from quant_cli_lab.analysis import classify, history_rows
from quant_cli_lab.storage import append_jsonl, quote_history_path, read_jsonl, redact
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


if __name__ == "__main__":
    unittest.main()
