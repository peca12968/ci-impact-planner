from itertools import product
from random import Random
import unittest

from planner import plan, TestFile as SuiteFile


def loads(groups, rows, setup):
    return [sum(rows[p].duration_ms for p in group) + sum(setup[k] for k in {rows[p].fixture for p in group})
            for group in groups]


class PlanTests(unittest.TestCase):
    def test_small_instances_against_all_assignments(self):
        rng = Random(457)
        for case in range(160):
            count = rng.randint(1, 3)
            setup = {name: rng.randrange(12) for name in "ABC"}
            files = [SuiteFile(str(i), rng.randrange(15), rng.choice("ABC")) for i in range(rng.randrange(7))]
            rows = {f.path: f for f in files}
            result = plan(files, setup, count)
            groups = [w["paths"] for w in result["workers"]]
            self.assertCountEqual([p for g in groups for p in g], rows.keys())
            self.assertEqual(len(groups), count)
            actual = loads(groups, rows, setup)
            self.assertEqual(actual, [w["finish_ms"] for w in result["workers"]])
            optimum = min(max(loads([[f.path for f, lane in zip(files, assignment) if lane == w]
                                     for w in range(count)], rows, setup))
                          for assignment in product(range(count), repeat=len(files)))
            baseline = max(loads([[f.path for f in files[i::count]] for i in range(count)], rows, setup))
            self.assertEqual(result["baseline_ms"], baseline)
            self.assertEqual(result["estimated_ms"], max(actual))
            self.assertLessEqual(result["lower_bound_ms"], optimum, case)
            self.assertLessEqual(optimum, max(actual), case)
            self.assertLessEqual(max(actual), baseline, case)

    def test_zero_work_extra_workers_and_reused_environment(self):
        self.assertEqual(plan([], {}, 3)["estimated_ms"], 0)
        files = [SuiteFile("a", 1, "db"), SuiteFile("b", 2, "db")]
        one = plan(files, {"db": 9}, 1)
        self.assertEqual((one["estimated_ms"], one["workers"][0]["setup_ms"]), (12, 9))
        extra = plan(files[:1], {"db": 9}, 3)
        self.assertEqual([w["finish_ms"] for w in extra["workers"]], [10, 0, 0])

    def test_example_optimum_and_a_heuristic_counterexample(self):
        setup = {"database": 30, "browser": 30}
        files = [SuiteFile(name, duration, fixture) for name, duration, fixture in [
            ("orders", 8, "database"), ("receipts", 6, "database"),
            ("home", 7, "browser"), ("checkout", 5, "browser")]]
        rows = {f.path: f for f in files}
        opt = min(max(loads([[f.path for f, a in zip(files, assignment) if a == w] for w in range(2)], rows, setup))
                  for assignment in product(range(2), repeat=4))
        self.assertEqual(plan(files, setup, 2)["estimated_ms"], opt)
        self.assertEqual(opt, 44)
        counterexample = [SuiteFile(str(i), duration, "none") for i, duration in enumerate([3, 3, 2, 2, 2])]
        r = plan(counterexample, {"none": 0}, 2)
        self.assertEqual((r["lower_bound_ms"], r["estimated_ms"]), (6, 7))

    def test_invalid_inputs(self):
        example = SuiteFile("a", 2, "db")
        for files, setup, workers in [([example, example], {"db": 2}, 2), ([example], {"db": -1}, 2),
                                      ([example], {}, 2), ([example], {"db": 0}, 0)]:
            with self.assertRaises(ValueError):
                plan(files, setup, workers)
