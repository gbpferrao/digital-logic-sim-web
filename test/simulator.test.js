import test from "node:test";
import assert from "node:assert/strict";
import { BUILTINS, TYPE, createProject, customFromRoot, instanceFor } from "../src/model.js";
import { Simulator } from "../src/simulation.js";

function addNandCircuit(aValue, bValue) {
  const project = createProject("test");
  const a = instanceFor(TYPE.IN_1, { x: -100, y: -20 });
  const b = instanceFor(TYPE.IN_1, { x: -100, y: 20 });
  const nand = instanceFor(TYPE.NAND, { x: 0, y: 0 });
  const output = instanceFor(TYPE.OUT_1, { x: 100, y: 0 });
  project.root.instances.push(a, b, nand, output);
  project.inputValues[a.id] = aValue;
  project.inputValues[b.id] = bValue;
  project.root.wires.push(
    { id: "a", source: { owner: a.id, pin: "0" }, target: { owner: nand.id, pin: "0" }, points: [] },
    { id: "b", source: { owner: b.id, pin: "0" }, target: { owner: nand.id, pin: "1" }, points: [] },
    { id: "out", source: { owner: nand.id, pin: "2" }, target: { owner: output.id, pin: "0" }, points: [] }
  );
  project._revision = 1;
  return { project, output };
}

function addGateCircuit(name, aValue, bValue = 0) {
  const project = createProject(name);
  const a = instanceFor(TYPE.IN_1, { x: -120, y: -20 });
  const b = instanceFor(TYPE.IN_1, { x: -120, y: 20 });
  const gate = instanceFor(name, { x: 0, y: 0 });
  const output = instanceFor(TYPE.OUT_1, { x: 120, y: 0 });
  project.root.instances.push(a, b, gate, output);
  project.inputValues[a.id] = aValue;
  project.inputValues[b.id] = bValue;
  const unary = [TYPE.NOT, TYPE.BUFFER].includes(name);
  const outputPin = unary ? "1" : "2";
  project.root.wires.push(
    { id: "a", source: { owner: a.id, pin: "0" }, target: { owner: gate.id, pin: "0" }, points: [] },
    ...(!unary ? [{ id: "b", source: { owner: b.id, pin: "0" }, target: { owner: gate.id, pin: "1" }, points: [] }] : []),
    { id: "out", source: { owner: gate.id, pin: outputPin }, target: { owner: output.id, pin: "0" }, points: [] }
  );
  project._revision = 1;
  return { project, output, a, b };
}

test("all reference built-ins can execute one simulation step", () => {
  for (const name of Object.keys(BUILTINS)) {
    const project = createProject(name);
    project.root.instances.push(instanceFor(name));
    project._revision = 1;
    assert.doesNotThrow(() => new Simulator(project).step(), name);
  }
});

test("simulator exposes an evaluated step-zero snapshot and reset returns to it", () => {
  const { project, output } = addNandCircuit(1, 0);
  const simulator = new Simulator(project);
  assert.equal(simulator.stepCount, 0);
  assert.equal(simulator.snapshot.step, 0);
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, 1);

  simulator.step();
  assert.equal(simulator.stepCount, 1);
  simulator.reset();
  assert.equal(simulator.stepCount, 0);
  assert.equal(simulator.snapshot.step, 0);
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, 1);
});

test("NAND propagates a high result for a low input", () => {
  const { project, output } = addNandCircuit(1, 0);
  const simulator = new Simulator(project);
  simulator.step();
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, 1);
});

test("NAND propagates a low result for two high inputs", () => {
  const { project, output } = addNandCircuit(1, 1);
  const simulator = new Simulator(project);
  simulator.step();
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, 0);
});

test("primitive logic gates implement their truth tables", () => {
  const expected = {
    [TYPE.AND]: [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1]],
    [TYPE.OR]: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]],
    [TYPE.NAND]: [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]],
    [TYPE.NOR]: [[0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 1, 0]],
    [TYPE.XOR]: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]],
    [TYPE.XNOR]: [[0, 0, 1], [0, 1, 0], [1, 0, 0], [1, 1, 1]]
  };
  for (const [name, rows] of Object.entries(expected)) {
    for (const [a, b, result] of rows) {
      const { project, output } = addGateCircuit(name, a, b);
      const simulator = new Simulator(project);
      simulator.step();
      assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, result, `${name}(${a},${b})`);
    }
  }
  for (const [name, values] of [[TYPE.NOT, [[0, 1], [1, 0]]], [TYPE.BUFFER, [[0, 0], [1, 1]]]]) {
    for (const [input, result] of values) {
      const { project, output } = addGateCircuit(name, input);
      const simulator = new Simulator(project);
      simulator.step();
      assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, result, `${name}(${input})`);
    }
  }
});

test("combinational circuits recompute after inputs change between steps", () => {
  const { project, output, a, b } = addGateCircuit(TYPE.AND, 0, 0);
  const simulator = new Simulator(project);
  simulator.step();
  project.inputValues[a.id] = 1;
  project.inputValues[b.id] = 1;
  simulator.step();
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, 1);
  project.inputValues[b.id] = 0;
  simulator.step();
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, 0);
});

test("simulation snapshots can be restored and stepped forward again", () => {
  const { project, output, a, b } = addGateCircuit(TYPE.AND, 0, 0);
  const simulator = new Simulator(project);
  simulator.step();
  const firstFrame = simulator.snapshot;
  project.inputValues[a.id] = 1;
  project.inputValues[b.id] = 1;
  simulator.step();
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, 1);
  simulator.restore(firstFrame, 1);
  assert.equal(simulator.stepCount, 1);
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, 0);
  simulator.step();
  assert.equal(simulator.stepCount, 2);
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, 1);
});

test("custom chip descriptions execute recursively", () => {
  const { project } = addNandCircuit(1, 0);
  const custom = customFromRoot(project, "NAND TEST");
  project.customChips[custom.name] = custom;
  const nested = createProject("nested");
  nested.customChips[custom.name] = custom;
  const a = instanceFor(TYPE.IN_1, { x: -100, y: -20 });
  const b = instanceFor(TYPE.IN_1, { x: -100, y: 20 });
  const chip = { id: "custom", name: custom.name, position: { x: 0, y: 0 }, rotation: 0, label: "", internalData: {}, linkedBusPairId: null, outputPinColours: {} };
  const output = instanceFor(TYPE.OUT_1, { x: 100, y: 0 });
  nested.root.instances.push(a, b, chip, output);
  nested.inputValues[a.id] = 1; nested.inputValues[b.id] = 0;
  nested.root.wires.push(
    { id: "a", source: { owner: a.id, pin: "0" }, target: { owner: chip.id, pin: custom.inputPins[0].id }, points: [] },
    { id: "b", source: { owner: b.id, pin: "0" }, target: { owner: chip.id, pin: custom.inputPins[1].id }, points: [] },
    { id: "out", source: { owner: chip.id, pin: custom.outputPins[0].id }, target: { owner: output.id, pin: "0" }, points: [] }
  );
  nested._revision = 1;
  const simulator = new Simulator(nested);
  simulator.step();
  assert.equal(simulator.snapshot.instances[output.id].signals["0"].bits, 1);
});

test("wire junctions propagate a signal to multiple branches", () => {
  const project = createProject("junction");
  const input = instanceFor(TYPE.IN_1, { x: -120, y: 0 });
  const outputA = instanceFor(TYPE.OUT_1, { x: 120, y: -30 });
  const outputB = instanceFor(TYPE.OUT_1, { x: 120, y: 30 });
  const junction = { id: "j1", position: { x: 0, y: 0 }, bits: 1 };
  project.root.instances.push(input, outputA, outputB);
  project.root.junctions.push(junction);
  project.inputValues[input.id] = 1;
  project.root.wires.push(
    { id: "in-junction", source: { owner: input.id, pin: "0" }, target: { owner: "junction", pin: junction.id, junction: true, direction: "input", bits: 1 }, points: [] },
    { id: "junction-a", source: { owner: "junction", pin: junction.id, junction: true, direction: "output", bits: 1 }, target: { owner: outputA.id, pin: "0" }, points: [] },
    { id: "junction-b", source: { owner: "junction", pin: junction.id, junction: true, direction: "output", bits: 1 }, target: { owner: outputB.id, pin: "0" }, points: [] }
  );
  const simulator = new Simulator(project);
  simulator.step();
  assert.equal(simulator.snapshot.instances[outputA.id].signals["0"].bits, 1);
  assert.equal(simulator.snapshot.instances[outputB.id].signals["0"].bits, 1);
});
