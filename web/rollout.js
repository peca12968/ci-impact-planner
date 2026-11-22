// The flag and subject identify an allocation across both policies.
const encoder = new TextEncoder();

export function normalizeIdentifier(value) {
  if (typeof value !== "string" || !value.trim() || !value.isWellFormed()) {
    throw new TypeError("Expected a nonempty Unicode identifier");
  }
  return value.normalize("NFC");
}

async function bucket(domain, flag, subject) {
  const bytes = encoder.encode(JSON.stringify([1, domain, flag, subject]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const prefix = new DataView(digest).getUint32(0, false);
  return Math.floor((prefix * 10000) / 2 ** 32);
}

export async function subjectBuckets(flag, subject) {
  const key = normalizeIdentifier(flag);
  const id = normalizeIdentifier(subject);
  const [exposure, variant] = await Promise.all([
    bucket("exposure", key, id),
    bucket("variant", key, id),
  ]);
  return { exposure, variant };
}

function checkBasisPoints(value) {
  if (!Number.isInteger(value) || value < 0 || value > 10000)
    throw new RangeError("Expected integer basis points between 0 and 10000");
}

export function preparePolicy({ rollout, variants }) {
  checkBasisPoints(rollout);
  if (!Array.isArray(variants) || !variants.length)
    throw new Error("Expected at least one variant");
  const seen = new Set();
  let end = 0;
  const ranges = variants.map(({ name, weight }) => {
    checkBasisPoints(weight);
    if (typeof name !== "string" || !name.trim() || seen.has(name))
      throw new Error("Expected unique nonempty variant names");
    seen.add(name);
    end += weight;
    return { name, end };
  });
  if (end !== 10000) throw new Error("Variant weights must sum to 10000");
  function assign({ exposure, variant }) {
    if (
      ![exposure, variant].every(
        (n) => Number.isInteger(n) && n >= 0 && n < 10000,
      )
    )
      throw new Error("Invalid subject bucket");
    if (exposure >= rollout) return null;
    return ranges.find((range) => variant < range.end).name;
  }
  return { rollout, ranges, assign };
}

export function compilePolicy(policy) {
  return preparePolicy(policy).assign;
}

export function compareAudience(audience, current, proposed) {
  const counts = { entered: 0, exited: 0, switched: 0, unchanged: 0 };
  const rows = audience.map(({ id, buckets }) => {
    const before = current(buckets);
    const after = proposed(buckets);
    let change = "unchanged";
    if (before !== after) {
      change =
        before === null ? "entered" : after === null ? "exited" : "switched";
    }
    counts[change]++;
    return { id, before, after, change };
  });
  return { counts, rows };
}
