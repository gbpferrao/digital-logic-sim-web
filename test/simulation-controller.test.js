import test from "node:test";
import assert from "node:assert/strict";
import { TYPE, createProject, instanceFor } from "../src/model.js";
import { Simulator } from "../src/simulation.js";
import { createSimulationBake, createSimulationController } from "../src/simulation-controller.js";

function createFixture() {
  const project = createProject("controller");
  const input = instanceFor(TYPE.IN_1, { x: -80, y: 0 });
  const output = instanceFor(TYPE.OUT_1, { x: 80, y: 0 });
  project.root.instances.push(input, output);
  project.inputValues[input.id] = 1;
  project.root.wires.push({
    id: "input-output",
    source: { owner: input.id, pin: "0" },
    target: { owner: output.id, pin: "0" },
    points: []
  });
  project._revision = 1;
  return { project, simulator: new Simulator(project) };
}

function createFixtureController() {
  const fixture = createFixture();
  const state = {
    simRunning: false,
    simTimer: null,
    preview: null,
    stepCount: 0,
    speed: 8,
    bake: createSimulationBake()
  };
  const statuses = [];
  const controller = createSimulationController({
    getProject: () => fixture.project,
    getSimulator: () => fixture.simulator,
    getState: () => state,
    setStatus: (message) => statuses.push(message),
    render: () => {},
    scheduleCanvasRender: () => {},
    touch: () => {},
    playAudio: () => {},
    measure: (_label, action) => action()
  });
  return { ...fixture, state, statuses, controller };
}

test("simulation controller owns the one-shot bake lifecycle", () => {
  const { project, simulator, state, statuses, controller } = createFixtureController();

  controller.resetBake();
  assert.equal(state.bake.status, "empty");
  controller.startBake();
  assert.equal(state.simRunning, true);
  assert.equal(state.bake.isBaking, true);
  controller.finishBake("manual");
  assert.equal(state.simRunning, false);
  assert.equal(state.bake.isReady, true);

  const readyStep = simulator.stepCount;
  controller.runStep();
  assert.equal(simulator.stepCount, readyStep);
  assert.match(statuses.at(-1), /Bake already complete/);

  controller.clearBake();
  assert.equal(state.bake.status, "empty");
  assert.equal(project.settings.simulationPaused, true);
});

test("controller records semantic actions, engine ticks, propagation counts, and carried preview actions", () => {
  const { simulator, state, controller } = createFixtureController();

  controller.step();
  assert.equal(state.bake.isBaking, true);
  assert.ok(state.bake.interactions.some((event) => event.kind === "manual-step"));
  assert.equal(state.bake.traceEvents.length, 1);
  assert.equal(state.bake.traceEvents[0].kind, "engine-tick");
  assert.equal(state.bake.traceEvents[0].step, simulator.stepCount);
  assert.ok(state.bake.traceEvents[0].propagations > 0);
  assert.equal(state.bake.executionFrame.cause, "manual-step");
  assert.equal(state.bake.executionFrame.source, "step-control");
  assert.equal(state.bake.executionFrame.traceStart, 0);
  assert.equal(state.bake.executionFrame.traceEnd, 0);

  controller.clearBake();
  controller.startCausalPreview(
    "input changed",
    { snapshot: simulator.snapshot, step: simulator.stepCount },
    { kind: "input-change", source: "canvas", target: "input-1", before: 0, after: 1 }
  );
  controller.clearPreview();
  controller.step();

  assert.ok(state.bake.interactions.some((event) => event.kind === "input-change"));
});
