import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from suite_balance import from_reports


ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "examples/shards.json").read_text())


class HistoryTests(unittest.TestCase):
    def test_public_example(self):
        run = subprocess.run([sys.executable, str(ROOT / "suite_balance.py"), str(ROOT / "examples/shards.json"),
                              "--workers", "2", "--junit", str(ROOT / "examples/history.xml")],
                             text=True, capture_output=True, check=True)
        result = json.loads(run.stdout)
        self.assertEqual((result["baseline_ms"], result["estimated_ms"], result["lower_bound_ms"]), (75, 44, 43))
        self.assertEqual([r["setup_ms"] for r in result["workers"]], [30, 30])
        self.assertEqual([r["duration_ms"] for r in result["estimates"]], [8, 6, 7, 5])

    def test_round_only_after_sum_and_median_skip_incomplete_files(self):
        with TemporaryDirectory() as tmp:
            first, second = (Path(tmp) / name for name in ("1.xml", "2.xml"))
            first.write_text("""<testsuite xmlns="urn:example">
            <testcase file="tests/test_orders.py" time="0.0014"/>
            <testcase file="tests/test_orders.py" time="0.0002"/>
            <testcase file="tests/test_home.py" time="0.01"/><testcase file="tests/test_home.py"><skipped/></testcase>
            <testcase file="deleted.py" time="10"/></testsuite>""")
            second.write_text("""<testsuites><testsuite>
            <testcase file="tests\\test_orders.py" time="0.0024"/>
            <testcase file="./tests/test_home.py" time="0.003"/>
            <testcase file="tests/test_receipts.py"><failure/></testcase>
            </testsuite></testsuites>""")
            report = from_reports(MANIFEST, [first, second], 2)
            self.assertEqual([(r["duration_ms"], r["history_runs"]) for r in report["estimates"]],
                             [(2, 2), (10, 0), (3, 1), (10, 0)])

    def test_no_history_and_duplicate_normalized_paths(self):
        report = from_reports(MANIFEST, [], 2)
        self.assertTrue(all(r["history_runs"] == 0 and r["duration_ms"] == 10 for r in report["estimates"]))
        first = MANIFEST["files"][0]
        with self.assertRaises(ValueError):
            from_reports({**MANIFEST, "files": [first, dict(first, path="./" + first["path"])]}, [], 2)

    def test_bad_report_exits_without_a_partial_plan(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "invalid.xml"
            for content in ["<testsuite>", "<other/>", '<testsuite><testcase time="1"/></testsuite>',
                            '<testsuite><testcase file="tests/test_orders.py" time="NaN"/></testsuite>']:
                path.write_text(content)
                result = subprocess.run([sys.executable, str(ROOT / "suite_balance.py"), str(ROOT / "examples/shards.json"),
                                         "--workers", "2", "--junit", str(path)], capture_output=True)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, b"")
