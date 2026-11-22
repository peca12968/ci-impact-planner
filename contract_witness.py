"""Construct payloads that one revision accepts and the other rejects."""
import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import sys


DIALECT = "https://json-schema.org/draft/2020-12/schema"
KEYWORDS = {
    "object": {"properties", "required", "additionalProperties"},
    "array": {"items", "minItems", "maxItems"},
    "string": {"enum"},
    "integer": {"minimum", "maximum"},
    "boolean": set(),
    "null": set(),
}


def pointer(parent, key):
    return parent + "/" + key.replace("~", "~0").replace("/", "~1")


def validate(schema, path=""):
    def require(condition, message):
        if not condition:
            raise ValueError(f"{path or '<root>'}: {message}")

    require(isinstance(schema, dict), "expected a schema object")
    kind = schema.get("type")
    require(isinstance(kind, str) and kind in KEYWORDS, "unsupported or missing type")
    allowed = KEYWORDS[kind] | {"type", "title", "description"}
    if not path:
        allowed.add("$schema")
        require(schema.get("$schema", DIALECT) == DIALECT, "unsupported schema dialect")
    unknown = sorted(schema.keys() - allowed)
    require(not unknown, f"unsupported keywords: {unknown}")
    for label in ("title", "description"):
        require(isinstance(schema.get(label, ""), str), f"{label} must be a string")
    if kind == "object":
        require(schema.get("additionalProperties") is False, "object must set additionalProperties to false")
        fields = schema.get("properties", {})
        required = schema.get("required", [])
        require(isinstance(fields, dict), "properties must be an object")
        require(isinstance(required, list) and all(isinstance(key, str) for key in required),
                "required must be a string list")
        require(len(set(required)) == len(required) and set(required) <= fields.keys(),
                "required names must be unique and declared")
        for key, child in fields.items():
            validate(child, pointer(path + "/properties", key))
    elif kind == "array":
        require(isinstance(schema.get("items"), dict), "array needs a single items schema")
        for key in ("minItems", "maxItems"):
            require(key not in schema or type(schema[key]) is int and schema[key] >= 0,
                    f"{key} must be a nonnegative integer literal")
        require("maxItems" not in schema or schema.get("minItems", 0) <= schema["maxItems"],
                "empty array length interval")
        validate(schema["items"], path + "/items")
    elif kind == "integer":
        for key in ("minimum", "maximum"):
            require(key not in schema or type(schema[key]) is int, f"{key} must be an integer literal")
        if "minimum" in schema and "maximum" in schema:
            require(schema["minimum"] <= schema["maximum"], "empty interval")
    elif kind == "string" and "enum" in schema:
        values = schema["enum"]
        require(isinstance(values, list) and values and all(isinstance(v, str) for v in values),
                "enum must be a nonempty string list")
        require(len(set(values)) == len(values), "enum contains duplicates")


def clamp(value, schema):
    if "minimum" in schema:
        value = max(value, schema["minimum"])
    if "maximum" in schema:
        value = min(value, schema["maximum"])
    return value


@dataclass(frozen=True)
class ArrayWitness:
    length: int
    first: object
    rest: object


def array_example(schema, length):
    item = example(schema["items"]) if length else None
    return ArrayWitness(length, item, item)


def example(schema):
    match schema["type"]:
        case "object":
            return {key: example(schema["properties"][key]) for key in sorted(schema.get("required", []))}
        case "array":
            return array_example(schema, schema.get("minItems", 0))
        case "string":
            return min(schema.get("enum", [""]))
        case "integer":
            return clamp(0, schema)
        case "boolean":
            return False
        case "null":
            return None


def differences(source, target, path=""):
    """Yield (instance pointer, rule, source-valid value) for each restriction."""
    kind = source["type"]
    if kind != target["type"]:
        yield path, "type-changed", example(source)
    elif kind == "object":
        fields = source.get("properties", {})
        receivers = target.get("properties", {})
        base = example(source)
        for key in sorted(set(target.get("required", [])) - set(source.get("required", []))):
            yield pointer(path, key), "now-required", base
        for key, child in sorted(fields.items()):
            location = pointer(path, key)
            if key not in receivers:
                yield location, "property-rejected", {**base, key: example(child)}
            else:
                for where, reason, value in differences(child, receivers[key], location):
                    yield where, reason, {**base, key: value}
    elif kind == "array":
        minimum, maximum = source.get("minItems", 0), source.get("maxItems")
        lower, upper = target.get("minItems", 0), target.get("maxItems")
        if minimum < lower:
            yield path, "too-few-items", array_example(source, minimum)
        if upper is not None and (maximum is None or maximum > upper):
            yield path, "too-many-items", array_example(source, max(minimum, upper + 1))
        length = max(1, minimum, lower)
        if (maximum is None or length <= maximum) and (upper is None or length <= upper):
            for where, reason, first in differences(source["items"], target["items"], path + "/0"):
                yield where, reason, ArrayWitness(length, first, example(source["items"]))
    elif kind == "integer":
        if "minimum" in target:
            candidate = clamp(target["minimum"] - 1, source)
            if candidate < target["minimum"]:
                yield path, "below-minimum", candidate
        if "maximum" in target:
            candidate = clamp(target["maximum"] + 1, source)
            if candidate > target["maximum"]:
                yield path, "above-maximum", candidate
    elif kind == "string" and "enum" in target:
        allowed = set(target["enum"])
        if "enum" in source:
            removed = set(source["enum"]) - allowed
            if removed:
                yield path, "enum-restricted", min(removed)
        else:
            candidate = ""
            while candidate in allowed:
                candidate += "x"
            yield path, "enum-restricted", candidate


def compare(old, new, direction="request", *, max_array_items=10000):
    if direction not in {"request", "response"}:
        raise ValueError("expected request or response")
    for schema in (old, new):
        validate(schema)
    source, target = (old, new) if direction == "request" else (new, old)
    if type(max_array_items) is not int or max_array_items < 0:
        raise ValueError("max-array-items must be a nonnegative integer")
    remaining = max_array_items

    def materialize(value):
        nonlocal remaining
        if isinstance(value, ArrayWitness):
            if value.length > remaining:
                raise ValueError(f"witness output exceeds --max-array-items {max_array_items}")
            remaining -= value.length
            return [materialize(value.first if i == 0 else value.rest) for i in range(value.length)]
        if isinstance(value, dict):
            return {key: materialize(child) for key, child in value.items()}
        return value

    findings = [{"path": path, "reason": reason, "payload": materialize(value)}
                for path, reason, value in differences(source, target)]
    return {"direction": direction, "compatible": not findings, "findings": findings}


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key!r}")
        result[key] = value
    return result


def read_schema(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_keys)
    except (OSError, ValueError) as error:
        raise ValueError(f"{path}: {error}") from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    parser.add_argument("--direction", choices=["request", "response"], default="request")
    parser.add_argument("--max-array-items", type=int, default=10000, help="total array entries across output witnesses")
    args = parser.parse_args()
    try:
        report = compare(read_schema(args.old), read_schema(args.new), args.direction, max_array_items=args.max_array_items)
    except (ValueError, RecursionError) as error:
        parser.exit(2, f"contract error: {error}\n")
    print(json.dumps(report, indent=2))
    return 0 if report["compatible"] else 1


if __name__ == "__main__":
    sys.exit(main())
