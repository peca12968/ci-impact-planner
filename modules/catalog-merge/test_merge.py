import itertools
import json
from pathlib import Path
import random
import tempfile
import unittest

from catalog_merge import MISSING, merge, read_json, validate_catalog
from demo import CATALOG, branches, checkout_demo, git, run_cli


class CatalogTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.repo = Path(temp.name)

    def test_real_checkout_merge(self):
        self.assertEqual(checkout_demo(self.repo), {
            "reviewed": ["/checkout/hint", "/checkout/pay"],
            "catalog": {"checkout": {"invoice": "電子發票", "pay": "確認並付款"},
                        "nav": {"back": "返回", "pickup": "自取"}}})
        self.assertEqual(len(git(self.repo, "ls-files", "-u").splitlines()), 3)
        self.assertIn(b"<<<<<<<", (self.repo / CATALOG).read_bytes())

    def test_auto_merge_from_git_subdirectory_and_existing_output_preserved(self):
        branches(self.repo, {"a": "A", "b": "B"}, {"a": "ours", "b": "B"}, {"a": "A", "b": "theirs"})
        directory = self.repo / "locales"
        result = run_cli(directory, "--output", "merged.json", catalog="zh-TW.json")
        self.assertEqual(result["catalog"], {"a": "ours", "b": "theirs"})
        output = directory / "merged.json"
        output.write_bytes(b"existing")
        run_cli(directory, "--output", "merged.json", code=2, catalog="zh-TW.json")
        self.assertEqual(output.read_bytes(), b"existing")

    def test_missing_stages_and_whole_file_deletion(self):
        addition = self.repo / "add"
        addition.mkdir()
        branches(addition, None, {"menu": {"tea": "茶"}}, {"menu": {"soup": "湯"}})
        self.assertEqual(run_cli(addition)["catalog"], {"menu": {"tea": "茶", "soup": "湯"}})
        branches(self.repo, {"a": "A"}, None, {"a": "new"})
        report = run_cli(self.repo, code=1)
        conflict, = report["conflicts"]
        self.assertEqual(conflict["path"], "")
        self.assertEqual(conflict["ours"], {"present": False})
        conflict["take"] = "ours"
        (self.repo / "review").write_text(json.dumps(report), encoding="utf-8")
        self.assertEqual(run_cli(self.repo, "--review", "review", "--output", "absent.json"), {"status": "deleted"})
        self.assertFalse((self.repo / "absent.json").exists())

    def test_escaped_paths_partial_review_and_stale_choices(self):
        base = {"/": {"~": "old"}, "shape": "leaf"}
        ours = {"/": {"~": "ours"}, "shape": {"nest": "one"}}
        theirs = {"/": {"~": "theirs"}, "shape": {"other": "two"}}
        report = merge(base, ours, theirs)
        self.assertEqual([c["path"] for c in report["conflicts"]], ["/~1/~0", "/shape"])
        report["conflicts"][0]["take"] = "custom"
        report["conflicts"][0]["text"] = ""
        partial = merge(base, ours, theirs, report)
        self.assertEqual(partial, report)
        partial["conflicts"][1]["take"] = "theirs"
        self.assertEqual(merge(base, ours, theirs, partial)["catalog"], {"/": {"~": ""}, "shape": {"other": "two"}})
        with self.assertRaisesRegex(ValueError, "stale"):
            merge(base, ours, {**theirs, "/": {"~": "updated"}}, partial)
        with self.assertRaisesRegex(ValueError, "no longer exists"):
            merge(base, ours, {**theirs, "shape": "leaf"}, partial)

    def test_all_leaf_transitions_in_mixed_catalogs(self):
        rng = random.Random(317)
        states = [MISSING, "", "一", "二"]
        triples = list(itertools.product(states, repeat=3))
        for run in range(32):
            rng.shuffle(triples)
            catalogs = [{}, {}, {}]
            expected, conflicts = {}, []
            for index, (b, o, t) in enumerate(triples):
                key = f"key{index:02}"
                for catalog, val in zip(catalogs, (b, o, t)):
                    if val is not MISSING:
                        catalog[key] = val
                if o != b and t != b and o != t:
                    conflicts.append("/" + key)
                    chosen = b  # reviewer chooses base for every contested entry
                else:
                    chosen = t if t != b else o
                if chosen is not MISSING:
                    expected[key] = chosen
            report = merge(*catalogs)
            self.assertEqual([c["path"] for c in report["conflicts"]], conflicts)
            for c in report["conflicts"]:
                c["take"] = "base"
            self.assertEqual(merge(*catalogs, report)["catalog"], expected)

    def test_reject_ambiguous_or_unsupported_catalogs(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            read_json(b'{"menu":{"tea":"one","tea":"two"}}')
        for value in ([], {"leaf": None}, {"array": ["a"]}, {"cost": 17}):
            with self.assertRaises(ValueError):
                validate_catalog(value)

    def test_stale_review_rejected_without_publishing_catalog(self):
        branches(self.repo, {"a": "base"}, {"a": "ours"}, {"a": "theirs"})
        before = git(self.repo, "ls-files", "-u")
        run_cli(self.repo, "--save-review", "review.json", code=1)
        path = self.repo / "review.json"
        report = json.loads(path.read_bytes())
        report["conflicts"][0].update(id="unrelated", take="ours")
        path.write_text(json.dumps(report), encoding="utf-8")
        run_cli(self.repo, "--review", "review.json", "--output", "result.json", code=2)
        self.assertFalse((self.repo / "result.json").exists())
        self.assertEqual(before, git(self.repo, "ls-files", "-u"))


if __name__ == "__main__":
    unittest.main()
