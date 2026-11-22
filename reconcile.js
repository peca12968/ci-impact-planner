import { readFileSync } from "node:fs";
import { compilePlan } from "./web/plan.js";
import { normalizeIdentifier, subjectBuckets } from "./web/rollout.js";

function readJson(path) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  return JSON.parse(text);
}

async function reconcile(plan, decisions) {
  const { flag, stages } = compilePlan(plan);
  if (!Array.isArray(decisions)) throw new Error("Expected an array of decisions");
  const observed = new Map(stages.map(stage => [stage.name, new Map()]));
  for (const [index, row] of decisions.entries()) {
    try {
      if (!row || normalizeIdentifier(row.flag) !== flag) throw new Error("Unexpected flag");
      const assignments = observed.get(row.stage);
      if (!assignments) throw new Error("Unknown stage");
      const subject = normalizeIdentifier(row.subject);
      if (row.variant !== null && (typeof row.variant !== "string" || !row.variant.trim()))
        throw new Error("Expected a variant name or explicit null for disabled");
      if (!assignments.has(subject)) assignments.set(subject, new Set());
      assignments.get(subject).add(row.variant);
    } catch (error) {
      throw new Error(`Decision ${index + 1}: ${error.message}`);
    }
  }

  const buckets = new Map();
  const report = { flag, rows: decisions.length, checked: 0, mismatched: 0, stages: [], differences: [] };
  for (const stage of stages) {
    const assignments = observed.get(stage.name);
    let mismatched = 0;
    for (const subject of [...assignments.keys()].sort()) {
      if (!buckets.has(subject)) buckets.set(subject, await subjectBuckets(flag, subject));
      const expected = stage.assign(buckets.get(subject));
      const actual = assignments.get(subject);
      if (actual.size === 1 && actual.has(expected)) continue;
      const variants = [...actual].filter(v => v !== null).sort();
      if (actual.has(null)) variants.unshift(null);
      report.differences.push({ stage: stage.name, subject, expected, observed: variants });
      mismatched++;
    }
    report.stages.push({ stage: stage.name, checked: assignments.size, mismatched });
    report.checked += assignments.size;
    report.mismatched += mismatched;
  }
  return report;
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 2) throw new Error("Usage: node reconcile.js PLAN.json DECISIONS.json");
  const report = await reconcile(readJson(args[0]), readJson(args[1]));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.mismatched || !report.checked ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
