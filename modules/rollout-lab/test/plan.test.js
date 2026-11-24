import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzePlan } from "../web/plan.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const example = JSON.parse(await readFile(new URL("../examples/checkout-plan.json", import.meta.url)));

test("rollback restores the endpoint but retains the affected population and exact account history", async () => {
  const report = await analyzePlan(example, "demo-0090");
  assert.deepEqual(report.subject.path.map(s => s.variant), ["B", "B", "A", "B"]);
  assert.deepEqual([report.everChanged, report.finalChanged, report.returnedToBaseline], [18000000, 0, 18000000]);
  assert.deepEqual(report.steps.map(s => [s.entered, s.exited, s.switched]),
    [[15000000, 0, 0], [0, 0, 7500000], [0, 15000000, 3000000]]);
  assert.deepEqual(report.violations, []);
});

test("one switched bucket pair fails a zero budget without rounding", async () => {
  const stage = (name, weight) => ({ name, rollout: 1, variants: [
    {name: "A", weight}, {name: "B", weight: 10000 - weight}
  ]});
  const report = await analyzePlan({flag: "tiny", stages: [stage("old", 0), stage("new", 1)],
    limits: {maxEverChangedBps: 0, maxFinalChangedBps: 0, maxSwitchedBpsPerStep: 0}});
  assert.equal(report.finalChanged, 1);
  assert.deepEqual(report.violations.map(v => [v.actualPairs, v.allowedPairs]), [[1, 0], [1, 0], [1, 0]]);
});

test("exact counts agree with an enumerated grid over 128 generated plans", async () => {
  // All boundaries are multiples of 500, so each enumerated cell represents
  // precisely 500 × 500 real bucket pairs. Expand per-stage lookup tables
  // directly from the weights, independently of the interval algorithm.
  let state = 917;
  const rand = n => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return Math.floor(state / 2**32 * n);
  };
  for (let trial = 0; trial < 128; trial++) {
    const tables = [];
    const stages = Array.from({length: 2 + rand(6)}, (_, i) => {
      const exposure = rand(21);
      const a = rand(21), b = rand(21 - a);
      const names = ["A", "B", "C"];
      for (let j = 2; j > 0; j--) {
        const k = rand(j + 1);
        [names[j], names[k]] = [names[k], names[j]];
      }
      const sizes = [a, b, 20-a-b];
      tables.push({exposure, variants: sizes.flatMap((size, j) => Array(size).fill(names[j]))});
      return {name: String(i), rollout: exposure * 500,
        variants: sizes.map((size, j) => ({name: names[j], weight: size*500}))};
    });
    let ever = 0, final = 0;
    const steps = stages.slice(1).map(() => ({entered: 0, exited: 0, switched: 0, unchanged: 0}));
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) {
      const path = tables.map(t => x < t.exposure ? t.variants[y] : null);
      if (new Set(path).size > 1) ever += 250000;
      if (path[0] !== path.at(-1)) final += 250000;
      for (let i = 0; i < steps.length; i++) {
        const [before, after] = [path[i], path[i+1]];
        const key = before === after ? "unchanged" : before === null ? "entered" : after === null ? "exited" : "switched";
        steps[i][key] += 250000;
      }
    }
    const report = await analyzePlan({flag: "test", stages});
    assert.deepEqual([report.everChanged, report.finalChanged, report.returnedToBaseline], [ever, final, ever-final]);
    assert.deepEqual(report.steps.map(({from, to, ...counts}) => counts), steps);
  }
});

test("CLI distinguishes acceptable plans, budget overruns and invalid input", async t => {
  const dir = await mkdtemp(join(tmpdir(), "rollout-plan-"));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, "plan.json");
  async function run(plan) {
    await writeFile(file, JSON.stringify(plan));
    return spawnSync(process.execPath, ["plan.js", file], {cwd: root, encoding: "utf8", timeout: 10000});
  }
  const good = await run(example);
  assert.equal(good.status, 0, good.stderr);
  const bad = await run({...example, limits: {maxEverChangedBps: 1799, maxSwitchedBpsPerStep: 749}});
  assert.equal(bad.status, 1);
  assert.deepEqual(JSON.parse(bad.stdout).violations.map(v => v.stage ?? v.limit), ["maxEverChangedBps", "rebalance"]);
  for (const plan of [{...example, limit: {}}, {...example, flag: ""},
    {...example, stages: [example.stages[0], example.stages[0]]}, {...example, limits: {maxSwitch: 1}},
    {...example, limits: null}, {...example, limits: {maxEverChangedBps: 0.1}}]) {
    const result = await run(plan);
    assert.deepEqual([result.status, result.stdout], [2, ""]);
    assert.ok(result.stderr.trim());
  }
});
