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

test("explains each changed owner once and retains all matching files in stable order", () => {
  const files = ["packages/contracts/z", "apps/api/a", "packages/contracts/a", "apps/api/a", "apps/docs/d"];
  const describe = (graph, paths) => plan(graph, paths, null, "checkout-e2e").why;
  const expected = {project: "checkout-e2e", selected: true, fullReasons: [], causes: [
    {chain: ["api", "checkout-e2e"], files: ["apps/api/a"]},
    {chain: ["contracts", "api", "checkout-e2e"], files: ["packages/contracts/a", "packages/contracts/z"]}
  ]};
  assert.deepEqual(describe(manifest, files), expected);
  const reversed = manifest.projects.toReversed().map(p => ({...p, dependencies: p.dependencies.toReversed()}));
  assert.deepEqual(describe({projects: reversed}, files.toReversed()), expected);
  assert.deepEqual(plan(manifest, files, null, "docs").why.causes, [{chain: ["docs"], files: ["apps/docs/d"]}]);
});

test("distinguishes skipped, fallback-only and independently affected projects", () => {
  const files = ["apps/web/a"];
  const skipped = plan(manifest, files, null, "docs").why;
  assert.deepEqual(skipped, {project: "docs", selected: false, causes: [], fullReasons: []});
  const full = plan(manifest, [...files, "root.lock"], "manifest_changed", "checkout-e2e");
  assert.deepEqual(full.unowned, ["root.lock"]);
  assert.deepEqual(full.why, {project: "checkout-e2e", selected: true,
    causes: [{chain: ["web", "checkout-e2e"], files}], fullReasons: ["manifest_changed", "unowned_paths"]});
  assert.deepEqual(plan(manifest, ["root.lock"], null, "docs").why,
    {...skipped, selected: true, fullReasons: ["unowned_paths"]});
});

test("normal CLI output stays compatible and --why works with NUL-delimited paths", () => {
  const file = "apps/web/first line\nsecond line";
  const call = flags => spawnSync(process.execPath, [cli, ...flags, fileURLToPath(manifestUrl), "--stdin0"],
    {input: file + "\0", encoding: "utf8"});
  const regular = JSON.parse(call([]).stdout);
  assert.equal(Object.hasOwn(regular, "why"), false);
  const result = call(["--why", "checkout-e2e"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {...regular, why: {
    project: "checkout-e2e", selected: true, causes: [{chain: ["web", "checkout-e2e"], files: [file]}], fullReasons: []}});
  const invalid = call(["--why", "missing"]);
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /Unknown project/);
});

test("shortest causes match exhaustive route enumeration on every four-project ordered DAG", () => {
  const names = ["a", "b", "c", "d"];
  const possible = names.flatMap((child, i) => names.slice(0, i).map(parent => [parent, child]));
  for (let mask = 0; mask < 2 ** possible.length; mask++) {
    const edges = possible.filter((_, bit) => (mask & (1 << bit)) !== 0);
    const projects = names.map(name => ({name, dir: name,
      dependencies: edges.filter(([, child]) => child === name).map(([parent]) => parent)}));
    function routes(from, target) {
      if (from === target) return [[from]];
      return edges.filter(([parent]) => parent === from)
        .flatMap(([, child]) => routes(child, target).map(rest => [from, ...rest]));
    }
    for (const target of names) {
      const why = plan({projects}, names, null, target).why;
      const expected = names.flatMap(source => {
        const paths = routes(source, target);
        paths.sort((a, b) => a.length - b.length || a.join("").localeCompare(b.join(""), "en"));
        return paths.length ? [{files: [source], chain: paths[0]}] : [];
      });
      assert.deepEqual(why.causes, expected, "graph " + mask + ", target " + target);
    }
  }
});
