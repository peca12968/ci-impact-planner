import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {plan} from "../planner.js";

const manifestFile = new URL("../examples/projects.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestFile));
const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
const options = {buildPlan: true};

test("build-only dependencies are layered without adding their tests", () => {
  const changed = ["apps/web/button.ts"];
  const regular = plan(manifest, changed);
  const built = plan(manifest, changed, null, null, options);
  assert.deepEqual(built, {...regular, buildPlan: {
    stages: [["contracts"], ["api", "web"], ["checkout-e2e"]],
    buildOnly: [
      {project: "api", requiredBy: ["checkout-e2e"]},
      {project: "contracts", requiredBy: ["api", "web"]}
    ]
  }});
  assert.deepEqual(regular.stages, [["web"], ["checkout-e2e"]]);
  const withWhy = plan(manifest, changed, null, "api", options);
  assert.equal(withWhy.why.selected, false);
  assert.deepEqual(withWhy.buildPlan, built.buildPlan);
});

test("shared dependencies are built only once and full fallback or a clean diff stay explicit", () => {
  assert.deepEqual(plan(manifest, ["packages/contracts/schema.json"], null, null, options).buildPlan, {
    stages: [["contracts"], ["api", "web"], ["checkout-e2e"]], buildOnly: []
  });
  assert.deepEqual(plan(manifest, [], null, null, options).buildPlan, {stages: [], buildOnly: []});
  for (const [paths, reason] of [[["package-lock.json"], null], [[], "manifest_changed"]]) {
    const result = plan(manifest, paths, reason, null, options);
    assert.equal(result.mode, "full");
    assert.deepEqual(result.buildPlan, {stages: result.stages, buildOnly: []});
  }
});

test("website examples run the real CLI and suite inventory covers only selected tests", () => {
  const examples = JSON.parse(readFileSync(new URL("../examples/build-plan-demo.json", import.meta.url)));
  assert.deepEqual(examples.map(row => row.scenario), ["web", "docs", "global"]);
  for (const {file, scenario, ...expected} of examples) {
    const result = spawnSync(process.execPath, [cli, "--build-plan", "--suites", fileURLToPath(manifestFile), "--stdin0"],
      {input: file + "\0", encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual({mode: report.mode, buildPlan: report.buildPlan, stages: report.stages,
      testFiles: report.suiteStages.flatMap(stage => stage.manifest.files.map(test => test.path))}, expected);
  }
  assert.deepEqual(examples[0].testFiles, ["apps/web/test_home.py", "apps/web/test_cart.py", "tests/checkout/test_flow.py"]);
});

test("closure agrees with an independent dependency walk on all four-project DAGs and changed sets", () => {
  const names = ["a", "b", "c", "d"];
  const possible = names.flatMap((child, i) => names.slice(0, i).map(parent => [parent, child]));
  for (let mask = 0; mask < 2 ** possible.length; mask++) {
    const edges = possible.filter((_, bit) => mask & (1 << bit));
    const projects = names.map(name => ({name, dir: name,
      dependencies: edges.filter(([, child]) => child === name).map(([parent]) => parent)}));
    function upstream(project, dependency) {
      return project === dependency || edges.some(([parent, child]) => child === project && upstream(parent, dependency));
    }
    for (let subset = 0; subset < 2 ** names.length; subset++) {
      const changed = names.filter((_, bit) => subset & (1 << bit));
      const selected = names.filter(name => changed.some(root => upstream(name, root)));
      const builds = names.filter(name => selected.some(target => upstream(target, name)));
      const report = plan({projects: projects.toReversed()}, changed.toReversed(), null, null, options);
      const stageByName = new Map(report.buildPlan.stages.flatMap((stage, i) => stage.map(name => [name, i])));
      assert.deepEqual(report.stages.flat().toSorted(), selected);
      assert.deepEqual([...stageByName.keys()].sort(), builds);
      for (const [parent, child] of edges) {
        if (builds.includes(child)) assert(stageByName.get(parent) < stageByName.get(child));
      }
      assert.deepEqual(report.buildPlan.buildOnly, builds.filter(name => !selected.includes(name)).map(project => ({
        project, requiredBy: builds.filter(name => edges.some(([parent, child]) => parent === project && child === name))
      })));
    }
  }
});
