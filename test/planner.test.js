import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {plan} from "../planner.js";

const manifestUrl = new URL("../examples/projects.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl));
const cli = fileURLToPath(new URL("../cli.js", import.meta.url));

test("shared contract triggers the diamond once and skips docs", () => {
  const result = plan(manifest, ["packages/contracts/schema.json", "apps/api/a.js"]);
  assert.deepEqual(result.stages, [["contracts"], ["api", "web"], ["checkout-e2e"]]);
  assert.deepEqual(result.direct, ["api", "contracts"]);
  assert.equal(result.selected, 4);
});

test("leaf changes omit unaffected prerequisites", () => {
  assert.deepEqual(plan(manifest, ["apps/web/ui.js"]).stages, [["web"], ["checkout-e2e"]]);
});

test("an unknown root file or sibling with a common prefix requests a full build", () => {
  for (const file of ["package-lock.json", "apps/website/app.js"]) {
    const result = plan(manifest, [file]);
    assert.equal(result.mode, "full");
    assert.equal(result.selected, 5);
    assert.deepEqual(result.unowned, [file]);
  }
});

test("empty diff selects nothing", () => {
  assert.deepEqual(plan(manifest, []).stages, []);
});

test("results are independent of manifest order and repeated changed paths", () => {
  const reversed = {projects: [...manifest.projects].reverse()};
  const expected = plan(manifest, ["apps/web/main.js", "apps/docs/build.js"]);
  assert.deepEqual(plan(reversed, ["apps/docs/build.js", "apps/web/main.js", "apps/docs/build.js"]), expected);
});

test("validates the whole graph even if a cycle is outside the diff", () => {
  const invalid = structuredClone(manifest);
  invalid.projects[0].dependencies.push("web");
  assert.throws(() => plan(invalid, ["apps/docs/start.js"]), /cycle/);
});

test("rejects unknown dependencies and ambiguous ownership", () => {
  const invalid = structuredClone(manifest);
  invalid.projects[0].dependencies.push("absent");
  assert.throws(() => plan(invalid, []), /Unknown dependency/);
  invalid.projects[0].dependencies.pop();
  invalid.projects[0].dir = "apps";
  assert.throws(() => plan(invalid, []), /Overlapping/);
});

test("rejects paths that are not repository relative", () => {
  for (const file of ["/etc", "../apps", "apps/../web", "C:/apps/web", ""])
    assert.throws(() => plan(manifest, [file]), /path/);
});

function run(input) {
  return spawnSync(process.execPath, [cli, fileURLToPath(manifestUrl), "--stdin0"], {input, encoding: "utf8"});
}

test("CLI preserves spaces and newlines in NUL-delimited Git paths", () => {
  const result = run("apps/api/first line\nsecond line.js\0apps/docs/a b.md\0");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).direct, ["api", "docs"]);
});

test("CLI rejects truncated lists without emitting a partial plan", () => {
  const result = run("apps/web/one");
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /NUL/);
});

test("preserves a leading Unicode BOM that belongs to the first Git filename", () => {
  const file = "\uFEFFapps/web/app.js";
  const result = run(file + "\0");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).unowned, [file]);
});
