import { normalizeIdentifier, preparePolicy, subjectBuckets } from "./rollout.js";

const width = 10000;
const total = width * width;

function checkFields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected a ${label} object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
}

export function compilePlan(plan) {
  checkFields(plan, ["flag", "stages", "limits"], "plan");
  const flag = normalizeIdentifier(plan.flag);
  if (!Array.isArray(plan.stages) || plan.stages.length < 2)
    throw new Error("Expected a baseline and at least one subsequent stage");
  const names = new Set();
  const stages = plan.stages.map(stage => {
    checkFields(stage, ["name", "rollout", "variants"], "stage");
    const { name, rollout, variants } = stage;
    if (typeof name !== "string" || !name.trim() || names.has(name))
      throw new Error("Expected unique nonempty stage names");
    names.add(name);
    if (Array.isArray(variants))
      for (const variant of variants) checkFields(variant, ["name", "weight"], "variant");
    return { name, ...preparePolicy({ rollout, variants }) };
  });
  return { flag, stages };
}

function checkLimits(limits, steps, everChanged, finalChanged) {
  if (!limits || typeof limits !== "object" || Array.isArray(limits))
    throw new Error("Expected a limits object");
  const violations = [];
  for (const [key, bps] of Object.entries(limits)) {
    if (!Number.isInteger(bps) || bps < 0 || bps > width)
      throw new Error(`Invalid limit in basis points: ${key}`);
    const allowedPairs = bps * width;
    function check(actualPairs, stage) {
      if (actualPairs > allowedPairs)
        violations.push({ limit: key, allowedPairs, actualPairs, ...(stage ? { stage } : {}) });
    }
    switch (key) {
      case "maxEverChangedBps": check(everChanged); break;
      case "maxFinalChangedBps": check(finalChanged); break;
      case "maxSwitchedBpsPerStep":
        for (const step of steps) check(step.switched, step.to);
        break;
      default: throw new Error(`Unknown limit: ${key}`);
    }
  }
  return violations;
}

export async function analyzePlan(plan, subject) {
  const { flag, stages } = compilePlan(plan);
  const baseline = stages[0], last = stages.at(-1);
  const boundaries = new Set([0, width]);
  let minRollout = width, maxRollout = 0;
  for (const stage of stages) {
    minRollout = Math.min(minRollout, stage.rollout);
    maxRollout = Math.max(maxRollout, stage.rollout);
    for (const range of stage.ranges) boundaries.add(range.end);
  }
  const cuts = [...boundaries].sort((a, b) => a - b);
  const steps = stages.slice(1).map((next, i) => ({
    from: stages[i].name, to: next.name,
    entered: Math.max(0, next.rollout - stages[i].rollout) * width,
    exited: Math.max(0, stages[i].rollout - next.rollout) * width,
    switched: 0, unchanged: 0,
  }));

  // Between exposure extremes, some stage is off and another is on.
  // Below the minimum every stage is on, so only variant names can change.
  let everChanged = (maxRollout - minRollout) * width;
  let finalChanged = Math.abs(last.rollout - baseline.rollout) * width;
  const cursors = stages.map(() => 0);
  for (let b = 0; b + 1 < cuts.length; b++) {
    const span = cuts[b + 1] - cuts[b];
    const variants = stages.map((stage, i) => {
      while (stage.ranges[cursors[i]].end <= cuts[b]) cursors[i]++;
      return stage.ranges[cursors[i]].name;
    });
    if (variants.some(v => v !== variants[0])) everChanged += minRollout * span;
    if (variants.at(-1) !== variants[0]) finalChanged += Math.min(last.rollout, baseline.rollout) * span;
    for (let i = 0; i < steps.length; i++) {
      if (variants[i] !== variants[i + 1])
        steps[i].switched += Math.min(stages[i].rollout, stages[i + 1].rollout) * span;
    }
  }
  for (const step of steps) step.unchanged = total - step.entered - step.exited - step.switched;
  const violations = checkLimits(plan.limits === undefined ? {} : plan.limits, steps, everChanged, finalChanged);
  const report = { flag, totalPairs: total, steps, everChanged, finalChanged,
    returnedToBaseline: everChanged - finalChanged, violations };
  if (subject !== undefined) {
    const buckets = await subjectBuckets(flag, subject);
    report.subject = { id: subject, buckets,
      path: stages.map(stage => ({ stage: stage.name, variant: stage.assign(buckets) })) };
  }
  return report;
}
