import {readFileSync} from "node:fs";
import {plan} from "./planner.js";
import {parseGitPaths, readPullRequest} from "./git-input.js";

const usage = "Usage: node cli.js [--why PROJECT] MANIFEST [--git BASE HEAD | --stdin0 | -- FILE ... | FILE ...]";
try {
  const input = process.argv.slice(2);
  const explaining = input[0] === "--why";
  const why = explaining ? input[1] : null;
  const [manifestPath, ...args] = explaining ? input.slice(2) : input;
  if (!manifestPath) throw new Error(usage);
  let report;
  if (args[0] === "--git") {
    if (args.length !== 3) throw new Error(usage);
    const {manifest, files, fullReason, comparison} = readPullRequest(manifestPath, args[1], args[2]);
    report = {...plan(manifest, files, fullReason, why), comparison};
  } else {
    let files;
    if (args[0] === "--stdin0") {
      if (args.length !== 1) throw new Error(usage);
      files = parseGitPaths(readFileSync(0));
    } else {
      files = args[0] === "--" ? args.slice(1) : args;
    }
    report = plan(JSON.parse(readFileSync(manifestPath, "utf8")), files, null, why);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
