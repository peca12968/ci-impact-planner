import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const cwd = fileURLToPath(new URL(".", import.meta.url));
const before = "examples/before.json";
const after = "examples/after.json";
const run = (...args) => spawnSync(process.execPath, ["audit.mjs", ...args], {cwd, encoding: "utf8"});

test("a token change identifies both affected hints and keeps existing failures separate", () => {
  const result = run(before, after);
  assert.equal(result.status, 1);
  const {rows, removed} = JSON.parse(result.stdout);
  assert.deepEqual(rows.map(r => r.status), ["regression", "regression", "passing", "fixed", "existing_failure"]);
  assert.deepEqual(removed, ["retired-label"]);
  for (const row of rows.slice(0, 2)) {
    assert.deepEqual(row.foreground, {token: "hint", color: "#586b7580"});
    assert.ok(row.previousRatio >= row.minimum && row.ratio < row.minimum);
  }
  assert.equal(run(after, after).status, 0);
  assert.equal(run(after).status, 1);
});

test("input errors return code 2 and leave stdout empty for CI consumers", () => {
  for (const args of [[], ["does-not-exist.json"], [before, after, after]]) {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.trim());
  }
});
