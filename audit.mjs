import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import {checkText} from "./contrast.mjs";

export function inspectTheme(theme) {
  if (!theme?.tokens || typeof theme.tokens !== "object" || Array.isArray(theme.tokens) ||
      !Array.isArray(theme.text) || !theme.text.length) {
    throw new Error("Expected a tokens object and a nonempty text inventory");
  }
  const resolve = name => {
    if (typeof name !== "string" || !Object.hasOwn(theme.tokens, name))
      throw new Error(`Unknown color token: ${name}`);
    return theme.tokens[name];
  };
  const seen = new Set();
  return theme.text.map(entry => {
    if (typeof entry?.id !== "string" || !entry.id.trim() || seen.has(entry.id))
      throw new Error("Each text role needs a unique nonempty id");
    if (!Array.isArray(entry.backgrounds)) throw new Error(`Missing backgrounds for ${entry.id}`);
    seen.add(entry.id);
    const foreground = {token: entry.foreground, color: resolve(entry.foreground)};
    const backgrounds = entry.backgrounds.map(token => ({token, color: resolve(token)}));
    const result = checkText({foreground: foreground.color,
      backgrounds: backgrounds.map(layer => layer.color), scale: entry.scale});
    return {id: entry.id, foreground, backgrounds, ...result};
  });
}

export function compareThemes(before, after) {
  const previous = new Map(inspectTheme(before).map(row => [row.id, row]));
  const current = inspectTheme(after);
  const rows = current.map(row => {
    const old = previous.get(row.id);
    previous.delete(row.id);
    let status = row.passes ? "passing" : "regression";
    if (old && !old.passes) status = row.passes ? "fixed" : "existing_failure";
    return {...row, previousRatio: old?.ratio ?? null, status};
  });
  return {rows, removed: [...previous.keys()]};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const paths = process.argv.slice(2);
    if (paths.length !== 1 && paths.length !== 2)
      throw new Error("Usage: node audit.mjs [BASE_THEME.json] CURRENT_THEME.json");
    const themes = paths.map(path => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")));
    const comparing = themes.length === 2;
    const report = comparing ? compareThemes(...themes) : {rows: inspectTheme(themes[0])};
    console.log(JSON.stringify(report, null, 2));
    if (report.rows.some(row => comparing ? row.status === "regression" : !row.passes))
      process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
