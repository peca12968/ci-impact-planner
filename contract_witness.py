"""Construct payloads that one revision accepts and the other rejects."""
import argparse
import json
from pathlib import Path
import sys


DIALECT = "https://json-schema.org/draft/2020-12/schema"
KEYWORDS = {
    "object": {"properties", "required", "additionalProperties"},
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


def example(schema):
    match schema["type"]:
        case "object":
            return {key: example(schema["properties"][key]) for key in sorted(schema.get("required", []))}
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


def compare(old, new, direction="request"):
    if direction not in {"request", "response"}:
        raise ValueError("expected request or response")
    for schema in (old, new):
        validate(schema)
    source, target = (old, new) if direction == "request" else (new, old)
    findings = [{"path": path, "reason": reason, "payload": value}
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
    args = parser.parse_args()
    try:
        report = compare(read_schema(args.old), read_schema(args.new), args.direction)
    except (ValueError, RecursionError) as error:
        parser.exit(2, f"contract error: {error}\n")
    print(json.dumps(report, indent=2))
    return 0 if report["compatible"] else 1


if __name__ == "__main__":
    sys.exit(main())
