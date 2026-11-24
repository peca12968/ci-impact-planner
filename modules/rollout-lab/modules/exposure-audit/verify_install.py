"""Build twice, verify with Wheel Witness, and exercise the installed CLI."""
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent


def verify(comparator, tmp):
    wheels = []
    for label in ("first", "second"):
        dest = tmp / label
        dest.mkdir()
        subprocess.run([sys.executable, "-m", "flit_core.wheel", "--outdir", dest, ROOT], check=True,
                       env={**os.environ, "SOURCE_DATE_EPOCH": "1700000000"})
        wheel, = dest.glob("*.whl")
        wheels.append(wheel)
    result = json.loads(subprocess.check_output([sys.executable, comparator / "compare.py", *wheels]))
    if result["classification"] != "identical":
        raise ValueError(result)
    env_dir = tmp / "installed"
    subprocess.run([sys.executable, "-m", "venv", env_dir], check=True)
    bin_dir = env_dir / ("Scripts" if os.name == "nt" else "bin")
    python = bin_dir / ("python.exe" if os.name == "nt" else "python")
    command = bin_dir / ("exposure-audit.exe" if os.name == "nt" else "exposure-audit")
    subprocess.run([python, "-m", "pip", "install", "-c", ROOT / "requirements.txt", wheels[0]], check=True)
    plan = ROOT / "examples/plan.json"
    sample = subprocess.check_output([python, ROOT / "examples/make_exposures.py", "-"])
    def run(args, data, expected):
        result = subprocess.run([command, plan, *args], cwd=tmp, input=data, capture_output=True)
        if result.returncode != expected:
            raise ValueError(f"{args}: exit {result.returncode}, stderr={result.stderr!r}")
        return result
    feed = tmp / "events.jsonl"
    feed.write_bytes(sample)
    piped = run(["-"], sample, 1)
    if piped.stdout != run([feed], None, 1).stdout:
        raise ValueError("file and pipe produced different reports")
    report = json.loads(piped.stdout)
    assert report["users_tested"] == 32 and report["findings"] == ["sample_ratio_mismatch"]
    balanced = b'\xef\xbb\xbf' + "\n".join(json.dumps({"user": "人" + str(i), "event_id": str(i),
        "stratum": "app", "variant": variant}, ensure_ascii=False)
        for i, variant in enumerate(("control", "treatment"))).encode()
    assert json.loads(run(["-"], balanced, 0).stdout)["findings"] == []
    bad = run(["-"], balanced + b"\n\xff", 2)
    assert not bad.stdout and b"invalid UTF-8 on line 3" in bad.stderr
    print(f"Validated {wheels[0].name}, SHA-256 {result['sha256'][0]}, 32 users, exit codes 0/1/2")


if __name__ == "__main__":
    with TemporaryDirectory() as directory:
        verify(Path(sys.argv[1]).resolve(), Path(directory))
