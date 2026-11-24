import test from "node:test";
import assert from "node:assert/strict";
import {compareThemes, inspectTheme} from "./audit.mjs";

const role = (id, foreground) => ({id, foreground, backgrounds: ["paper"], scale: "normal"});
const theme = {tokens: {paper: "#fff", ink: "#333", hint: "#888"},
  text: [role("label", "ink"), role("hint", "hint"), role("old-note", "hint")]};

test("a token edit, a repair, a new failure and a removed role are distinguished", () => {
  const next = structuredClone(theme);
  next.tokens.ink = "#999";
  next.text.pop();
  next.text[1].foreground = "fixed";
  next.tokens.fixed = "#000";
  next.text.push(role("new-note", "ink"));
  const report = compareThemes(theme, next);
  assert.deepEqual(report.rows.map(row => row.status), ["regression", "fixed", "regression"]);
  assert.deepEqual(report.removed, ["old-note"]);
  assert.equal(report.rows[2].previousRatio, null);
  assert.equal(compareThemes(theme, theme).rows[1].status, "existing_failure");
});

test("rejects missing token references and duplicate role IDs", () => {
  assert.throws(() => inspectTheme({...theme, text: [role("badge", "absent")]}), /token/);
  assert.throws(() => inspectTheme({...theme, text: [theme.text[0], theme.text[0]]}), /unique/);
});
