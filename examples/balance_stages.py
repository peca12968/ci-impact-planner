"""Exercise the two published CLIs with the synthetic contracts-change example."""
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


def output(*args):
    return json.loads(subprocess.check_output(args, text=True, encoding="utf-8"))


def main(balance_cli):
    root = Path(__file__).resolve().parents[1]
    report = output("node", root / "cli.js", "--suites", root / "examples/projects.json",
                    "packages/contracts/schema.json")
    assert report["stages"] == [["contracts"], ["api", "web"], ["checkout-e2e"]]
    totals = []
    with TemporaryDirectory() as directory:
        manifest = Path(directory) / "suite.json"
        for stage in report["suiteStages"]:
            manifest.write_text(json.dumps(stage["manifest"]), encoding="utf-8")
            shards = output(sys.executable, balance_cli, manifest, "--workers", "2")
            expected = sorted(file["path"] for file in stage["manifest"]["files"])
            assigned = sorted(path for worker in shards["workers"] for path in worker["paths"])
            assert assigned == expected
            print(f"{', '.join(stage['projects'])}: {len(assigned)} files, "
                  f"{shards['baseline_ms']} -> {shards['estimated_ms']} ms")
            totals.append((shards["baseline_ms"], shards["estimated_ms"]))
    assert totals == [(5, 5), (75, 44), (39, 39)]


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
