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

    def test_slider_zone_catches_a_regression_within_page_budget(self):
        files = [ROOT / "examples" / n for n in ("baseline.png", "candidate.png")]
        flags = ["-budget", "3500"]
        self.assertTrue(self.cli([*flags, *files], 0)["passed"])
        result = self.cli([*flags, "-zone", "slider,26,164,284,16,0",
                           "-zone", "total,367,86,147,42,858", *files], 1)
        self.assertTrue(result["global_passed"])
        self.assertFalse(result["passed"])
        self.assertEqual(result["zones"], [
            {"name": "slider", "budget": 0, "compared_pixels": 4544, "changed_pixels": 2352, "passed": False},
            {"name": "total", "budget": 858, "compared_pixels": 6174, "changed_pixels": 858, "passed": True}])
        report = self.cli(["-budget", "3209", "-zone", "slider,26,164,284,16,2352", *files], 1)
        self.assertFalse(report["global_passed"])
        self.assertTrue(report["zones"][0]["passed"])
        report = self.cli(["-budget", "3210", "-zone", "slider,26,164,284,16,2352",
                           "-zone", "total,367,86,147,42,858", *files], 0)
        self.assertTrue(report["passed"])

    def test_overlapping_zone_counts_against_direct_pixel_sets(self):
        rng = random.Random(6807)
        w, h = 19, 13
        Image.new("RGB", (w, h)).save(self.a)
        masks = {(x, y) for x in range(4, 11) for y in range(2, 6)}
        for case in range(40):
            candidate = Image.new("RGB", (w, h))
            changed = set()
            for y in range(h):
                for x in range(w):
                    green = rng.randrange(4)
                    candidate.putpixel((x, y), (0, green, 0))
                    if green > 1:
                        changed.add((x, y))
            candidate.save(self.b)
            flags = ["-ignore", "4,2,7,4", "-tolerance", "1", "-budget", str(w*h)]
            expected = []
            for i in range(8):
                if i == 0:
                    x, y, right, bottom = 4, 2, 11, 6  # Completely masked.
                elif i == 1:
                    x, y, right, bottom = 0, 0, w, h
                else:
                    x, y = rng.randrange(w), rng.randrange(h)
                    right, bottom = rng.randint(x+1, w), rng.randint(y+1, h)
                area = {(col, row) for col in range(x, right) for row in range(y, bottom)} - masks
                count = len(area & changed)
                budget = max(0, count + rng.choice([-1, 0, 1]))
                flags.extend(["-zone", f"z{i},{x},{y},{right-x},{bottom-y},{budget}"])
                expected.append({"name": f"z{i}", "budget": budget, "changed_pixels": count,
                                 "compared_pixels": len(area), "passed": bool(area) and count <= budget})
            with self.subTest(case=case):
                report = self.cli([*flags, self.a, self.b], 1)
                self.assertEqual(report["zones"], expected)
                self.assertEqual(report["changed_pixels"], len(changed - masks))
                self.assertTrue(report["global_passed"])
                self.assertFalse(report["passed"])

    def test_invalid_zones_preserve_output_and_equal_budgets_pass(self):
        Image.new("RGB", (5, 4)).save(self.a)
        self.out.write_bytes(b"prior output")
        valid = ["-zone", "panel,0,0,5,4,0"]
        for invalid in ("panel,0,0,1,1,1", "a,0,1,5,4,0", ",0,0,1,1,0", "extra,0,0,1,1,-1",
                        "zero,0,0,0,1,5", "broken,0"):
            self.cli(["-diff", self.out, *valid, "-zone", invalid, self.a, self.a], 2)
            self.assertEqual(self.out.read_bytes(), b"prior output")
        self.assertTrue(self.cli([*valid, self.a, self.a], 0)["zones"][0]["passed"])

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
