import { readFileSync } from "node:fs";
import { analyzePlan } from "./web/plan.js";

try {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) throw new Error("Usage: node plan.js PLAN.json [subject]");
  const input = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(args[0]));
  const report = await analyzePlan(JSON.parse(input), args[1]);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.violations.length ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
