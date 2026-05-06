from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from quantops_cli.analysis import classify, history_rows
from quantops_cli.audit import audit_all
from quantops_cli.cli import completion_candidates, main
from quantops_cli.data import DownloadRequest, download_history, list_datasets, market_dataset_path, parse_stooq_csv, stooq_url
from quantops_cli.market_analysis import market_stats
from quantops_cli.runtime import build_runtime_snapshot, render_runtime_line
from quantops_cli.storage import append_jsonl, quote_history_path, read_jsonl, read_watchlist, redact, write_watchlist


class QuantOpsPythonCliTests(unittest.TestCase):
    def capture_main(self, argv: list[str]) -> tuple[int, str]:
        stream = io.StringIO()
        with redirect_stdout(stream):
            code = main(argv)
        return code, stream.getvalue()

    def test_help_is_headless_without_conversation_surfaces(self):
        code, output = self.capture_main([])
        self.assertEqual(code, 0)
        self.assertIn("headless mode only", output)
        self.assertIn("no embedded conversational mode", output)
        self.assertNotIn("/ask", output)
        self.assertNotIn("/codex", output)
        self.assertNotIn("tmux", output.lower())

    def test_completion_exposes_only_command_surface(self):
        root = completion_candidates("")
        self.assertIn("data", root)
        self.assertIn("runtime", root)
        self.assertNotIn("/codex", root)
        self.assertNotIn("hud", root)

    def test_storage_redacts_sensitive_values_and_watchlist_normalizes(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_watchlist(["aapl", " AAPL ", "msft"], tmp)
            self.assertEqual(read_watchlist(tmp), ["AAPL", "MSFT"])
            redacted = redact({"access_token": "secret", "nested": {"password": "pw"}})
            self.assertEqual(redacted["access_token"], "<redacted>")
            self.assertEqual(redacted["nested"]["password"], "<redacted>")

    def test_history_and_classify_use_quote_samples(self):
        records = [
            {"ticker": "AAPL", "fetched_at": "2026-01-01T00:00:00Z", "payload": {"price": 100}},
            {"ticker": "AAPL", "fetched_at": "2026-01-02T00:00:00Z", "payload": {"price": 103}},
            {"ticker": "AAPL", "fetched_at": "2026-01-03T00:00:00Z", "payload": {"price": 104}},
        ]
        rows = history_rows(records)
        self.assertEqual(len(rows), 3)
        self.assertEqual(classify(records)["classification"], "momentum-candidate")

    def test_data_download_and_stats_from_fixture_fetcher(self):
        csv = "Date,Open,High,Low,Close,Volume\n2026-01-01,100,101,99,100,1000\n2026-01-02,101,102,100,102,1100\n"
        with tempfile.TemporaryDirectory() as tmp:
            result = download_history(DownloadRequest("AAPL"), base=tmp, fetcher=lambda url: csv)
            self.assertTrue(result["ok"])
            self.assertEqual(len(parse_stooq_csv(csv)), 2)
            self.assertIn("aapl.us", stooq_url(DownloadRequest("AAPL")))
            self.assertEqual(len(list_datasets(tmp)), 1)
            stats = market_stats("AAPL", base=tmp)
            self.assertTrue(stats["ok"])
            self.assertEqual(stats["rows"], 2)

    def test_cli_data_list_and_runtime_snapshot_emit_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            append_jsonl(market_dataset_path(tmp, "stooq", "aapl.us", "d"), {
                "ticker": "AAPL",
                "provider_symbol": "aapl.us",
                "source": "stooq",
                "interval": "d",
                "date": "2026-01-01",
                "payload": {"close": 100, "open": 100, "high": 101, "low": 99, "volume": 1000},
            })
            code, output = self.capture_main(["--data-dir", tmp, "data", "list"])
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(output)["datasets"][0]["symbol"], "AAPL")
            code, output = self.capture_main(["--data-dir", tmp, "runtime", "snapshot"])
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(output)["app"], "QuantOps")

    def test_runtime_line_has_no_codex_or_tmux_status(self):
        snapshot = build_runtime_snapshot(base=tempfile.mkdtemp(), cwd=Path.cwd())
        line = render_runtime_line(snapshot)
        self.assertIn("[QuantOps]", line)
        self.assertNotIn("codex:", line)
        self.assertNotIn("tmux", json.dumps(snapshot).lower())

    def test_audit_reports_empty_state_as_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            findings = audit_all(tmp)
            self.assertTrue(any(item["code"] == "empty_watchlist" for item in findings))

    def test_quote_fetch_redacts_and_persists_payload(self):
        fake = mock.Mock(ok=True, stdout=json.dumps({"price": 10, "access_token": "secret"}), stderr="", returncode=0)
        with tempfile.TemporaryDirectory() as tmp, mock.patch("quantops_cli.toss.quote", return_value=fake):
            code, output = self.capture_main(["--data-dir", tmp, "quote", "fetch", "AAPL"])
            self.assertEqual(code, 0)
            self.assertTrue(json.loads(output)["ok"])
            rows = read_jsonl(quote_history_path("AAPL", tmp))
            self.assertEqual(rows[0]["payload"]["access_token"], "<redacted>")


if __name__ == "__main__":
    unittest.main()
