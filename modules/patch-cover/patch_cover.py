"""Measure changed Python statements in a temporary worktree of the reviewed commit."""
import argparse
from fractions import Fraction
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from tempfile import TemporaryDirectory


def git(repo, *args):
    p = subprocess.run(["git", "-C", repo, *args], capture_output=True)
    if p.returncode:
        raise ValueError(p.stderr.decode(errors="replace").strip() or "Git command failed")
    return p.stdout


def commit(repo, ref):
    return git(repo, "rev-parse", "--verify", "--end-of-options", ref + "^{commit}").decode().strip()


def folder(value):
    path = PurePosixPath(value)
    if not value or path.is_absolute() or ".." in path.parts or "\\" in value or ":" in value:
        raise ValueError("source and test directories must be repository-relative paths")
    return path


def changed_ranges(repo, old, new):
    patch = git(repo, "diff", "--text", "--no-ext-diff", "--no-textconv", "--no-color",
                "--unified=0", "--inter-hunk-context=0", old, new)
    result = []
    for match in re.finditer(rb"^@@ -[0-9]+(?:,[0-9]+)? \+([0-9]+)(?:,([0-9]+))? @@", patch, re.M):
        start, count = int(match[1]), int(match[2] or b"1")
        if count:
            result.append((start, start+count-1))
    return result


def diff_files(repo, base, head, source):
    raw = git(repo, "diff-tree", "--no-commit-id", "--raw", "-r", "-z", "--no-abbrev", "-M50%", base, head)
    fields = iter(raw.rstrip(b"\0").split(b"\0")) if raw else iter(())
    changes = {}
    for header in fields:
        old_mode, mode, old, new, status = header[1:].decode("ascii").split()
        before = PurePosixPath(os.fsdecode(next(fields)))
        after = PurePosixPath(os.fsdecode(next(fields))) if status[0] in "RC" else before
        if status == "D" or after.suffix != ".py" or not after.is_relative_to(source):
            continue
        if mode not in ("100644", "100755"):
            raise ValueError(f"expected a regular Python file: {after}")
        # Treat entry into the measured source tree as new code.
        if old_mode not in ("100644", "100755") or before.suffix != ".py" or not before.is_relative_to(source):
            changes[str(after)] = None
        elif old != new:
            ranges = changed_ranges(repo, old, new)
            if ranges:
                changes[str(after)] = ranges
    return changes


def evaluate(repo, base_ref, head_ref, source, tests, minimum):
    if not 0 <= minimum <= 100:
        raise ValueError("minimum must be between 0 and 100")
    source, tests = folder(source), folder(tests)
    head = commit(repo, head_ref)
    ancestors = git(repo, "merge-base", "--all", commit(repo, base_ref), head).decode().splitlines()
    if len(ancestors) != 1:
        raise ValueError("comparison requires a unique common ancestor")
    changes = diff_files(repo, ancestors[0], head, source)
    with TemporaryDirectory() as tmp:
        tree = Path(tmp) / "review"
        report = Path(tmp) / "measurement.json"
        git(repo, "worktree", "add", "--quiet", "--detach", tree, head)
        try:
            proc = subprocess.run([sys.executable, "-I", Path(__file__).resolve().with_name("measure.py"),
                                   str(source), str(tests), report], cwd=tree,
                                  input=json.dumps(changes).encode("utf-8"), stdout=sys.stderr)
            if proc.returncode:
                raise ValueError("test execution or coverage measurement failed")
            # Reject line numbers if the suite rewrote a tracked source.
            git(tree, "--literal-pathspecs", "diff", "--quiet", head, "--", str(source))
            measured = json.loads(report.read_bytes())
        finally:
            git(repo, "worktree", "remove", "--force", tree)

    files = []
    covered = total = 0
    for name, (selected, missing) in sorted(measured["files"].items()):
        files.append({"path": name, "statements": selected, "missing": missing})
        total += len(selected)
        covered += len(selected) - len(missing)
    return {"merge_base": ancestors[0], "head": head, "tests_run": measured["tests_run"],
            "covered": covered, "statements": total, "percent": 100*covered/total if total else None,
            "passed": total == 0 or 100*covered >= minimum*total, "files": files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--source", required=True)
    parser.add_argument("--tests", required=True)
    parser.add_argument("--minimum", default="100")
    args = parser.parse_args()
    try:
        minimum = Fraction(args.minimum)
        result = evaluate(args.repo, args.base, args.head, args.source, args.tests, minimum)
    except (ValueError, OSError, ZeroDivisionError) as exc:
        parser.exit(2, f"{parser.prog}: {exc}\n")
    print(json.dumps(result, indent=2))
    return int(not result["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
