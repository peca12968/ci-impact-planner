"""Resolve JSON translation catalogs using the three versions stored in Git's index."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import NamedTemporaryFile


MISSING = object()


def unique_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError(f"duplicate JSON key {key!r}")
        obj[key] = value
    return obj


def read_json(data):
    return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique_object)


def validate_catalog(value, path=""):
    if not isinstance(value, dict):
        raise ValueError(f"{path or 'catalog root'} must be an object")
    for key, item in value.items():
        child = pointer(path, key)
        if isinstance(item, dict):
            validate_catalog(item, child)
        elif not isinstance(item, str):
            raise ValueError(f"{child} must be a translation string or object")


def pointer(path, key):
    return path + "/" + key.replace("~", "~0").replace("/", "~1")


def git(*args):
    process = subprocess.run(["git", "--literal-pathspecs", *args], capture_output=True)
    if process.returncode:
        raise ValueError(process.stderr.decode("utf-8", errors="replace").strip() or "Git failed")
    return process.stdout


def read_stages(path):
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("specify a file relative to the current repository directory")
    name = path.as_posix()
    rows = git("ls-files", "-u", "-z", "--", name)
    stages = [MISSING] * 3
    for row in rows.split(b"\0"):
        if not row:
            continue
        header, filename = row.split(b"\t", 1)
        if filename != os.fsencode(name):
            raise ValueError("specify one conflicted catalog file")
        mode, oid, stage = header.decode("ascii").split()
        if mode not in ("100644", "100755"):
            raise ValueError("catalog stages must be regular files")
        catalog = read_json(git("cat-file", "blob", oid))
        validate_catalog(catalog)
        stages[int(stage)-1] = catalog
    if not rows:
        raise ValueError("the specified file has no unresolved Git stages")
    return stages


def snapshot(value):
    return {"present": False} if value is MISSING else {"present": True, "value": value}


def decisions(review):
    if not isinstance(review, dict) or not isinstance(review.get("conflicts"), list):
        raise ValueError("review must contain a conflicts array")
    items = {}
    for item in review["conflicts"]:
        if not isinstance(item, dict):
            raise ValueError("invalid conflict entry")
        path, stamp, take = (item.get(k) for k in ("path", "id", "take"))
        if not isinstance(path, str) or not isinstance(stamp, str) or path in items:
            raise ValueError("invalid or repeated conflict identity")
        if take not in (None, "base", "ours", "theirs", "custom"):
            raise ValueError(f"unknown choice for {path!r}")
        if take == "custom" and not isinstance(item.get("text"), str):
            raise ValueError("a custom translation requires a text string")
        items[path] = (stamp, take, item.get("text"))
    return items


def merge(base, ours, theirs, review=None):
    choices = decisions(review) if review is not None else {}
    conflicts = []

    def visit(path, b, o, t):
        if o == t or t == b:
            return o
        if o == b:
            return t
        if isinstance(o, dict) and isinstance(t, dict) and (b is MISSING or isinstance(b, dict)):
            original = {} if b is MISSING else b
            merged = {}
            for key in sorted(original.keys() | o.keys() | t.keys()):
                val = visit(pointer(path, key), original.get(key, MISSING),
                            o.get(key, MISSING), t.get(key, MISSING))
                if val is not MISSING:
                    merged[key] = val
            return merged

        item = {"path": path, "base": snapshot(b), "ours": snapshot(o), "theirs": snapshot(t)}
        encoded = json.dumps(item, sort_keys=True, separators=(",", ":")).encode("ascii")
        stamp = hashlib.sha256(encoded).hexdigest()
        entry = {**item, "id": stamp, "take": None}
        conflicts.append(entry)
        if path in choices:
            expected, take, text = choices.pop(path)
            if expected != stamp:
                raise ValueError(f"stale decision for {path!r}")
            entry["take"] = take
            if take == "custom":
                if path == "":
                    raise ValueError("a catalog root must be an object")
                entry["text"] = text
                return text
            if take is not None:
                return {"base": b, "ours": o, "theirs": t}[take]
        return MISSING

    result = visit("", base, ours, theirs)
    if choices:
        raise ValueError(f"review includes a conflict that no longer exists: {next(iter(choices))!r}")
    if any(item["take"] is None for item in conflicts):
        return {"status": "conflict", "conflicts": conflicts}
    if result is MISSING:
        return {"status": "deleted"}
    return {"status": "merged", "catalog": result}


def pretty(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def publish_new(path, data):
    # Linking a completed sibling file publishes it atomically and refuses existing names.
    temp = None
    try:
        with NamedTemporaryFile(dir=path.parent, delete=False) as out:
            temp = Path(out.name)
            out.write(data)
        os.link(temp, path)
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("--review", type=Path, help="apply choices from a saved conflict report")
    parser.add_argument("--save-review", type=Path, help="save outstanding conflicts to a new UTF-8 JSON file")
    parser.add_argument("--output", type=Path, help="publish merged catalog under a new filename")
    args = parser.parse_args()
    try:
        stages = read_stages(args.catalog)
        review = read_json(args.review.read_bytes()) if args.review else None
        if args.review and review is None:
            raise ValueError("review must contain a conflicts array")
        result = merge(*stages, review=review)
        target = None
        if result["status"] == "merged":
            target = args.output
        elif result["status"] == "conflict":
            target = args.save_review
        if target:
            if target.resolve() == args.catalog.resolve():
                raise ValueError("choose a new output path separate from the conflicted catalog")
            publish_new(target, pretty(result.get("catalog", result)))
        sys.stdout.buffer.write(pretty(result))
    except (ValueError, OSError, RecursionError) as error:
        parser.exit(2, f"{parser.prog}: {error}\n")
    return int(result["status"] == "conflict")


if __name__ == "__main__":
    raise SystemExit(main())
