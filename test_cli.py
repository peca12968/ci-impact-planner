"""Black-box checks using Pillow to generate independent PNG inputs and inspect output."""
import json
import os
from pathlib import Path
import random
import subprocess
import tempfile
import unittest

from PIL import Image


ROOT = Path(__file__).resolve().parent


def run_components(points, width, height):
    # Group horizontal runs by overlap with the previous row, independently of Go's flood fill.
    groups = []
    for y in range(height):
        x = 0
        while x < width:
            if (x, y) not in points:
                x += 1
                continue
            left = x
            while x < width and (x, y) in points:
                x += 1
            run = {(col, y) for col in range(left, x)}
            above = {(col, y - 1) for col in range(left, x)}
            touching = [g for g in groups if g & above]
            groups = [g for g in groups if not g & above]
            groups.append(run.union(*touching))
    groups.sort(key=lambda g: (-len(g), min((y, x) for x, y in g)))
    return [{"pixels": len(g), "left": min(x for x, y in g), "top": min(y for x, y in g),
             "right": max(x for x, y in g) + 1, "bottom": max(y for x, y in g) + 1}
            for g in groups]


class ScreenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.exe = Path(cls.tmp.name) / ("frame-delta.exe" if os.name == "nt" else "frame-delta")
        subprocess.run(["go", "build", "-o", cls.exe, "."], cwd=ROOT, check=True)

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.a, self.b, self.out = [Path(tmp.name) / (n + ".png") for n in ("a", "b", "diff")]

    def cli(self, args, code):
        proc = subprocess.run([self.exe, *args], capture_output=True)
        self.assertEqual(proc.returncode, code, proc.stderr)
        if code == 2:
            self.assertFalse(proc.stdout)
            return
        return json.loads(proc.stdout)

    def test_browser_regression_and_budget_boundary(self):
        examples = ROOT / "examples"
        files = [examples / "baseline.png", examples / "candidate.png"]
        self.assertEqual(self.cli(files, 1)["changed_pixels"], 3210)
        flags = ["-ignore", "367,86,147,42", "-diff", self.out]
        result = self.cli([*flags, "-budget", "2351", *files], 1)
        self.assertEqual(result["ignored_pixels"], 6174)
        self.assertEqual(result["changed_pixels"], 2352)
        self.assertEqual(result["region_count"], 1)
        self.assertEqual(result["largest_regions"], [
            {"pixels": 2352, "left": 26, "top": 164, "right": 310, "bottom": 180}])
        self.assertTrue(self.cli([*flags, "-budget", "2352", *files], 0)["passed"])
        with Image.open(self.out) as actual, Image.open(examples / "difference.png") as expected:
            self.assertEqual(actual.convert("RGB").tobytes(), expected.convert("RGB").tobytes())

    def test_independent_run_grouping(self):
        rng = random.Random(4701)
        w, h = 25, 14
        Image.new("RGB", (w, h)).save(self.a)
        for n in range(48):
            with self.subTest(case=n):
                candidate = Image.new("RGB", (w, h))
                raw = {(x, y) for y in range(h) for x in range(w) if rng.random() < (n + 1) / 50}
                for xy in raw:
                    candidate.putpixel(xy, (0, 40, 0))
                candidate.save(self.b)
                masks = [(2, 1, 9, 7), (5, 3, 8, 2)]
                ignored = {(x, y) for l, t, mw, mh in masks for y in range(t, t+mh) for x in range(l, l+mw)}
                points = raw - ignored
                args = ["-tolerance", "39", "-diff", self.out]
                for rect in masks:
                    args.extend(["-ignore", ",".join(map(str, rect))])
                result = self.cli([*args, self.a, self.b], int(bool(points)))
                regions = run_components(points, w, h)
                self.assertEqual(result["largest_regions"], regions[:10])
                self.assertEqual(result["region_count"], len(regions))
                self.assertEqual((result["changed_pixels"], result["ignored_pixels"]), (len(points), len(ignored)))
                with Image.open(self.out) as rendered:
                    for y in range(h):
                        for x in range(w):
                            rgb = rendered.getpixel((x, y))[:3]
                            self.assertEqual(rgb == (190, 16, 94), (x, y) in points)
                            self.assertEqual(rgb == (173, 203, 222), (x, y) in ignored)

    def test_visible_color_and_exact_tolerance(self):
        a = Image.new("RGBA", (4, 1))
        b = Image.new("RGBA", (4, 1))
        a.putdata([(30, 20, 0, 0), (0, 0, 0, 128), (10, 10, 10, 255), (10, 10, 10, 255)])
        b.putdata([(10, 99, 0, 0), (127, 127, 127, 255), (13, 10, 10, 255), (10, 14, 10, 255)])
        a.save(self.a)
        b.save(self.b)
        self.assertEqual(self.cli(["-tolerance", "3", self.a, self.b], 1)["changed_pixels"], 1)

    def test_invalid_comparison_preserves_existing_files(self):
        Image.new("RGB", (6, 4)).save(self.a)
        Image.new("RGB", (4, 6)).save(self.b)
        self.out.write_bytes(b"prior output")
        self.cli(["-diff", self.out, self.a, self.b], 2)
        self.assertEqual(self.out.read_bytes(), b"prior output")
        before = self.a.read_bytes()
        self.cli(["-diff", self.a, self.a, self.a], 2)
        self.assertEqual(self.a.read_bytes(), before)
        for rect in ("-1,0,3,2", "1,0,0,1", "4,0,3,1", "oops"):
            self.cli(["-ignore", rect, self.a, self.a], 2)
