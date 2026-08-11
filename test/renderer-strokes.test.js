import assert from "node:assert/strict";
import test from "node:test";
import { canvasStroke, isMinorGridVisible, wireStroke } from "../src/renderer.js";

test("canvas object strokes use world width with a one-pixel viewport floor", () => {
  assert.equal(canvasStroke(1, 1), 2);
  assert.equal(canvasStroke(1, 2), 2);
  assert.equal(canvasStroke(1, 8), 2);
  assert.equal(canvasStroke(1, .25), 4);
});

test("wire strokes preserve their reduced world width and floor when zoomed out", () => {
  assert.equal(wireStroke(2, 1), 3);
  assert.equal(wireStroke(2, 4), 3);
  assert.equal(wireStroke(2, .25), 4);
});

test("minor grid lines disappear once their screen spacing becomes cramped", () => {
  assert.equal(isMinorGridVisible(1), true);
  assert.equal(isMinorGridVisible(.4), true);
  assert.equal(isMinorGridVisible(.39), false);
  assert.equal(isMinorGridVisible(.1), false);
});
