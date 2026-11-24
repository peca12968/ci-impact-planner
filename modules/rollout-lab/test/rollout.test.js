import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  subjectBuckets,
  compilePolicy,
  compareAudience,
} from "../web/rollout.js";

const policy = (rollout, weight = 5000) =>
  compilePolicy({
    rollout,
    variants: [
      { name: "A", weight },
      { name: "B", weight: 10000 - weight },
    ],
  });

test("matches Python's shared Unicode, normalization and punctuation vectors", async () => {
  const cases = JSON.parse(
    await readFile(new URL("../vectors.json", import.meta.url)),
  );
  for (const { flag, subject, exposure, variant } of cases)
    assert.deepEqual(await subjectBuckets(flag, subject), {
      exposure,
      variant,
    });
});

test("uses half-open exposure and variant boundaries at basis-point precision", () => {
  const allocate = policy(2500, 7000);
  assert.equal(allocate({ exposure: 2499, variant: 6999 }), "A");
  assert.equal(allocate({ exposure: 2499, variant: 7000 }), "B");
  assert.equal(allocate({ exposure: 2500, variant: 0 }), null);
  assert.equal(policy(0)({ exposure: 0, variant: 0 }), null);
  assert.equal(policy(10000, 0)({ exposure: 9999, variant: 0 }), "B");
});

test("expanding rollout preserves every already-exposed assignment", async () => {
  const audience = await Promise.all(
    Array.from({ length: 1000 }, async (_, i) => {
      const id = "demo-" + String(i + 1).padStart(4, "0");
      return { id, buckets: await subjectBuckets("checkout-layout", id) };
    }),
  );
  const forward = compareAudience(audience, policy(1000), policy(2500));
  assert.equal(forward.counts.entered, 153);
  assert.equal(forward.counts.exited, 0);
  assert.equal(forward.counts.switched, 0);
  const reverse = compareAudience(audience, policy(2500), policy(1000));
  assert.equal(reverse.counts.exited, forward.counts.entered);
  assert.equal(reverse.counts.unchanged, forward.counts.unchanged);
  assert.equal(
    Object.values(forward.counts).reduce((a, b) => a + b),
    1000,
  );
});

test("changing weights moves variants only inside the exposed population", () => {
  const audience = [
    { id: "switch", buckets: { exposure: 1, variant: 5000 } },
    { id: "keep", buckets: { exposure: 2, variant: 9000 } },
    { id: "off", buckets: { exposure: 9999, variant: 5000 } },
  ];
  const report = compareAudience(
    audience,
    policy(500, 5000),
    policy(500, 6000),
  );
  assert.deepEqual(report.counts, {
    switched: 1,
    unchanged: 2,
    entered: 0,
    exited: 0,
  });
  assert.deepEqual(report.rows[0], {
    id: "switch",
    before: "B",
    after: "A",
    change: "switched",
  });
});

test("rejects invalid policies and malformed inputs", async () => {
  for (const rate of [-1, 10001, 2.5, NaN]) assert.throws(() => policy(rate));
  assert.throws(() =>
    compilePolicy({ rollout: 2, variants: [{ name: "A", weight: 10 }] }),
  );
  assert.throws(() =>
    compilePolicy({
      rollout: 2,
      variants: [
        { name: "A", weight: 5000 },
        { name: "A", weight: 5000 },
      ],
    }),
  );
  assert.throws(() => policy(1)({ exposure: 0, variant: 10000 }));
  for (const value of ["", "   ", "\uD800"])
    await assert.rejects(subjectBuckets("flag", value));
});
