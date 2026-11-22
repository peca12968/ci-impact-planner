import test from "node:test";
import assert from "node:assert/strict";
import {checkText} from "./contrast.mjs";

const evaluate = (foreground, backgrounds, scale = "normal") => checkText({foreground, backgrounds, scale});

test("reference endpoints and text size thresholds", () => {
  assert.equal(evaluate("#000", ["#fff"]).ratio, 21);
  assert.equal(evaluate("#fff", ["#000"]).ratio, 21);
  assert.equal(evaluate("#FFF0", ["#000"]).ratio, 1);
  assert.equal(evaluate("#777", ["#fff"]).passes, false);
  assert.equal(evaluate("#777", ["#fff"], "large").passes, true);
  assert.equal(evaluate("#767676", ["#fff"]).passes, true);
});

test("alpha compositing is applied in paint order before luminance", () => {
  assert.deepEqual(evaluate("#000", ["#fff", "#0008"]), evaluate("#000", ["#777"]));
  assert.deepEqual(evaluate("#fff8", ["#000"]), evaluate("#888", ["#000"]));
  assert.deepEqual(evaluate("#f00", ["#fff", "#000", "#abc0"]), evaluate("#f00", ["#000"]));
  assert.throws(() => evaluate("#000", ["#fff8"]), /opaque/);
});

test("compare the full ratio when a display rounded to two decimals reads 4.50", () => {
  const result = evaluate("#707972", ["#fff"]);
  assert.equal(result.ratio.toFixed(2), "4.50");
  assert.equal(result.passes, false);
});
