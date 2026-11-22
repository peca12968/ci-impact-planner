"""Audit a two-variant exposure log at the user randomization unit."""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path

from scipy.stats import binomtest


def audit(plan, events):
    if not isinstance(plan, dict):
        raise ValueError("expected an experiment plan")
    strata = plan.get("strata")
    if (not isinstance(strata, list) or not strata or
            any(not isinstance(s, str) or not s.strip() for s in strata) or len(set(strata)) != len(strata)):
        raise ValueError("expected a nonempty list of distinct stratum names")
    ratio = plan.get("treatment_probability")
    alpha = plan.get("alpha", 0.05)
    if any(type(x) not in (float, int) or not 0 < x < 1 for x in (ratio, alpha)):
        raise ValueError("treatment_probability and alpha must be strictly between 0 and 1")
    known = set(strata)
    seen = {}
    users = defaultdict(set)
    event_counts = Counter()
    repeats = 0
    for row in events:
        if not isinstance(row, dict):
            raise ValueError("expected an exposure object")
        event, user, variant, stratum = (row.get(k) for k in ("event_id", "user", "variant", "stratum"))
        if not all(isinstance(v, str) and v.strip() for v in (event, user, variant, stratum)):
            raise ValueError("invalid exposure fields")
        if variant not in ("control", "treatment") or stratum not in known:
            raise ValueError(f"unexpected variant or stratum on {event!r}")
        content = user, variant, stratum
        if event in seen:
            if seen[event] != content:
                raise ValueError(f"conflicting copies of event {event!r}")
            repeats += 1
            continue
        seen[event] = content
        event_counts[variant] += 1
        users[user].add((stratum, variant))

    counts = {name: Counter() for name in strata}
    excluded = Counter()
    for memberships in users.values():
        if len(memberships) == 1:
            (stratum, variant), = memberships
            counts[stratum][variant] += 1
        else:
            cross_variant = len({v for _, v in memberships}) > 1
            cross_stratum = len({s for s, _ in memberships}) > 1
            if cross_variant and cross_stratum:
                reason = "both"
            else:
                reason = "variant" if cross_variant else "stratum"
            excluded[reason] += 1

    def measure(stratum, count):
        control, treatment = count["control"], count["treatment"]
        total = control + treatment
        raw = float(binomtest(treatment, total, ratio).pvalue) if total else None
        return {"stratum": stratum, "control": control, "treatment": treatment, "p_value": raw,
                "holm_p": None, "flagged": False}

    overall = Counter()
    for count in counts.values():
        overall.update(count)
    tests = [measure(None, overall)] + [measure(s, counts[s]) for s in strata]
    # The declared family includes unobserved strata. They contribute to its size
    # but cannot be rejected and retain null p-values in the report.
    observed = sorted((test for test in tests if test["p_value"] is not None), key=lambda test: test["p_value"])
    previous = 0.0
    for index, test in enumerate(observed):
        adjusted = min(1.0, max(previous, (len(tests) - index) * test["p_value"]))
        test["holm_p"] = previous = adjusted
        test["flagged"] = adjusted <= alpha
    findings = []
    if any(t["flagged"] for t in tests):
        findings.append("sample_ratio_mismatch")
    if excluded:
        findings.append("inconsistent_assignment")
    if not sum(overall.values()):
        findings.append("no_eligible_users")
    return {"findings": findings, "unique_events": len(seen), "events_by_variant": dict(sorted(event_counts.items())),
            "duplicate_rows": repeats, "users_seen": len(users),
            "users_tested": sum(overall.values()), "excluded_users": dict(sorted(excluded.items())),
            "alpha": alpha, "treatment_probability": ratio, "tests": tests}


def rows(stream):
    for number, line in enumerate(stream, 1):
        if line.strip():
            try:
                yield json.loads(line)
            except ValueError as error:
                raise ValueError(f"invalid JSON on line {number}") from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    parser.add_argument("events", type=Path)
    args = parser.parse_args()
    try:
        plan = json.loads(args.plan.read_text(encoding="utf-8-sig"))
        with args.events.open(encoding="utf-8-sig") as stream:
            report = audit(plan, rows(stream))
    except (OSError, ValueError) as error:
        parser.exit(2, f"{error}\n")
    print(json.dumps(report, indent=2, allow_nan=False))
    return int(bool(report["findings"]))


if __name__ == "__main__":
    raise SystemExit(main())
