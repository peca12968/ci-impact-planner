import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {plan} from "../planner.js";
import {suiteStages} from "../suite-stages.js";

const example = JSON.parse(readFileSync(new URL("../examples/projects.json", import.meta.url)));

test("each selected file appears once in its project stage", () => {
  for (const changes of [[], ["apps/web/button.ts"], ["packages/contracts/schema.json"], ["lockfile"]]) {
    const stages = plan(example, changes).stages;
    const suites = suiteStages(example, stages);
    assert.deepEqual(suites.map(s => s.projects), stages);
    for (const [index, {manifest}] of suites.entries()) {
      const expected = example.projects.filter(p => stages[index].includes(p.name)).flatMap(p => p.tests);
      assert.deepEqual(manifest.files.map(f => f.path).sort(), expected.map(f => f.path).sort());
      assert.deepEqual(manifest.setup_ms, example.setup_ms);
    }
  }
});

test("invalid suite inventories fail even when the owning project is unaffected", () => {
  for (const edit of [
    p => { delete p.tests; },
    p => p.tests.push(p.tests[0]),
    p => { p.tests[0].fixture = "missing"; },
    p => { p.tests[0].fallback_ms = -1; },
    p => { p.tests[0].path = "apps/api/test_docs.py"; }
  ]) {
    const manifest = structuredClone(example);
    edit(manifest.projects.at(-1));
    assert.throws(() => suiteStages(manifest, [["web"]]));
  }
});
