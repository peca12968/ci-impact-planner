import {readFileSync} from "node:fs";
import {plan} from "./planner.js";
import {parseGitPaths, readPullRequest} from "./git-input.js";

const usage = "Usage: node cli.js MANIFEST [--git BASE HEAD | --stdin0 | -- FILE ... | FILE ...]";
try {
  const [manifestPath, ...args] = process.argv.slice(2);
  if (!manifestPath) throw new Error(usage);
  let report;
  if (args[0] === "--git") {
    if (args.length !== 3) throw new Error(usage);
    const {manifest, files, fullReason, comparison} = readPullRequest(manifestPath, args[1], args[2]);
    report = {...plan(manifest, files, fullReason), comparison};
  } else {
    let files;
    if (args[0] === "--stdin0") {
      if (args.length !== 1) throw new Error(usage);
      files = parseGitPaths(readFileSync(0));
    } else {
      files = args[0] === "--" ? args.slice(1) : args;
    }
    report = plan(JSON.parse(readFileSync(manifestPath, "utf8")), files);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
