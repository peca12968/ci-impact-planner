import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {chromium, firefox} from "playwright";
import {inspectTheme} from "./audit.mjs";

const axe = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const ids = results => results.flatMap(rule => rule.nodes.map(node => node.target[0])).sort();

for (const engine of [chromium, firefox]) {
  const browser = await engine.launch();
  try {
    for (const version of ["before", "after"]) {
      const theme = JSON.parse(readFileSync(new URL(`./examples/${version}.json`, import.meta.url)));
      const page = await browser.newPage();
      await page.setContent('<!doctype html><html lang="en"><title>Delivery text samples</title><body></body></html>');
      await page.evaluate(({text, tokens}) => {
        for (const role of text) {
          let parent = document.body;
          for (const name of role.backgrounds) {
            const layer = document.createElement("div");
            layer.style.backgroundColor = tokens[name];
            parent.append(layer);
            parent = layer;
          }
          const label = document.createElement("span");
          label.id = role.id;
          label.style.color = tokens[role.foreground];
          label.style.fontSize = role.scale === "large" ? "24px" : "16px";
          label.textContent = role.id.replaceAll("-", " ");
          parent.append(label);
        }
      }, theme);
      await page.addScriptTag({path: axe});
      const results = await page.evaluate(() => window.axe.run("span", {runOnly: ["color-contrast"]}));
      const rows = inspectTheme(theme);
      const expected = passes => rows.filter(r => r.passes === passes).map(r => "#" + r.id).sort();
      assert.deepEqual(ids(results.incomplete), []);
      assert.deepEqual(ids(results.violations), expected(false));
      assert.deepEqual(ids(results.passes), expected(true));
      console.log(`${engine.name()} ${version}: matched ${rows.length} text roles (${expected(false).length} failures)`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
