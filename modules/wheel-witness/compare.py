"""Compare wheel build artifacts after verifying their RECORD entries."""
import argparse
import base64
import csv
from dataclasses import dataclass
import hashlib
from io import TextIOWrapper
import json
from pathlib import Path
import re
import zipfile
import zlib


SUPPORTED = {"sha256", "sha384", "sha512", "sha3_256", "sha3_384", "sha3_512", "blake2b", "blake2s"}


@dataclass
class Wheel:
    sha256: str
    record: str
    hashes: dict
    metadata: dict
    order: list
    comment: bytes


def inspect(path):
    with path.open("rb") as raw:
        digest = hashlib.file_digest(raw, "sha256").hexdigest()
        with zipfile.ZipFile(raw) as archive:
            items = archive.infolist()
            names = [item.filename for item in items]
            if len(set(names)) != len(names):
                raise ValueError(f"{path}: duplicate archive member")
            files = {item.filename: item for item in items if not item.is_dir()}
            records = [name for name in files if re.fullmatch(r"[^/]+\.dist-info/RECORD", name)]
            if len(records) != 1:
                raise ValueError(f"{path}: expected one top-level .dist-info/RECORD")
            record = records[0]
            meta = record.rsplit("/", 1)[0]
            if not {meta + "/WHEEL", meta + "/METADATA"} <= files.keys():
                raise ValueError(f"{path}: missing WHEEL or METADATA")
            expected = {}
            with archive.open(record) as stream, TextIOWrapper(stream, encoding="utf-8", newline="") as text:
                for line, row in enumerate(csv.reader(text, strict=True), 1):
                    if len(row) != 3 or row[0] in expected:
                        raise ValueError(f"{path}: invalid or duplicate RECORD row {line}")
                    expected[row[0]] = (row[1], row[2])
            signatures = {record + ".jws", record + ".p7s"}
            if expected.keys() != files.keys() - signatures or expected.get(record) != ("", ""):
                raise ValueError(f"{path}: RECORD inventory or self-entry mismatch")
            hashes = {}
            for name, item in files.items():
                algorithm = "sha256"
                if name != record and name not in signatures:
                    field, size = expected[name]
                    algorithm, _, value = field.partition("=")
                    if algorithm not in SUPPORTED:
                        raise ValueError(f"{path}: unsupported hash for {name}")
                    if size and (not re.fullmatch("[0-9]+", size) or int(size) != item.file_size):
                        raise ValueError(f"{path}: RECORD size mismatch for {name}")
                strong = hashlib.sha256()
                verifier = strong if algorithm == "sha256" else hashlib.new(algorithm)
                with archive.open(item) as stream:
                    while block := stream.read(1024 * 1024):
                        strong.update(block)
                        if verifier is not strong:
                            verifier.update(block)
                if name != record and name not in signatures:
                    actual = base64.urlsafe_b64encode(verifier.digest()).rstrip(b"=").decode("ascii")
                    if value != actual:
                        raise ValueError(f"{path}: RECORD digest mismatch for {name}")
                hashes[name] = strong.hexdigest()
            metadata = {i.filename: {"timestamp": i.date_time, "compression": i.compress_type,
                                     "creator_os": i.create_system, "external_attributes": i.external_attr,
                                     "extra_sha256": hashlib.sha256(i.extra).hexdigest(),
                                     "comment_sha256": hashlib.sha256(i.comment).hexdigest()}
                        for i in items}
            return Wheel(digest, record, hashes, metadata, names, archive.comment)


def compare(left, right):
    a, b = inspect(left), inspect(right)
    common = a.hashes.keys() & b.hashes.keys()
    files = {"added": sorted(b.hashes.keys() - a.hashes.keys()), "removed": sorted(a.hashes.keys() - b.hashes.keys()),
             "changed": sorted(k for k in common if a.hashes[k] != b.hashes[k])}
    changes = {}
    for name in sorted(a.metadata.keys() & b.metadata.keys()):
        fields = {k: {"before": old, "after": b.metadata[name][k]} for k, old in a.metadata[name].items()
                  if old != b.metadata[name][k]}
        if fields:
            changes[name] = fields
    classification = "member_bytes_changed"
    if a.sha256 == b.sha256:
        classification = "identical"
    elif not any(files.values()):
        classification = "archive_only"
    elif not files["added"] and not files["removed"] and a.record == b.record and files["changed"] == [a.record]:
        classification = "record_only"
    common_members = set(a.order) & set(b.order)
    order_changed = [n for n in a.order if n in common_members] != [n for n in b.order if n in common_members]
    return {"identical": a.sha256 == b.sha256, "classification": classification, "sha256": [a.sha256, b.sha256],
            "files": files, "order_changed": order_changed, "metadata_changes": changes,
            "archive_comment_changed": a.comment != b.comment}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("left", type=Path)
    parser.add_argument("right", type=Path)
    args = parser.parse_args()
    try:
        result = compare(args.left, args.right)
    except (OSError, EOFError, ValueError, RuntimeError, csv.Error, zipfile.BadZipFile, zlib.error) as error:
        parser.exit(2, f"{error}\n")
    print(json.dumps(result, indent=2))
    return int(not result["identical"])


if __name__ == "__main__":
    raise SystemExit(main())
