import test from "node:test";
import assert from "node:assert/strict";
import { TYPE, createProject, instanceFor } from "../src/model.js";
import { Simulator } from "../src/simulation.js";
import { SimulationPreview } from "../src/simulation-preview.js";

function addAndCircuit() {
  const project = createProject("preview");
  const inputA = instanceFor(TYPE.IN_1, { x: -120, y: -20 });
  const inputB = instanceFor(TYPE.IN_1, { x: -120, y: 20 });
  const gate = instanceFor(TYPE.AND, { x: 0, y: 0 });
  const output = instanceFor(TYPE.OUT_1, { x: 120, y: 0 });
  project.root.instances.push(inputA, inputB, gate, output);
  project.inputValues[inputA.id] = 0;
  project.inputValues[inputB.id] = 1;
  project.root.wires.push(
    { id: "a", source: { owner: inputA.id, pin: "0" }, target: { owner: gate.id, pin: "0" }, points: [] },
    { id: "b", source: { owner: inputB.id, pin: "0" }, target: { owner: gate.id, pin: "1" }, points: [] },
    { id: "out", source: { owner: gate.id, pin: "2" }, target: { owner: output.id, pin: "0" }, points: [] }
  );
  project._revision = 1;
  return { project, inputA, output };
}

test("causal preview advances a clone and leaves the official simulator untouched", () => {
  const { project, inputA, output } = addAndCircuit();
  const simulator = new Simulator(project);
  simulator.step();
  const officialStep = simulator.stepCount;
  const officialOutput = simulator.snapshot.instances[output.id].signals["0"].bits;

  project.inputValues[inputA.id] = 1;
  const preview = new SimulationPreview({
    project,
    simulator,
    stabilityWindow: 2,
    maxSteps: 10,
    signature: (snapshot) => String(snapshot.instances[output.id].signals["0"].bits)
  });

  preview.advance();
  assert.equal(preview.simulator.snapshot.instances[output.id].signals["0"].bits, 1);
  assert.equal(simulator.stepCount, officialStep);
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, officialOutput);
  assert.equal(preview.finished, false);

  preview.advance();
  preview.advance();
  assert.equal(preview.finished, true);
  assert.equal(preview.reason, "stable");
  assert.equal(simulator.stepCount, officialStep);
  assert.equal(project.inputValues[inputA.id], 1);
  preview.dispose();
});
