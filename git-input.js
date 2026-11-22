import {spawnSync} from "node:child_process";
import {realpathSync} from "node:fs";
import path from "node:path";
import {TextDecoder} from "node:util";

const utf8 = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});

export function parseGitPaths(bytes) {
  const input = utf8.decode(bytes);
  if (input && !input.endsWith("\0")) throw new Error("Expected NUL-terminated Git paths");
  return input ? input.slice(0, -1).split("\0") : [];
}

function git(args, missingBaseAllowed = false) {
  const result = spawnSync("git", args, {maxBuffer: 32 * 1024 * 1024, windowsHide: true});
  if (result.error) throw result.error;
  if (missingBaseAllowed && result.status === 1) return Buffer.alloc(0);
  if (result.status !== 0)
    throw new Error(result.stderr.toString("utf8").trim() || "Git command failed");
  return result.stdout;
}

function commit(ref) {
  return git(["rev-parse", "--verify", "--end-of-options", ref + "^{commit}"]).toString("ascii").trim();
}

function canonicalDirectory(dir) {
  // A directory present in the requested commit can be missing from this checkout.
  try {
    return realpathSync.native(dir);
  } catch (error) {
    const parent = path.dirname(dir);
    if (error.code !== "ENOENT" || parent === dir) throw error;
    return path.join(canonicalDirectory(parent), path.basename(dir));
  }
}

function outside(relative) {
  return !relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative);
}

export function readPullRequest(manifestPath, baseRef, headRef) {
  const root = utf8.decode(git(["rev-parse", "--show-toplevel"])).replace(/\r?\n$/, "");
  const absolute = path.resolve(manifestPath);
  let relative = path.relative(root, absolute);
  if (outside(relative)) {
    // Git and Node can reach the same checkout using a junction or Windows short pathname.
    const local = path.join(canonicalDirectory(path.dirname(absolute)), path.basename(absolute));
    relative = path.relative(realpathSync.native(root), local);
  }
  if (outside(relative))
    throw new Error("In --git mode the manifest must be a path inside the repository");
  const manifestFile = relative.split(path.sep).join("/");
  const base = commit(baseRef);
  const head = commit(headRef);
  const bases = git(["merge-base", "--all", base, head], true).toString("ascii").trim();
  if (!bases) throw new Error("No common ancestor available; check the refs and fetch missing history");
  const mergeBases = bases.split(/\s+/).sort();
  const manifest = JSON.parse(utf8.decode(git(["cat-file", "blob", head + ":" + manifestFile])).replace(/^\uFEFF/, ""));
  const comparison = {base, head, mergeBases, manifest: manifestFile};
  if (mergeBases.length !== 1) {
    return {manifest, files: [], comparison, fullReason: "multiple_merge_bases"};
  }
  const files = parseGitPaths(git(["diff", "--no-renames", "--no-relative", "--ignore-submodules=none",
    "--name-only", "-z", mergeBases[0], head, "--"]));
  return {manifest, files, comparison, fullReason: files.includes(manifestFile) ? "manifest_changed" : null};
}
