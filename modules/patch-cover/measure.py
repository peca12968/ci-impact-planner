"""Run the reviewed commit's unittest suite and measure its executable source lines."""
from bisect import bisect_left, bisect_right
import json
from pathlib import Path
import sys
import tokenize
import unittest

from coverage import Coverage


def touched_statements(path, statements, ranges):
    if ranges is None:
        return sorted(statements)
    # A changed argument on a continuation line belongs to the same logical
    # statement. A comment-only edit within that argument list adds no code.
    selected = set()
    statements = sorted(statements)
    start = None
    changed = False
    cursor = 0
    with path.open("rb") as stream:
        for token in tokenize.tokenize(stream.readline):
            if token.type == tokenize.NEWLINE:
                if changed:
                    lo = bisect_left(statements, start)
                    hi = bisect_right(statements, token.start[0])
                    selected.update(statements[lo:hi])
                start, changed = None, False
                continue
            if token.type in (tokenize.ENCODING, tokenize.COMMENT, tokenize.NL, tokenize.INDENT,
                              tokenize.DEDENT, tokenize.ENDMARKER):
                continue
            if start is None:
                start = token.start[0]
            while cursor < len(ranges) and ranges[cursor][1] < token.start[0]:
                cursor += 1
            if cursor < len(ranges) and ranges[cursor][0] <= token.end[0]:
                changed = True
    return sorted(selected)


def main():
    root = Path.cwd().resolve()
    source, tests = [root / arg for arg in sys.argv[1:3]]
    if any(not path.is_dir() or not path.resolve().is_relative_to(root) for path in (source, tests)):
        raise ValueError("source and tests must be directories in the reviewed tree")
    changes = json.load(sys.stdin)
    sys.path[:0] = [str(root), str(source)]
    cov = Coverage(source=[str(source)], data_file=None, config_file=False)
    cov.start()
    try:
        suite = unittest.defaultTestLoader.discover(str(tests))
        result = unittest.TextTestRunner().run(suite)
    finally:
        cov.stop()
    if not result.wasSuccessful() or result.testsRun == 0:
        raise ValueError("a nonempty passing test suite is required")
    measured = {}
    for name, ranges in changes.items():
        path = root / name
        _, statements, _, missing, _ = cov.analysis2(str(path))
        selected = touched_statements(path, statements, ranges)
        measured[name] = [selected, sorted(set(selected).intersection(missing))]
    Path(sys.argv[3]).write_text(json.dumps({"files": measured, "tests_run": result.testsRun}), encoding="utf-8")


if __name__ == "__main__":
    main()
