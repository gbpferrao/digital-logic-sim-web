import assert from "node:assert/strict";
import test from "node:test";
import { adaptiveGridStep, canvasStroke, clampZoom, isMinorGridVisible, MIN_ZOOM, wireStroke, xrayInterfaceBridgeGeometry } from "../src/renderer.js";
import { TYPE } from "../src/model.js";

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

test("camera zoom supports very large worlds without dropping below the safe floor", () => {
  assert.equal(MIN_ZOOM, .001);
  assert.equal(clampZoom(.00001), MIN_ZOOM);
  assert.equal(clampZoom(100), 8);
  assert.ok(adaptiveGridStep(.001) * .001 >= 8);
});

test("xray bridges composite public ports into their movable interface nodes", () => {
  const description = {
    kind: "custom",
    type: TYPE.CUSTOM,
    size: { x: 400, y: 200 },
    fit: { version: 1, bounds: { x: -200, y: -100, w: 400, h: 200 } },
    inputPins: [{ id: "in", direction: "input", x: -200, y: -20 }],
    outputPins: [{ id: "out", direction: "output", x: 200, y: 20 }],
    instances: [
      { id: "interface-input-in", name: TYPE.IN_1, position: { x: -120, y: -20 }, rotation: 0 },
      { id: "interface-output-out", name: TYPE.OUT_1, position: { x: 120, y: 20 }, rotation: 0 }
    ],
    interfaceBindings: {
      inputs: [{ publicId: "in", instanceId: "interface-input-in", pinId: "0", direction: "input" }],
      outputs: [{ publicId: "out", instanceId: "interface-output-out", pinId: "0", direction: "output" }]
    }
  };
  const project = { root: description, customChips: {} };
  const inputBridge = xrayInterfaceBridgeGeometry(project, description, description.interfaceBindings.inputs[0], .5);
  const outputBridge = xrayInterfaceBridgeGeometry(project, description, description.interfaceBindings.outputs[0], .5);

  assert.ok(inputBridge);
  assert.ok(outputBridge);
  assert.equal(inputBridge.outerPoint.x, -200);
  assert.equal(inputBridge.framePoint.x, -100);
  assert.ok(inputBridge.internalPoint.x > inputBridge.publicPoint.x);
  assert.ok(outputBridge.framePoint.x < outputBridge.outerPoint.x);
  assert.ok(outputBridge.internalPoint.x < outputBridge.publicPoint.x);
  assert.equal(inputBridge.scale, .5);
  assert.equal(outputBridge.scale, .5);
});
