export function relativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0"))
    throw new Error("Expected a nonempty relative path");
  if (value.startsWith("/") || value.includes("\\") || /^[A-Za-z]:/.test(value))
    throw new Error(`Expected a relative Git path: ${value}`);
  if (value.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error(`Invalid Git path: ${value}`);
  return value;
}

function inspect(manifest) {
  if (!Array.isArray(manifest?.projects) || !manifest.projects.length)
    throw new Error("Manifest needs a nonempty projects array");
  const projects = new Map();
  const dirs = [];
  for (const project of manifest.projects) {
    if (!project || typeof project.name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(project.name))
      throw new Error("Invalid project name");
    if (projects.has(project.name)) throw new Error(`Duplicate project: ${project.name}`);
    const dir = relativePath(project.dir) + "/";
    if (dirs.some(other => dir.startsWith(other) || other.startsWith(dir)))
      throw new Error(`Overlapping project directories: ${dir}`);
    if (!Array.isArray(project.dependencies) || new Set(project.dependencies).size !== project.dependencies.length)
      throw new Error(`Expected unique dependencies in ${project.name}`);
    dirs.push(dir);
    projects.set(project.name, project);
  }
  const dependents = new Map([...projects.keys()].map(name => [name, []]));
  for (const {name, dependencies} of projects.values()) {
    for (const dependency of dependencies) {
      if (!projects.has(dependency)) throw new Error(`Unknown dependency of ${name}: ${dependency}`);
      dependents.get(dependency).push(name);
    }
  }
  return {projects, dependents};
}

// Kahn's algorithm, consuming one ready frontier at a time.
function layers(projects, dependents, selected) {
  const pending = new Map();
  for (const name of selected) {
    const count = projects.get(name).dependencies.filter(dep => selected.has(dep)).length;
    pending.set(name, count);
  }
  let ready = [...selected].filter(name => pending.get(name) === 0).sort();
  const stages = [];
  let visited = 0;
  while (ready.length) {
    stages.push(ready);
    visited += ready.length;
    const next = [];
    for (const name of ready) {
      for (const child of dependents.get(name)) {
        if (!pending.has(child)) continue;
        const remaining = pending.get(child) - 1;
        pending.set(child, remaining);
        if (remaining === 0) next.push(child);
      }
    }
    ready = next.sort();
  }
  if (visited !== selected.size) throw new Error("Dependency cycle in project manifest");
  return stages;
}

// Walking upstream once gives each changed owner a shortest route to this test.
function explain(projects, target, filesByOwner, report) {
  if (!projects.has(target)) throw new Error(`Unknown project for --why: ${target}`);
  const distance = new Map([[target, 0]]);
  const next = new Map();
  const queue = [target];
  for (let i = 0; i < queue.length; i++) {
    const child = queue[i];
    const hops = distance.get(child) + 1;
    for (const parent of projects.get(child).dependencies) {
      if (!distance.has(parent)) {
        distance.set(parent, hops);
        next.set(parent, child);
        queue.push(parent);
      } else if (distance.get(parent) === hops && child < next.get(parent)) {
        next.set(parent, child);
      }
    }
  }
  const causes = [];
  for (const owner of report.direct) {
    if (!distance.has(owner)) continue;
    const chain = [owner];
    while (chain.at(-1) !== target) chain.push(next.get(chain.at(-1)));
    causes.push({files: [...filesByOwner.get(owner)].sort(), chain});
  }
  const fullReasons = [];
  if (report.fullReason) fullReasons.push(report.fullReason);
  if (report.unowned.length) fullReasons.push("unowned_paths");
  return {project: target, selected: report.stages.some(stage => stage.includes(target)), causes, fullReasons};
}

export function plan(manifest, changedFiles, fullReason = null, why = null) {
  const {projects, dependents} = inspect(manifest);
  const all = new Set(projects.keys());
  const complete = layers(projects, dependents, all);
  const direct = new Set();
  const filesByOwner = new Map();
  const unowned = new Set();
  for (const file of changedFiles) {
    relativePath(file);
    const owner = manifest.projects.find(p => file === p.dir || file.startsWith(p.dir + "/"));
    if (!owner) {
      unowned.add(file);
      continue;
    }
    direct.add(owner.name);
    if (why !== null) {
      if (!filesByOwner.has(owner.name)) filesByOwner.set(owner.name, new Set());
      filesByOwner.get(owner.name).add(file);
    }
  }
  const full = unowned.size > 0 || fullReason !== null;
  const affected = new Set(direct);
  const queue = [...direct];
  for (let i = 0; i < queue.length; i++) {
    for (const child of dependents.get(queue[i])) {
      if (!affected.has(child)) {
        affected.add(child);
        queue.push(child);
      }
    }
  }
  const stages = full ? complete : layers(projects, dependents, affected);
  const report = {
    mode: full ? "full" : "affected",
    ...(fullReason ? {fullReason} : {}),
    direct: [...direct].sort(),
    unowned: [...unowned].sort(),
    stages,
    selected: stages.flat().length,
    total: projects.size
  };
  if (why !== null) report.why = explain(projects, why, filesByOwner, report);
  return report;
}
