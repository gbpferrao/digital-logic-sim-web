import assert from "node:assert/strict";
import test from "node:test";
import { adaptiveGridStep, canvasStroke, clampZoom, isMinorGridVisible, MIN_ZOOM, wireStroke, WorldRenderer, xrayInterfaceBridgeGeometry } from "../src/renderer.js";
import { BUILTINS, TYPE } from "../src/model.js";

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

test("xray hover resolves the deepest visible chip name", () => {
  const previousResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
  };
  const canvas = {
    parentElement: {},
    getContext: () => ({}),
    getBoundingClientRect: () => ({ width: 800, height: 600 })
  };
  const renderer = new WorldRenderer(canvas);
  const inner = {
    kind: "custom",
    type: TYPE.CUSTOM,
    name: "Deep group",
    size: { x: 100, y: 60 },
    fit: { version: 1, bounds: { x: -50, y: -30, w: 100, h: 60 } },
    instances: [{ id: "leaf", name: TYPE.AND, position: { x: 0, y: 0 }, rotation: 0 }],
    inputPins: [],
    outputPins: [],
    wires: []
  };
  const outer = {
    kind: "custom",
    type: TYPE.CUSTOM,
    name: "Outer group",
    size: { x: 180, y: 120 },
    fit: { version: 1, bounds: { x: -90, y: -60, w: 180, h: 120 } },
    instances: [{ id: "inner", name: inner.name, position: { x: 0, y: 0 }, rotation: 0 }],
    inputPins: [],
    outputPins: [],
    wires: []
  };
  const project = {
    _revision: 0,
    customChips: { [outer.name]: outer, [inner.name]: inner },
    root: {
      kind: "custom",
      type: TYPE.CUSTOM,
      name: "Main",
      size: { x: 220, y: 140 },
      fit: { version: 1, bounds: { x: -110, y: -70, w: 220, h: 140 } },
      instances: [{ id: "outer", name: outer.name, position: { x: 0, y: 0 }, rotation: 0 }],
      inputPins: [],
      outputPins: [],
      wires: []
    }
  };

  try {
    assert.equal(renderer.findXrayHoverTarget(project, { x: 0, y: 0 })?.name, BUILTINS[TYPE.AND].name);
    assert.equal(renderer.findXrayHoverTarget(project, { x: 70, y: 0 })?.name, outer.name);
  } finally {
    if (previousResizeObserver) globalThis.ResizeObserver = previousResizeObserver;
    else delete globalThis.ResizeObserver;
  }
});
