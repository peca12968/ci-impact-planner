from fractions import Fraction
from itertools import combinations
from math import comb
import random
import unittest

from audit import audit


def exposure(person, variant, stratum, event=None):
    return {"event_id": event or person, "user": person, "variant": variant, "stratum": stratum}


class AuditTests(unittest.TestCase):
    def test_balanced_aggregate_hides_two_mismatches(self):
        plan = {"strata": ["app", "web"], "treatment_probability": 0.5}
        events = []
        for name, k in [("app", 1), ("web", 15)]:
            for i in range(16):
                events.append(exposure(f"{name}-{i}", "treatment" if i < k else "control", name))
        events.extend([events[0], {**events[0], "event_id": "return-visit"}])
        result = audit(plan, events)
        self.assertEqual(result, audit(plan, reversed(events)))
        self.assertEqual((result["users_tested"], result["unique_events"], result["duplicate_rows"]), (32, 33, 1))
        self.assertEqual(result["events_by_variant"], {"control": 16, "treatment": 17})
        overall, app, web = result["tests"]
        self.assertEqual((overall["control"], overall["treatment"], overall["holm_p"]), (16, 16, 1))
        raw = Fraction(2 * (comb(16, 0) + comb(16, 1)), 2**16)
        for test in (app, web):
            self.assertAlmostEqual(test["p_value"], float(raw))
            self.assertAlmostEqual(test["holm_p"], float(3 * raw))
            self.assertTrue(test["flagged"])

    def test_conflicting_users_and_empty_strata(self):
        plan = {"strata": ["app", "web"], "treatment_probability": 0.25}
        events = [exposure("a","control","app"), exposure("a","treatment","app","dup-assignment"),
                  exposure("b","control","app"), exposure("b","control","web","changed-segment"),
                  exposure("c","control","app"), exposure("c","treatment","web","both"),
                  exposure("d","treatment","app")]
        result = audit(plan, events)
        self.assertEqual(result["excluded_users"], {"variant": 1, "stratum": 1, "both": 1})
        self.assertEqual(result["users_tested"], 1)
        self.assertIsNone(result["tests"][2]["p_value"])
        with self.assertRaisesRegex(ValueError, "conflicting copies"):
            audit(plan, [events[0], {**events[0], "user":"different"}])

    def test_numeric_results_against_exact_probability_and_intersection_tests(self):
        rng = random.Random(12968)
        for trial in range(60):
            ratio = [Fraction(1, 4), Fraction(1, 2), Fraction(3, 4)][trial % 3]
            names = ["app", "web", "tablet"]
            events = []
            for name in names:
                for i in range(rng.randrange(8)):
                    variant = rng.choice(["control", "treatment"])
                    events.append(exposure(f"{name}-{i}", variant, name))
            findings = audit({"strata": names, "treatment_probability": float(ratio)}, events)["tests"]
            probabilities = []
            for test in findings:
                n, k = test["control"] + test["treatment"], test["treatment"]
                if not n:
                    probabilities.append(Fraction(1))
                    self.assertIsNone(test["p_value"])
                    self.assertIsNone(test["holm_p"])
                    continue
                masses = [comb(n, i) * ratio**i * (1-ratio)**(n-i) for i in range(n+1)]
                p = sum(mass for mass in masses if mass <= masses[k])
                probabilities.append(p)
                self.assertAlmostEqual(test["p_value"], float(p))
            for i, test in enumerate(findings):
                if test["p_value"] is None:
                    continue
                # Enumerate every intersection containing i instead of reusing the
                # production step-down implementation.
                others = [j for j in range(len(findings)) if j != i]
                intersections = [(i, *rest) for count in range(len(others)+1)
                                 for rest in combinations(others, count)]
                adjusted = min(1, max(len(group) * min(probabilities[j] for j in group) for group in intersections))
                self.assertAlmostEqual(test["holm_p"], float(adjusted))
                self.assertEqual(test["flagged"], adjusted <= Fraction(1, 20))
