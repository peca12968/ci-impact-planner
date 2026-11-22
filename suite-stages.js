import {relativePath} from "./planner.js";

function duration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function suiteStages(manifest, stages) {
  const setup = manifest.setup_ms;
  if (!setup || typeof setup !== "object" || Array.isArray(setup) ||
      Object.entries(setup).some(([name, ms]) => !name.trim() || !duration(ms))) {
    throw new Error("Expected named fixtures with nonnegative integer setup_ms");
  }

  const byProject = new Map();
  const seen = new Set();
  for (const {name, dir, tests} of manifest.projects) {
    if (!Array.isArray(tests) || !tests.length)
      throw new Error(`Expected test files for project ${name}`);
    for (const file of tests) {
      const path = relativePath(file?.path);
      if (!path.startsWith(dir + "/") || seen.has(path))
        throw new Error(`Duplicate or unowned test path for ${name}: ${path}`);
      if (typeof file.fixture !== "string" || !Object.hasOwn(setup, file.fixture) || !duration(file.fallback_ms))
        throw new Error(`Invalid fixture or fallback_ms for ${path}`);
      seen.add(path);
    }
    byProject.set(name, tests);
  }

  return stages.map(projects => ({
    projects,
    manifest: {setup_ms: setup, files: projects.flatMap(name => byProject.get(name))}
  }));
}
