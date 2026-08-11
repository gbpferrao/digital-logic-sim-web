import assert from "node:assert/strict";
import test from "node:test";
import { createHoverTooltipController, hoverTooltipPosition } from "../src/ui/hover-tooltip.js";

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

test("hover tooltip waits for a stationary pointer and hides on movement", async () => {
  const classes = new Set(["hidden"]);
  const element = {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    style: {},
    textContent: "",
    setAttribute(name, value) { this[name] = value; },
    getBoundingClientRect: () => ({ width: 120, height: 24 })
  };
  const container = { clientWidth: 800, clientHeight: 600 };
  const tooltip = createHoverTooltipController({ element, container, revealDelay: 20 });

  tooltip.move({ x: 100, y: 120 });
  tooltip.setName("AND", { x: 100, y: 120 });
  assert.equal(classes.has("visible"), false);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(classes.has("visible"), true);
  assert.equal(element.style.transform, "translate3d(112px, 132px, 0)");

  tooltip.move({ x: 108, y: 128 });
  assert.equal(classes.has("visible"), false);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(classes.has("visible"), false, "movement must wait for a new stationary period");

  tooltip.setName("AND", { x: 108, y: 128 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(classes.has("visible"), true);
});
