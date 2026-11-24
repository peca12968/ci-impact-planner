from pathlib import Path
import tempfile
import unittest

from demo import BOUNDARY, TEST, demo, git, prepare, run, save, snapshot


class PatchTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.repo = Path(tmp.name)

    def test_shipping_demo(self):
        result = demo(self.repo)
        a, b = result["before"], result["after"]
        self.assertEqual((a["tests_run"], a["covered"], a["statements"], a["passed"]), (1, 2, 3, False))
        self.assertEqual(a["files"], [{"path": "shop/shipping.py", "statements": [5, 6, 7], "missing": [7]}])
        self.assertEqual((b["tests_run"], b["covered"], b["statements"], b["passed"]), (2, 3, 3, True))
        self.assertFalse(b["files"][0]["missing"])

    def test_reviewed_tree_and_merge_base_even_when_working_copy_is_dirty(self):
        base = prepare(self.repo)
        feature = git(self.repo, "rev-parse", "HEAD").decode().strip()
        git(self.repo, "switch", "-q", "main")
        save(self.repo, "shop/unrelated.py", "other = 2\n")
        snapshot(self.repo, "Advance target branch")
        save(self.repo, "tests/test_shipping.py", TEST + BOUNDARY)
        save(self.repo, "shop/shipping.py", "raise RuntimeError('local draft')\n")
        a = run(self.repo, "main", "--head", feature, "--minimum", "66.66", code=0)
        self.assertEqual((a["head"], a["merge_base"], a["covered"], a["statements"]), (feature, base, 2, 3))
        self.assertEqual([f["path"] for f in a["files"]], ["shop/shipping.py"])
        run(self.repo, "main", "--head", feature, "--minimum", "66.67", code=1)
        self.assertEqual((self.repo / "shop/shipping.py").read_text(), "raise RuntimeError('local draft')\n")
        self.assertEqual(git(self.repo, "worktree", "list", "--porcelain").count(b"worktree "), 1)

    def test_modified_rename_and_unimported_new_source(self):
        prepare(self.repo)
        old = "shop/old rates.py"
        new = "shop/new rates.py"
        save(self.repo, old, "".join(f"rate_{i} = {i}\n" for i in range(20)))
        base = snapshot(self.repo, "Add reference rates")
        git(self.repo, "mv", old, new)
        path = self.repo / new
        path.write_text(path.read_text().replace("rate_12 = 12", "rate_12 = 18"), encoding="utf-8")
        save(self.repo, "shop/extra.py", "# new policy\n\nactive = True\nignored = 0  # pragma: no cover\n")
        snapshot(self.repo, "Rename and change a rate, add a new module")
        result = run(self.repo, base, code=1)
        self.assertEqual(result["files"], [
            {"path": "shop/extra.py", "statements": [3], "missing": [3]},
            {"path": new, "statements": [13], "missing": [13]}])

    def test_deletion_rename_and_comments_do_not_create_statements(self):
        prepare(self.repo)
        save(self.repo, "shop/dead.py", "old = True\n")
        save(self.repo, "shop/rename.py", "preserved = True\n")
        base = snapshot(self.repo, "Set up old paths")
        git(self.repo, "rm", "-q", "shop/dead.py")
        git(self.repo, "mv", "shop/rename.py", "shop/renamed file.py")
        save(self.repo, "shop/note.py", "# release note\n")
        snapshot(self.repo, "Move old code and document the release")
        report = run(self.repo, base, code=0)
        self.assertEqual((report["statements"], report["covered"], report["percent"]), (0, 0, None))
        self.assertEqual(report["files"], [{"path": "shop/note.py", "statements": [], "missing": []}])

    def test_failing_or_empty_suite_and_invalid_ref(self):
        base = prepare(self.repo)
        for text in ("", TEST.replace("]), 5", "]), 99")):
            save(self.repo, "tests/test_shipping.py", text)
            snapshot(self.repo, "Change suite")
            self.assertIsNone(run(self.repo, base, code=2))
            self.assertEqual(git(self.repo, "worktree", "list", "--porcelain").count(b"worktree "), 1)
        self.assertIsNone(run(self.repo, "missing-ref", code=2))

    def test_changed_continuation_counts_but_comment_inside_call_does_not(self):
        prepare(self.repo)
        name = "shop/limits.py"
        original = "minimum = max(\n    1,\n    2,\n)\nmaximum = max(\n    # old comment\n    9, 10\n)\n"
        save(self.repo, name, original)
        base = snapshot(self.repo, "Add multiline expressions")
        save(self.repo, name, original.replace("    2,", "    3,").replace("old comment", "new comment"))
        snapshot(self.repo, "Change one argument and one comment")
        report = run(self.repo, base, code=1)
        self.assertEqual(report["files"], [{"path": name, "statements": [1], "missing": [1]}])


if __name__ == "__main__":
    unittest.main()
