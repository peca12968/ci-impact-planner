function relativePath(value) {
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

export function plan(manifest, changedFiles, fullReason = null) {
  const {projects, dependents} = inspect(manifest);
  const all = new Set(projects.keys());
  const complete = layers(projects, dependents, all);
  const direct = new Set();
  const unowned = new Set();
  for (const file of changedFiles) {
    relativePath(file);
    const owner = manifest.projects.find(p => file === p.dir || file.startsWith(p.dir + "/"));
    if (owner) direct.add(owner.name);
    else unowned.add(file);
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
  return {
    mode: full ? "full" : "affected",
    ...(fullReason ? {fullReason} : {}),
    direct: [...direct].sort(),
    unowned: [...unowned].sort(),
    stages,
    selected: stages.flat().length,
    total: projects.size
  };
}
