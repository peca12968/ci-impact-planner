import csv
from io import StringIO
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
import zipfile

from demo import build_demo


class WheelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temp = TemporaryDirectory()
        cls.addClassCleanup(temp.cleanup)
        cls.root = Path(temp.name)
        cls.builds = build_demo(cls.root / "demo")
        cls.base = cls.builds["baseline"]

    def cli(self, path, status):
        result = subprocess.run([sys.executable, Path(__file__).with_name("compare.py"), self.base, path],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, status, result.stderr)
        if status == 2:
            self.assertEqual(result.stdout, "")
            return result.stderr
        return json.loads(result.stdout)

    def rewrite(self, name, transform):
        path = self.root / name
        with zipfile.ZipFile(self.base) as original, zipfile.ZipFile(path, "w") as out:
            for member in original.infolist():
                value = transform(member.filename, original.read(member))
                if value is not None:
                    out.writestr(member, value)
        return path

    def test_fixed_clock_new_clock_and_source_change(self):
        self.assertEqual(self.cli(self.builds["repeat"], 0)["classification"], "identical")
        clock = self.cli(self.builds["new-clock"], 1)
        self.assertEqual(clock["classification"], "archive_only")
        self.assertTrue(clock["metadata_changes"])
        for fields in clock["metadata_changes"].values():
            self.assertEqual(set(fields), {"timestamp"})
            self.assertNotEqual(fields["timestamp"]["before"], fields["timestamp"]["after"])
        code = self.cli(self.builds["new-code"], 1)
        self.assertEqual(code["classification"], "member_bytes_changed")
        self.assertEqual(code["files"]["changed"], ["parcel_count-1.0.dist-info/RECORD", "parcel_count.py"])

    def test_record_reordered_or_invalid(self):
        def manifest(data, mode):
            rows = list(csv.reader(StringIO(data.decode())))
            if mode == "reorder":
                rows.reverse()
            elif mode == "missing":
                rows = [row for row in rows if row[0] != "parcel_count.py"]
            elif mode == "size":
                next(row for row in rows if row[0] == "parcel_count.py")[2] = "1"
            stream = StringIO()
            csv.writer(stream).writerows(rows)
            return stream.getvalue().encode()

        for mode, status in [("reorder", 1), ("missing", 2), ("size", 2)]:
            wheel = self.rewrite(mode, lambda n, d: manifest(d, mode) if n.endswith("/RECORD") else d)
            result = self.cli(wheel, status)
            if mode == "reorder":
                self.assertEqual(result["classification"], "record_only")
            else:
                self.assertIn("RECORD", result)
        bad = self.rewrite("stale", lambda n, d: d.replace(b"12", b"13") if n == "parcel_count.py" else d)
        self.assertIn("digest mismatch for parcel_count.py", self.cli(bad, 2))

    def test_archive_metadata_without_file_edits(self):
        path = self.root / "mode-and-order"
        with zipfile.ZipFile(self.base) as source, zipfile.ZipFile(path, "w") as out:
            out.comment = b"nightly"
            for entry in reversed(source.infolist()):
                data = source.read(entry)
                if entry.filename == "parcel_count.py":
                    entry.external_attr ^= 0o100 << 16
                out.writestr(entry, data)
        result = self.cli(path, 1)
        self.assertTrue(result["order_changed"] and result["archive_comment_changed"])
        self.assertIn("external_attributes", result["metadata_changes"]["parcel_count.py"])
        self.assertEqual(result["classification"], "archive_only")
