"""Run this project's tests, plan from real pytest XML, and verify every selected worker's cases."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent


def run_tests(paths, output):
    command = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-o", "junit_family=xunit1",
               "-o", "junit_duration_report=call", "--junitxml", str(output), "--", *paths]
    subprocess.run(command, cwd=ROOT, check=True)
    cases = ET.parse(output).getroot().iter("testcase")
    return Counter((c.attrib["file"], c.attrib["classname"], c.attrib["name"]) for c in cases)


def main():
    files = ["test_planner.py", "test_history.py"]
    with TemporaryDirectory() as temp:
        root = Path(temp)
        baseline = root / "baseline.xml"
        reference = run_tests(files, baseline)
        manifest = {"setup_ms": {"python": 0}, "files": [
            {"path": name, "fixture": "python", "fallback_ms": 1} for name in files]}
        source = root / "manifest.json"
        source.write_text(json.dumps(manifest))
        raw = subprocess.check_output([sys.executable, str(ROOT / "suite_balance.py"), str(source),
                                       "--workers", "2", "--junit", str(baseline)])
        result = json.loads(raw)
        assert all(item["history_runs"] == 1 for item in result["estimates"])
        groups = [worker["paths"] for worker in result["workers"] if worker["paths"]]
        assert Counter(p for g in groups for p in g) == Counter(files)
        with ThreadPoolExecutor(max_workers=2) as pool:
            runs = [pool.submit(run_tests, group, root / f"worker-{i}.xml") for i, group in enumerate(groups)]
            actual = sum((future.result() for future in runs), Counter())
        assert reference and all(n == 1 for n in reference.values()) and actual == reference
        print(f"Verified {actual.total()} cases from {len(files)} files across {len(groups)} nonempty workers.")


if __name__ == "__main__":
    main()
