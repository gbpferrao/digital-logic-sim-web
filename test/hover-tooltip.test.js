import assert from "node:assert/strict";
import test from "node:test";
import { hoverTooltipPosition } from "../src/ui/hover-tooltip.js";

test("hover tooltip stays southeast of the cursor inside the viewport", () => {
  assert.deepEqual(hoverTooltipPosition({
    cursor: { x: 100, y: 120 },
    width: 140,
    height: 24,
    viewportWidth: 800,
    viewportHeight: 600
  }), { x: 112, y: 132 });
});

test("hover tooltip clamps to the canvas edge without changing its anchor rule", () => {
  assert.deepEqual(hoverTooltipPosition({
    cursor: { x: 790, y: 590 },
    width: 140,
    height: 24,
    viewportWidth: 800,
    viewportHeight: 600
  }), { x: 652, y: 568 });
});
