import itertools
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from jsonschema import Draft202012Validator

from contract_witness import compare


ROOT = Path(__file__).resolve().parent
OLD, NEW = [ROOT / "examples" / f"order-v{i}.json" for i in (1, 2)]


def closed(fields, required=()):
    return {"type": "object", "properties": fields, "required": list(required), "additionalProperties": False}


def cli(*args):
    return subprocess.run([sys.executable, ROOT / "contract_witness.py", *args],
                          capture_output=True, text=True, timeout=10)


class ContractTests(unittest.TestCase):
    def assert_witnesses(self, source, target, report):
        accepts = Draft202012Validator(source).is_valid
        rejects = Draft202012Validator(target).is_valid
        for finding in report["findings"]:
            self.assertTrue(accepts(finding["payload"]), finding)
            self.assertFalse(rejects(finding["payload"]), finding)

    def test_cli_checkout_request_and_response(self):
        old, new = [json.loads(p.read_text()) for p in (OLD, NEW)]
        for mode, paths, source, target in [
            ("request", ["/delivery/giftMessage", "/delivery/speed", "/quantity"], old, new),
            ("response", ["/delivery/tracking"], new, old),
        ]:
            result = cli(OLD, NEW, "--direction", mode)
            self.assertEqual(result.returncode, 1, result.stderr)
            report = json.loads(result.stdout)
            self.assertFalse(report["compatible"])
            self.assertEqual([f["path"] for f in report["findings"]], paths)
            self.assert_witnesses(source, target, report)
        result = cli(OLD, OLD)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"direction": "request", "compatible": True, "findings": []})

    def test_all_pairs_of_finite_nested_contracts(self):
        # Every possible source payload is in this finite universe. The reference
        # uses the published validator and never calls the production traversal.
        scalars = [{"type": "integer", "minimum": -1, "maximum": 1},
                   {"type": "integer", "minimum": 0, "maximum": 1},
                   {"type": "string", "enum": ["A"]}, {"type": "boolean"}]
        shapes = [closed({"packet": closed({"v": scalar}, inner)}, outer)
                  for scalar in scalars for inner in [(), ("v",)] for outer in [(), ("packet",)]]
        payloads = [{}, {"packet": {}}] + [{"packet": {"v": value}} for value in [-1, 0, 1, "A", True, False]]
        accepted = [{i for i, payload in enumerate(payloads) if Draft202012Validator(schema).is_valid(payload)}
                    for schema in shapes]
        for i, j in itertools.product(range(len(shapes)), repeat=2):
            with self.subTest(source=i, target=j):
                report = compare(shapes[i], shapes[j])
                self.assertEqual(report["compatible"], accepted[i] <= accepted[j])
                self.assert_witnesses(shapes[i], shapes[j], report)

    def test_unbounded_edges_and_unrestricted_strings(self):
        limit = 10**80
        for source, target, values in [
            ({"type": "integer"}, {"type": "integer", "minimum": -limit, "maximum": limit},
             [-limit - 1, limit + 1]),
            ({"type": "integer", "maximum": -30}, {"type": "integer", "minimum": 100}, [-30]),
            ({"type": "string"}, {"type": "string", "enum": ["", "x", "xx"]}, ["xxx"]),
            ({"type": "null"}, {"type": "boolean"}, [None]),
        ]:
            report = compare(source, target)
            self.assertEqual([f["payload"] for f in report["findings"]], values)
            self.assert_witnesses(source, target, report)

    def test_new_required_field_in_optional_parent_and_pointer_escaping(self):
        key = "a/b~c"
        source = closed({key: closed({})})
        target = closed({key: closed({"id": {"type": "null"}}, ["id"])})
        report = compare(source, target)
        self.assertEqual(report["findings"], [
            {"path": "/a~1b~0c/id", "reason": "now-required", "payload": {key: {}}}])
        self.assert_witnesses(source, target, report)

    def test_unsupported_or_invalid_schema_returns_no_verdict(self):
        invalid = [{"type": "object"}, {"type": "array"}, {"type": ["null", "string"]},
                   closed({"x": {"type": "integer", "minimum": True}}),
                   {"type": "integer", "minimum": 1, "maximum": 0},
                   {"type": "string", "pattern": "^yes$"}, {"type": "string", "enum": []},
                   closed({}, ["undeclared"]), {"type": "integer", "$schema": "other"}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid.json"
            for contents in [json.dumps(schema) for schema in invalid] + ['{"type":"null","type":"string"}', '{']:
                path.write_text(contents, encoding="utf-8")
                result = cli(OLD, path)
                self.assertEqual(result.returncode, 2, contents)
                self.assertFalse(result.stdout)
                self.assertIn("contract error", result.stderr)

    def test_all_bounded_array_pairs(self):
        item_types = [{"type": "integer", "minimum": 0, "maximum": 1},
                      {"type": "string", "enum": ["A"]}, {"type": "boolean"}]
        shapes = [{"type": "array", "items": item, "minItems": low, "maxItems": high}
                  for item in item_types for low in range(3) for high in range(low, 4)]
        universe = [list(values) for length in range(4)
                    for values in itertools.product([0, 1, "A", True, False], repeat=length)]
        accepted = []
        for schema in shapes:
            validate = Draft202012Validator(schema).is_valid
            accepted.append({i for i, value in enumerate(universe) if validate(value)})
        for i, j in itertools.product(range(len(shapes)), repeat=2):
            with self.subTest(source=i, target=j):
                report = compare(shapes[i], shapes[j])
                self.assertEqual(report["compatible"], accepted[i] <= accepted[j])
                self.assert_witnesses(shapes[i], shapes[j], report)

    def test_batch_request_cli_and_pointer(self):
        old, new = [ROOT / "examples" / f"batch-v{i}.json" for i in (1, 2)]
        result = cli(old, new)
        self.assertEqual(result.returncode, 1, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual([(f["path"], f["reason"], len(f["payload"]["lines"])) for f in report["findings"]],
                         [("/lines", "too-few-items", 1), ("/lines", "too-many-items", 3),
                          ("/lines/0/qty", "above-maximum", 2)])
        self.assertEqual(report["findings"][-1]["payload"], {"lines": [{"qty": 6}, {"qty": 1}]})
        self.assert_witnesses(json.loads(old.read_text()), json.loads(new.read_text()), report)
        self.assertEqual(cli(old, new, "--direction", "response").returncode, 0)
        limited = cli(old, new, "--max-array-items", "5")
        self.assertEqual(limited.returncode, 2)
        self.assertEqual(limited.stdout, "")

    def test_unbounded_nested_arrays_and_symbolic_lengths(self):
        huge = {"type": "array", "items": {"type": "null"}, "minItems": 10**80}
        self.assertTrue(compare(huge, huge)["compatible"])
        with self.assertRaisesRegex(ValueError, "max-array-items"):
            compare(huge, {"type": "null"})
        source = {"type": "array", "minItems": 2, "items": {
            "type": "array", "minItems": 2, "items": {"type": "integer"}}}
        target = {"type": "array", "items": {"type": "array", "items": {"type": "null"}}}
        result = compare(source, target, max_array_items=6)
        self.assertEqual(result["findings"][0]["path"], "/0/0")
        self.assert_witnesses(source, target, result)
        with self.assertRaisesRegex(ValueError, "max-array-items"):
            compare(source, target, max_array_items=5)
        empty = {"type": "array", "maxItems": 0, "items": {"type": "boolean"}}
        self.assertTrue(compare(empty, target, max_array_items=0)["compatible"])
        for extra in [{"maxItems": True}, {"minItems": -1}, {"minItems": 3, "maxItems": 2}, {"uniqueItems": True}]:
            with self.assertRaises(ValueError):
                compare({**empty, **extra}, target)


if __name__ == "__main__":
    unittest.main()
