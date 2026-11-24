import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = JSON.parse(readFileSync(join(root, "examples/checkout-decisions.json"), "utf8"));

function runner(t) {
  const temp = mkdtempSync(join(tmpdir(), "rollout-observations-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const input = join(temp, "decisions.json");
  return (rows, status) => {
    writeFileSync(input, JSON.stringify(rows));
    const result = spawnSync(process.execPath, ["reconcile.js", "examples/checkout-plan.json", input],
      { cwd: root, encoding: "utf8" });
    assert.equal(result.status, status, result.stderr);
    if (status !== 2) return JSON.parse(result.stdout);
    assert.equal(result.stdout, "");
    return result.stderr;
  };
}

test("unchanged variant totals still expose swapped recipients, independent of feed order", t => {
  const run = runner(t);
  const report = run(fixture, 1);
  assert.deepEqual(run([...fixture].reverse(), 1), report);
  assert.deepEqual([report.rows, report.checked, report.mismatched], [6, 5, 2]);
  assert.deepEqual(report.differences, [
    { stage: "baseline", subject: "café", expected: "B", observed: ["A"] },
    { stage: "baseline", subject: "demo-0002", expected: "A", observed: ["B"] }
  ]);
  assert.deepEqual(report.stages.map(s => s.checked), [3, 0, 1, 1]);
  const fixed = fixture.map((row, i) => i < 3 ? { ...row, variant: i === 0 ? "A" : "B" } : row);
  assert.deepEqual(run(fixed, 0).differences, []);
});

test("record disabled decisions, inconsistent repeat decisions, unknown variants and missing evidence", t => {
  const run = runner(t);
  const row = fixture[0];
  const report = run([row, { ...row, variant: null }, { ...row, variant: "A" },
    { ...row, variant: "retired" }, { ...fixture[3], variant: "B" }], 1);
  assert.deepEqual(report.differences.map(d => [d.expected, d.observed]), [
    [null, ["B"]], ["A", [null, "A", "B", "retired"]]
  ]);
  assert.equal(run([], 1).checked, 0);
  for (const invalid of [{ flag: "another" }, { stage: "missing" }, { variant: undefined }, { subject: "" }])
    assert.match(run([row, { ...row, ...invalid }], 2), /Decision 2/);
});
