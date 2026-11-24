import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parent


class CommandTests(unittest.TestCase):
    def test_pipeline_exit_codes_and_reports(self):
        with TemporaryDirectory() as directory:
            feed = Path(directory) / "exposures.jsonl"
            command = [sys.executable, ROOT / "audit.py", ROOT / "examples/plan.json", feed]

            def run(expected):
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stderr)
                return result

            subprocess.run([sys.executable, ROOT / "examples/make_exposures.py", feed], check=True)
            sample = json.loads(run(1).stdout)
            self.assertEqual(sample["findings"], ["sample_ratio_mismatch"])
            self.assertEqual([t["stratum"] for t in sample["tests"] if t["flagged"]], ["app", "web"])

            rows = [dict(event_id=str(i), user=str(i), stratum=["web", "app"][i // 2],
                         variant=["treatment", "control"][i % 2]) for i in range(4)]
            feed.write_text("\n".join(map(json.dumps, rows)), encoding="utf-8-sig")
            self.assertEqual(json.loads(run(0).stdout)["findings"], [])
            rows.append(dict(rows[0], event_id="return", variant="control"))
            feed.write_text("\n".join(map(json.dumps, rows)), encoding="utf-8")
            self.assertEqual(json.loads(run(1).stdout)["findings"], ["inconsistent_assignment"])
            feed.write_text("", encoding="utf-8")
            self.assertEqual(json.loads(run(1).stdout)["findings"], ["no_eligible_users"])
            feed.write_text(json.dumps(rows[0]) + "\n{", encoding="utf-8")
            invalid = run(2)
            self.assertEqual(invalid.stdout, "")
            self.assertIn("line 2", invalid.stderr)
