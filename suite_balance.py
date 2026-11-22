"""Plan whole-file CI shards using pytest xunit1 history and per-worker setup costs."""
import argparse
from collections import defaultdict
from fractions import Fraction
import json
from math import ceil
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
from statistics import median
import xml.etree.ElementTree as ET

from planner import plan, TestFile


def file_key(raw):
    if not isinstance(raw, str) or not raw.strip() or PureWindowsPath(raw).anchor:
        raise ValueError(f"expected a repository-relative file path: {raw!r}")
    key = PurePosixPath(raw.replace("\\", "/"))
    if key == PurePosixPath(".") or ".." in key.parts or key.is_absolute():
        raise ValueError(f"invalid repository-relative file path: {raw!r}")
    return str(key)


def history(path, wanted):
    root = ET.parse(path).getroot()
    def tag(element):
        return element.tag.rsplit("}", 1)[-1]
    if tag(root) not in ("testsuite", "testsuites"):
        raise ValueError(f"{path}: expected a JUnit testsuite or testsuites root")
    elapsed = defaultdict(Fraction)
    incomplete = set()
    for case in root.iter():
        if tag(case) != "testcase":
            continue
        if "file" not in case.attrib:
            raise ValueError(f"{path}: testcase lacks file attribute; use pytest -o junit_family=xunit1")
        key = file_key(case.attrib["file"])
        if key not in wanted:
            continue
        if any(tag(child) in {"error", "failure", "skipped"} for child in case):
            incomplete.add(key)
            continue
        seconds = case.get("time", "")
        if not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", seconds):
            raise ValueError(f"{path}: invalid testcase time for {key}: {seconds!r}")
        elapsed[key] += Fraction(seconds) * 1000
    return {key: value for key, value in elapsed.items() if key not in incomplete}


def from_reports(manifest, reports, workers):
    if not isinstance(manifest, dict) or not isinstance(manifest.get("setup_ms"), dict) or not isinstance(manifest.get("files"), list):
        raise ValueError("manifest must contain a setup_ms object and files array")
    files = []
    wanted = set()
    for row in manifest["files"]:
        if not isinstance(row, dict):
            raise ValueError("expected a file record")
        name = file_key(row.get("path"))
        fallback = row.get("fallback_ms")
        fixture = row.get("fixture")
        if name in wanted or type(fallback) is not int or fallback < 0 or not isinstance(fixture, str):
            raise ValueError(f"duplicate path or invalid fixture/fallback_ms: {name}")
        wanted.add(name)
        files.append(TestFile(name, fallback, fixture))
    samples = defaultdict(list)
    for report in reports:
        for name, duration in history(report, wanted).items():
            samples[name].append(duration)
    estimates = []
    measured = []
    for file in files:
        values = samples[file.path]
        duration = ceil(median(values)) if values else file.duration_ms
        measured.append(TestFile(file.path, duration, file.fixture))
        estimates.append({"path": file.path, "duration_ms": duration, "history_runs": len(values)})
    return {**plan(measured, manifest["setup_ms"], workers), "estimates": estimates}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--workers", type=int, required=True)
    parser.add_argument("--junit", type=Path, action="append", default=[], help="repeat for separate historical runs")
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
        result = from_reports(manifest, args.junit, args.workers)
    except (OSError, ValueError, ET.ParseError) as error:
        parser.exit(2, f"{error}\n")
    print(json.dumps(result, ensure_ascii=True, indent=2))
