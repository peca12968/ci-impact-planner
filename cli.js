import {readFileSync} from "node:fs";
import {TextDecoder} from "node:util";
import {plan} from "./planner.js";

const usage = "Usage: node cli.js MANIFEST [--stdin0 | -- FILE ... | FILE ...]";
try {
  const [manifestPath, ...args] = process.argv.slice(2);
  if (!manifestPath) throw new Error(usage);
  let files;
  if (args[0] === "--stdin0") {
    if (args.length !== 1) throw new Error(usage);
    const input = new TextDecoder("utf-8", {fatal: true}).decode(readFileSync(0));
    if (input && !input.endsWith("\0")) throw new Error("Expected NUL-terminated Git paths");
    files = input ? input.slice(0, -1).split("\0") : [];
  } else {
    files = args[0] === "--" ? args.slice(1) : args;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  console.log(JSON.stringify(plan(manifest, files), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
