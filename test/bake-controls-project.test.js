import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeProject } from "../src/model.js";
import { Simulator, isHigh } from "../src/simulation.js";
import { createSimulationBake, createSimulationController } from "../src/simulation-controller.js";

async function loadProject(file) {
  return normalizeProject(JSON.parse(await readFile(new URL(`../storage/projects/${file}`, import.meta.url), "utf8")));
}

function bakeProject(project, limit = 80) {
  const simulator = new Simulator(project);
  const state = { bake: createSimulationBake(), simRunning: false, simTimer: null, stepCount: 0, speed: 8, preview: null };
  const statuses = [];
  const controller = createSimulationController({
    getProject: () => project,
    getSimulator: () => simulator,
    getState: () => state,
    setStatus: (message) => statuses.push(message),
    render: () => {},
    scheduleCanvasRender: () => {},
    playAudio: () => {}
  });
  controller.startBake();
  if (state.simTimer !== null) {
    clearTimeout(state.simTimer);
    state.simTimer = null;
  }
  for (let step = 0; step < limit && !state.bake.isReady; step += 1) controller.runStep({ renderFrame: false, playAudio: false });
  return { state, statuses };
}

test("bake controls lab has a clear finite visible progression", async () => {
  const project = await loadProject("bake-controls-lab.json");
  const simulator = new Simulator(project);
  const visible = [];
  for (let step = 0; step <= 6; step += 1) {
    if (step > 0) simulator.step();
    const short = isHigh(simulator.snapshot.instances["short-led"].signals["0"]);
    const long = isHigh(simulator.snapshot.instances["long-led"].signals["0"]);
    visible.push(`${short ? 1 : 0}${long ? 1 : 0}`);
  }
  assert.deepEqual(visible, ["00", "11", "11", "01", "01", "01", "00"]);
  assert.ok(project.customChips["TIMED PANEL"]);
});

test("indefinite clock lab keeps producing visible changes", async () => {
  const project = await loadProject("indefinite-clock-lab.json");
  const simulator = new Simulator(project);
  const visible = [];
  for (let step = 0; step <= 8; step += 1) {
    if (step > 0) simulator.step();
    visible.push(isHigh(simulator.snapshot.instances["clock-led"].signals["0"]) ? 1 : 0);
  }
  assert.deepEqual(visible, [0, 0, 1, 1, 0, 0, 1, 1, 0]);
  assert.ok(project.customChips["CLOCK LOOP"]);
});

test("an isolated oscillator does not keep the simple ALU bake alive", async () => {
  const project = await loadProject("simple-alu.json");
  const { state, statuses } = bakeProject(project);
  assert.equal(state.bake.isReady, true);
  assert.equal(state.bake.reason, "static");
  assert.equal(state.stepCount, 0);
  assert.equal(state.bake.latestCheckpoint.step, 0);
  assert.equal(state.bake.length, 1);
  assert.match(statuses.at(-1), /no visible flow detected/);
});

test("a connected indefinite clock still prevents automatic completion", async () => {
  const project = await loadProject("indefinite-clock-lab.json");
  const { state } = bakeProject(project);
  assert.equal(state.bake.isReady, false);
  assert.ok(state.bake.length > 1);
});
