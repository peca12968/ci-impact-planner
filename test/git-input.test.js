import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
const graph = readFileSync(new URL("../examples/projects.json", import.meta.url), "utf8");
const manifest = "apps/docs/graph.json";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ci-impact-pr-"));
  t.after(() => rmSync(root, {recursive:true, force:true, maxRetries:3}));
  const git = (...args) => execFileSync("git", args, {cwd:root, encoding:"utf8"}).trim();
  const write = (file, contents) => {
    const name = path.join(root, file);
    mkdirSync(path.dirname(name), {recursive:true});
    writeFileSync(name, contents);
  };
  const save = message => {
    git("add", "--all");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  write(manifest, graph);
  write("apps/docs/guide.txt", "checkout");
  const base = save("base");
  const run = (baseRef, headRef, cwd = root, file = path.join(root, manifest), flags = []) =>
    spawnSync(process.execPath, [cli, ...flags, file, "--git", baseRef, headRef], {cwd, encoding:"utf8"});
  const report = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return {root, base, git, write, save, run, report};
}

test("selects only branch changes, reporting both sides of moves even from a nested directory", t => {
  const f = fixture(t);
  f.git("switch", "-qc", "feature");
  f.write("apps/web/page.js", "page");
  f.git("mv", "apps/docs/guide.txt", "apps/web/user guide.txt");
  const head = f.save("move guide from docs to web");
  f.git("switch", "-q", "main");
  f.write("packages/contracts/api.json", "{}");
  const baseTip = f.save("unrelated target-side edit");
  f.write(manifest, "uncommitted invalid JSON");
  const report = f.report("main", "feature", path.join(f.root, "apps", "docs"), "graph.json");
  assert.deepEqual(report.comparison, {base:baseTip, head, mergeBases:[f.base], manifest});
  assert.deepEqual(report.direct, ["docs", "web"]);
  assert.deepEqual(report.stages, [["docs", "web"], ["checkout-e2e"]]);
  assert.equal(report.selected, 3);
  const detail = f.report("main", "feature", path.join(f.root, "apps", "docs"), "graph.json", ["--why", "checkout-e2e"]);
  assert.deepEqual(detail, {...report, why: {
    project: "checkout-e2e", selected: true, fullReasons: [],
    causes: [{files: ["apps/web/page.js", "apps/web/user guide.txt"], chain: ["web", "checkout-e2e"]}]
  }});
});

test("empty head diff is empty even when the target branch advanced", t => {
  const f = fixture(t);
  f.write("package-lock.json", "{}");
  const main = f.save("base advanced");
  assert.equal(f.report(main, f.base).selected, 0);
});

test("edits to a nested manifest select all projects from the head revision", t => {
  const f = fixture(t);
  const updated = JSON.parse(graph);
  updated.projects.push({name:"mobile", dir:"apps/mobile", dependencies:["api"]});
  f.write(manifest, JSON.stringify(updated));
  const head = f.save("add mobile to graph");
  f.git("checkout", "-q", f.base);
  const report = f.report(f.base, head);
  assert.equal(report.mode, "full");
  assert.equal(report.fullReason, "manifest_changed");
  assert.equal(report.selected, 6);
  assert.ok(report.stages.flat().includes("mobile"));
  const detail = f.report(f.base, head, undefined, undefined, ["--why", "mobile"]);
  assert.deepEqual(detail.why, {project: "mobile", selected: true, causes: [], fullReasons: ["manifest_changed"]});
});

test("criss-cross history selects all projects and reports both merge bases", t => {
  const f = fixture(t);
  const tree = f.git("rev-parse", "HEAD^{tree}");
  const commit = (message, ...parents) =>
    f.git("commit-tree", tree, "-m", message, ...parents.flatMap(p => ["-p", p]));
  const a = commit("left", f.base);
  const b = commit("right", f.base);
  const report = f.report(commit("a+b", a, b), commit("b+a", b, a), undefined, undefined, ["--why", "web"]);
  assert.equal(report.fullReason, "multiple_merge_bases");
  assert.deepEqual(report.comparison.mergeBases, [a, b].sort());
  assert.equal(report.selected, 5);
  assert.deepEqual(report.why, {project: "web", selected: true, causes: [], fullReasons: ["multiple_merge_bases"]});
});

test("a directory alias resolves to the tracked manifest even if its parent only exists at head", t => {
  const f = fixture(t);
  const aliasDir = mkdtempSync(path.join(os.tmpdir(), "ci-impact-alias-"));
  t.after(() => rmSync(aliasDir, {recursive:true, force:true, maxRetries:3}));
  const alias = path.join(aliasDir, "checkout");
  symlinkSync(f.root, alias, process.platform === "win32" ? "junction" : "dir");
  const added = "config/ci/projects.json";
  f.write(added, graph);
  const head = f.save("new manifest location");
  f.git("checkout", "-q", f.base);
  const report = f.report(f.base, head, f.root, path.join(alias, added));
  assert.equal(report.comparison.manifest, added);
  assert.equal(report.selected, 5);
});

test("unrelated histories, unknown refs and unavailable manifests emit no partial JSON", t => {
  const f = fixture(t);
  const orphan = f.git("commit-tree", f.git("rev-parse", "HEAD^{tree}"), "-m", "unrelated");
  for (const args of [[f.base, orphan], ["absent-ref", "HEAD"], [f.base, f.base, f.root, "absent.json"]]) {
    const result = f.run(...args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.trim());
  }
});
