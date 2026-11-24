import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reconcile } from "./reconcile.js";
import { compilePlan } from "./web/plan.js";
import { normalizeIdentifier } from "./web/rollout.js";

const entry = fileURLToPath(new URL("./modules/exposure-audit/exposure_audit.py", import.meta.url));
const read = path => JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(readFileSync(path)));

try {
  const [planFile, stageName, exposurePlanFile, eventsFile, ...extra] = process.argv.slice(2);
  if (!eventsFile || extra.length) throw new Error("Usage: node stage-audit.mjs PLAN.json STAGE EXPOSURE-PLAN.json EVENTS.json");
  const plan = read(planFile);
  const stage = compilePlan(plan).stages.find(value => value.name === stageName);
  if (stage?.ranges.length !== 2) throw new Error("The selected stage must have exactly two variants");
  const variants = new Map(stage.ranges.map(({name}, index) => [name, index ? "treatment" : "control"]));
  const exposurePlan = read(exposurePlanFile);
  if (exposurePlan.treatment_probability !== (10000 - stage.ranges[0].end) / 10000)
    throw new Error("Exposure probability must match the selected stage's treatment weight");
  const events = read(eventsFile);
  if (!Array.isArray(events) || events.some(row => row?.stage !== stageName))
    throw new Error("Each event must belong to the selected stage");
  const decisions = await reconcile(plan, events);
  const exposures = events.filter(row => row.variant !== null).map(row => ({
    event_id: row.event_id, user: normalizeIdentifier(row.subject), variant: variants.get(row.variant), stratum: row.stratum,
  }));
  const result = spawnSync(process.env.PYTHON || "python", [entry, exposurePlanFile, "-"], {
    input: exposures.map(row => JSON.stringify(row)).join("\n"), encoding: "utf-8",
  });
  if (result.error || ![0, 1].includes(result.status))
    throw new Error(result.error?.message || result.stderr.trim() || "Exposure audit failed");
  console.log(JSON.stringify({decisions, exposures: JSON.parse(result.stdout)}, null, 2));
  process.exitCode = decisions.mismatched || !decisions.checked || result.status === 1 ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
