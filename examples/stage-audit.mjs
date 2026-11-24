import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const local = name => fileURLToPath(new URL(name, import.meta.url));
const decisions = JSON.parse(readFileSync(local("./checkout-decisions.json"), "utf-8"));
const directory = mkdtempSync(join(tmpdir(), "rollout-audit-"));
const exposures = join(directory, "exposures.json");
const settings = join(directory, "settings.json");
try {
  const data = decisions.filter(row => row.stage === "baseline").map((row, index) => ({
    ...row, event_id: `fixture-${index}`, stratum: "checkout",
  }));
  writeFileSync(settings, JSON.stringify({strata: ["checkout"], treatment_probability: 0.5}));
  const check = () => spawnSync(process.execPath, [local("../stage-audit.mjs"), local("./checkout-plan.json"),
    "baseline", settings, exposures], {encoding: "utf-8"});
  writeFileSync(exposures, JSON.stringify(data));
  const wrong = check();
  assert.equal(wrong.status, 1, wrong.stderr);
  const wrongReport = JSON.parse(wrong.stdout);
  assert.equal(wrongReport.decisions.mismatched, 2);
  assert.deepEqual(wrongReport.exposures.findings, []);
  assert.equal(wrongReport.exposures.users_tested, 2);
  for (const row of data) if (row.variant !== null) row.variant = row.variant === "A" ? "B" : "A";
  writeFileSync(exposures, JSON.stringify(data));
  const fixed = check();
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.equal(JSON.parse(fixed.stdout).decisions.mismatched, 0);
  console.log("Verified two swapped accounts despite a balanced exposure report, then verified the corrected log.");
} finally {
  rmSync(exposures, {force: true});
  rmSync(settings, {force: true});
  rmdirSync(directory);
}
