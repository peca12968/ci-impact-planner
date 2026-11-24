import {readFileSync} from "node:fs";
import {plan} from "./planner.js";
import {parseGitPaths, readPullRequest, readWorktree} from "./git-input.js";
import {suiteStages} from "./suite-stages.js";

const usage = "Usage: node cli.js [--why PROJECT | --suites] MANIFEST [--git BASE HEAD | --worktree | --stdin0 | -- FILE ... | FILE ...]";
try {
  const input = process.argv.slice(2);
  const suites = input[0] === "--suites";
  let why = null;
  if (suites) input.shift();
  else if (input[0] === "--why") {
    input.shift();
    why = input.shift();
  }
  const [manifestPath, ...args] = input;
  if (!manifestPath) throw new Error(usage);
  let manifest, files, fullReason, comparison;
  if (args[0] === "--git") {
    if (args.length !== 3) throw new Error(usage);
    ({manifest, files, fullReason, comparison} = readPullRequest(manifestPath, args[1], args[2]));
  } else if (args[0] === "--worktree") {
    if (args.length !== 1) throw new Error(usage);
    ({manifest, files, fullReason, comparison} = readWorktree(manifestPath));
  } else {
    if (args[0] === "--stdin0") {
      if (args.length !== 1) throw new Error(usage);
      files = parseGitPaths(readFileSync(0));
    } else {
      files = args[0] === "--" ? args.slice(1) : args;
    }
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  }
  const report = plan(manifest, files, fullReason, why);
  if (comparison) report.comparison = comparison;
  if (suites) report.suiteStages = suiteStages(manifest, report.stages);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
