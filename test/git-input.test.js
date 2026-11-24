import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {plan} from "../planner.js";

const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
const graph = readFileSync(new URL("../examples/projects.json", import.meta.url), "utf8");
const manifest = "apps/docs/graph.json";

function fixture(t, format = "sha1") {
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
  git("init", "-q", "-b", "main", "--object-format=" + format);
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  write(manifest, graph);
  write("apps/docs/guide.txt", "checkout");
  const base = save("base");
  const compare = (mode, baseRef, headRef, cwd = root, file = path.join(root, manifest), flags = []) =>
    spawnSync(process.execPath, [cli, ...flags, file, mode, baseRef, headRef], {cwd, encoding:"utf8"});
  const run = (...args) => compare("--git", ...args);
  const push = (...args) => compare("--push", ...args);
  const worktree = (cwd = root, file = path.join(root, manifest), flags = []) =>
    spawnSync(process.execPath, [cli, ...flags, file, "--worktree"], {cwd, encoding:"utf8"});
  const report = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return {root, base, git, write, save, run, report, worktree, push};
}

test("worktree planning keeps both sides of a move and distinguishes staged, unstaged and new paths", t => {
  const demo = JSON.parse(readFileSync(new URL("../examples/worktree-demo.json", import.meta.url), "utf8"));
  const f = fixture(t);
  f.write(".gitignore", "*.local\n");
  f.save("ignore local build scratch files");
  const clean = f.worktree();
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(JSON.parse(clean.stdout).selected, 0);
  f.write("apps/web/ignored.local", "ignored");
  const moved = "apps/web/user guide.txt";
  f.write(moved, "initial content");
  f.git("add", "--", moved);
  f.git("rm", "-q", "--", "apps/docs/guide.txt");
  f.write(moved, "edited after staging");
  const extra = "apps/api/新增 路由.js";
  f.write(extra, "a new route");
  const result = f.worktree(path.join(f.root, "apps", "docs"), "graph.json", ["--why", "checkout-e2e"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.comparison, {
    source: "worktree", manifest,
    changes: demo.changes,
  });
  assert.deepEqual(report.direct, ["api", "docs", "web"]);
  assert.deepEqual(report.stages, demo.worktree_stages);
  assert.deepEqual(plan(JSON.parse(graph), report.comparison.changes.staged).stages, demo.staged_stages);
  assert.deepEqual(report.why.causes, [
    {files: [extra], chain: ["api", "checkout-e2e"]},
    {files: [moved], chain: ["web", "checkout-e2e"]},
  ]);
  assert.equal(f.git("show", ":" + moved), "initial content");
  assert.equal(readFileSync(path.join(f.root, moved), "utf8"), "edited after staging");
  if (process.platform !== "win32") {
    const multiline = "apps/web/notes\nfinal.txt";
    f.write(multiline, "Git paths may contain newlines");
    const output = f.worktree();
    assert.equal(output.status, 0, output.stderr);
    assert.deepEqual(JSON.parse(output.stdout).comparison.changes.untracked, [extra, multiline]);
  }
});

test("push uses committed build prerequisites and keeps their suites out of scope", t => {
  const f = fixture(t);
  f.write("apps/web/button.ts", "new button");
  const after = f.save("web-only change");
  const altered = JSON.parse(graph);
  altered.projects.find(project => project.name === "checkout-e2e").dependencies = ["web"];
  f.write(manifest, JSON.stringify(altered));
  const result = f.push(f.base, after, undefined, undefined, ["--build-plan", "--suites"]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.stages, [["web"], ["checkout-e2e"]]);
  assert.deepEqual(plan.buildPlan.stages, [["contracts"], ["api", "web"], ["checkout-e2e"]]);
  assert.deepEqual(plan.buildPlan.buildOnly, [
    {project: "api", requiredBy: ["checkout-e2e"]}, {project: "contracts", requiredBy: ["api", "web"]}
  ]);
  assert.deepEqual(plan.suiteStages.map(stage => stage.projects), plan.stages);
  assert.equal(JSON.parse(readFileSync(path.join(f.root, manifest))).projects.find(project => project.name === "checkout-e2e")
    .dependencies.length, 1);
});

test("worktree changes to the graph take the conservative path, including ignored manifests", t => {
  const f = fixture(t);
  const updated = JSON.parse(graph);
  updated.projects.push({name: "mobile", dir: "apps/mobile", dependencies: ["api"]});
  f.write(manifest, JSON.stringify(updated));
  const result = f.worktree();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.fullReason, "manifest_changed");
  assert.deepEqual(report.comparison.changes.unstaged, [manifest]);
  assert.equal(report.selected, 6);
  assert.ok(report.stages.flat().includes("mobile"));

  f.git("restore", "--", manifest);
  f.write(".gitignore", "*.local\n");
  f.save("track only the shared manifest");
  f.write("apps/docs/graph.local", JSON.stringify(updated));
  const alternate = f.worktree(f.root, "apps/docs/graph.local");
  assert.equal(alternate.status, 0, alternate.stderr);
  const local = JSON.parse(alternate.stdout);
  assert.deepEqual(local.comparison.changes.untracked, []);
  assert.equal(local.fullReason, "manifest_untracked");
  assert.equal(local.selected, 6);
});

test("worktree planning identifies real merge conflicts without changing the index", t => {
  const f = fixture(t);
  const conflicted = "apps/docs/guide.txt";
  f.git("switch", "-qc", "topic");
  f.write(conflicted, "topic version\n");
  f.save("topic edits the guide");
  f.git("switch", "-q", "main");
  f.write(conflicted, "main version\n");
  f.save("main edits the same guide");
  const merge = spawnSync("git", ["merge", "topic"], {cwd: f.root, encoding: "utf8"});
  assert.equal(merge.status, 1, merge.stderr);
  const before = f.git("ls-files", "--unmerged");
  const result = f.worktree();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.comparison.changes, {staged: [], unstaged: [], untracked: [], conflicted: [conflicted]});
  assert.deepEqual(report.stages, [["docs"]]);
  assert.equal(f.git("ls-files", "--unmerged"), before);
});

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
  const suites = f.report("main", "feature", undefined, undefined, ["--suites"]);
  assert.deepEqual(suites.suiteStages.map(stage => stage.projects), report.stages);
  assert.deepEqual(suites.suiteStages.map(stage => stage.manifest.files.length), [3, 1]);
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

test("push planning catches deletions left out of the PR diff during a force-push", t => {
  const f = fixture(t);
  const fixturePath = new URL("../examples/push-demo.json", import.meta.url);
  const demo = JSON.parse(readFileSync(fixturePath, "utf8"));
  f.write(demo.removed, "old contract to be removed by the force-push");
  const before = f.save("old tip added a contract");
  f.git("switch", "-qc", "replacement", f.base);
  mkdirSync(path.join(f.root, "apps", "web"), {recursive:true});
  f.git("mv", "apps/docs/guide.txt", "apps/web/user guide.txt");
  const after = f.save("replacement tip moves the documentation");
  f.git("checkout", "-q", before);
  f.write(manifest, "an invalid local manifest that must be ignored");

  const pr = f.report(before, after);
  const push = f.push(before, after, undefined, undefined, ["--why", "checkout-e2e"]);
  assert.equal(push.status, 0, push.stderr);
  const report = JSON.parse(push.stdout);
  assert.deepEqual(report.comparison, {source: "push", before, after, manifest});
  assert.deepEqual(pr.stages, demo.pr_stages);
  assert.deepEqual(report.stages, demo.push_stages);
  assert.deepEqual(report.direct, ["contracts", "docs", "web"]);
  assert.deepEqual(report.why.causes, [
    {files: [demo.removed], chain: ["contracts", "api", "checkout-e2e"]},
    {files: ["apps/web/user guide.txt"], chain: ["web", "checkout-e2e"]},
  ]);
  assert.equal(f.git("rev-parse", "HEAD"), before);
});

test("a newly created ref or unavailable old tip selects all suites from the AFTER commit", t => {
  const f = fixture(t, "sha256");
  const zero = "0".repeat(f.base.length);
  const missing = "f".repeat(f.base.length);
  const document = JSON.parse(graph);
  document.projects.pop();
  f.write(manifest, JSON.stringify(document));
  const after = f.save("remove docs from the new test manifest");
  f.git("checkout", "-q", f.base);
  for (const [before, expected] of [
    [zero, "new_ref"], [missing, "before_unavailable"], [f.base, "manifest_changed"],
  ]) {
    const result = f.push(before, after, undefined, undefined, ["--suites"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "full");
    assert.equal(report.fullReason, expected);
    assert.equal(report.selected, 4);
    assert.deepEqual(report.suiteStages.map(stage => stage.projects), report.stages);
    assert.ok(!report.stages.flat().includes("docs"));
  }
  const unchanged = f.push(after, after);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.deepEqual(JSON.parse(unchanged.stdout).stages, []);
});

test("deleted refs, malformed object IDs and unavailable new tips never produce test plans", t => {
  const f = fixture(t);
  const zero = "0".repeat(f.base.length);
  const tree = f.git("rev-parse", "HEAD^{tree}");
  const missing = "f".repeat(f.base.length);
  for (const [before, after, error] of [
    [f.base, zero, /deleted the ref/], ["HEAD", f.base, /full Git object IDs/],
    [tree, f.base, /BEFORE must identify a commit/], [f.base, tree, /AFTER must be an available commit/],
    [f.base, missing, /AFTER must be an available commit/],
  ]) {
    const result = f.push(before, after);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, error);
  }
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
