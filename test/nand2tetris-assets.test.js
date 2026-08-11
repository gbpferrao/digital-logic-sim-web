import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getDescription, createProject, instanceFor, normalizeProject, TYPE } from "../src/model.js";
import { readProjectFile } from "../src/io/project-import.js";
import { Simulator } from "../src/simulation.js";

const root = path.join(process.cwd(), "storage", "nand2tetris");

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

function outputBit(simulator, id, pin = "0") {
  return simulator.snapshot.instances[id]?.signals?.[pin]?.bits & 1;
}

function terminalType(bits, direction) {
  const width = bits === 16 ? 16 : bits === 8 ? 8 : bits === 4 ? 4 : 1;
  return direction === "input" ? TYPE[`IN_${width}`] : TYPE[`OUT_${width}`];
}

function compositeTestProject(customChips, chipName, inputSpecs, outputSpecs, inputValues) {
  const project = createProject(`test ${chipName}`);
  project.customChips = customChips;
  const child = instanceFor(chipName, { x: 0, y: 0 });
  project.root.instances.push(child);
  const inputInstances = [];
  inputSpecs.forEach((spec, index) => {
    const instance = instanceFor(terminalType(spec.bits ?? 1, "input"), { x: -500, y: (index - (inputSpecs.length - 1) / 2) * 80 });
    project.root.instances.push(instance);
    project.inputValues[instance.id] = inputValues[spec.id] ?? 0;
    project.root.wires.push({ id: `input-${spec.id}`, source: { owner: instance.id, pin: "0" }, target: { owner: child.id, pin: spec.id }, points: [] });
    inputInstances.push(instance);
  });
  const outputInstances = [];
  outputSpecs.forEach((spec, index) => {
    const instance = instanceFor(terminalType(spec.bits ?? 1, "output"), { x: 500, y: (index - (outputSpecs.length - 1) / 2) * 80 });
    project.root.instances.push(instance);
    project.root.wires.push({ id: `output-${spec.id}`, source: { owner: child.id, pin: spec.id }, target: { owner: instance.id, pin: "0" }, points: [] });
    outputInstances.push(instance);
  });
  project._revision = 1;
  return { project, outputInstances };
}

test("Nand2Tetris bundle contains the complete hardware progression and software bridge", async () => {
  const manifest = await readJson("manifest.json");
  assert.equal(manifest.hardwareStages.length, 10);
  assert.equal(manifest.softwareStages.length, 8);
  assert.ok(manifest.reference.includes("Nand2Tetris"));
  assert.equal(manifest.chips.filter(entry => !entry.native).length, 44);
  assert.equal(manifest.chips.filter(entry => entry.native).length, 18);
  for (const entry of manifest.chips) {
    const chip = await readJson(entry.file);
    assert.equal(chip.schema, "digital-logic-sim-web/chip/1");
    assert.equal(chip.description.name, entry.name);
    assert.deepEqual(chip.dependencyNames, Object.keys(chip.dependencies));
  }
});

test("standalone Nand2Tetris chip JSONs import with their nested dependencies", async () => {
  for (const file of ["chips/nand.json", "chips/dff.json", "chips/ram8.json", "chips/n2t-nand.json", "chips/n2t-mux.json", "chips/n2t-bit.json", "chips/n2t-alu.json", "chips/n2t-computer.json"]) {
    const raw = await readFile(path.join(root, file), "utf8");
    const project = await readProjectFile({ text: async () => raw });
    assert.ok(project.root.instances.length > 0, file);
    const missing = project.root.instances.filter(instance => !getDescription(project, instance.name));
    assert.deepEqual(missing, [], `${file} should resolve every direct child`);
  }
});

test("new state and memory primitives have explicit clock contracts", () => {
  const project = createProject("DFF contract");
  const data = instanceFor(TYPE.IN_1, { x: -300, y: -80 });
  const clock = instanceFor(TYPE.IN_1, { x: -300, y: 80 });
  const dff = instanceFor(TYPE.DFF, { x: 0, y: 0 });
  const output = instanceFor(TYPE.OUT_1, { x: 300, y: 0 });
  project.root.instances.push(data, clock, dff, output);
  project.inputValues[data.id] = 1;
  project.inputValues[clock.id] = 0;
  project.root.wires.push(
    { id: "d", source: { owner: data.id, pin: "0" }, target: { owner: dff.id, pin: "0" }, points: [] },
    { id: "clock", source: { owner: clock.id, pin: "0" }, target: { owner: dff.id, pin: "1" }, points: [] },
    { id: "q", source: { owner: dff.id, pin: "2" }, target: { owner: output.id, pin: "0" }, points: [] }
  );
  const simulator = new Simulator(project);
  simulator.step();
  assert.equal(outputBit(simulator, output.id), 0);
  project.inputValues[clock.id] = 1;
  simulator.step();
  assert.equal(outputBit(simulator, output.id), 1);
  project.inputValues[data.id] = 0;
  simulator.step();
  assert.equal(outputBit(simulator, output.id), 1, "a high clock level is not a second capture");
  project.inputValues[clock.id] = 0;
  simulator.step();
  project.inputValues[clock.id] = 1;
  simulator.step();
  assert.equal(outputBit(simulator, output.id), 0);
});

test("Nand2Tetris lab projects execute as normal simulator projects", async () => {
  for (const file of await readdir(path.join(root, "projects"))) {
    if (!file.endsWith(".json")) continue;
    const project = normalizeProject(await readJson(`projects/${file}`));
    assert.ok(Object.keys(project.customChips).length >= 40, file);
    assert.doesNotThrow(() => new Simulator(project).step(), file);
  }
});

test("the native Hack CPU executes an A-instruction and a D=A instruction", () => {
  const project = createProject("Hack CPU contract");
  const instruction = instanceFor(TYPE.IN_16, { x: -300, y: -60 });
  const clock = instanceFor(TYPE.IN_1, { x: -300, y: 60 });
  const cpu = instanceFor(TYPE.HACK_CPU, { x: 0, y: 0 });
  const address = instanceFor(TYPE.OUT_16, { x: 300, y: -100 });
  const outM = instanceFor(TYPE.OUT_16, { x: 300, y: 100 });
  project.root.instances.push(instruction, clock, cpu, address, outM);
  project.inputValues[instruction.id] = 5;
  project.inputValues[clock.id] = 0;
  project.root.wires.push(
    { id: "instruction", source: { owner: instruction.id, pin: "0" }, target: { owner: cpu.id, pin: "1" }, points: [] },
    { id: "clock", source: { owner: clock.id, pin: "0" }, target: { owner: cpu.id, pin: "3" }, points: [] },
    { id: "address", source: { owner: cpu.id, pin: "6" }, target: { owner: address.id, pin: "0" }, points: [] },
    { id: "out", source: { owner: cpu.id, pin: "4" }, target: { owner: outM.id, pin: "0" }, points: [] }
  );
  const simulator = new Simulator(project);
  project.inputValues[clock.id] = 1;
  simulator.step();
  assert.equal(simulator.snapshot.instances[address.id].signals["0"].bits, 5);
  project.inputValues[clock.id] = 0;
  simulator.step();
  project.inputValues[instruction.id] = 0xec10;
  project.inputValues[clock.id] = 1;
  simulator.step();
  assert.equal(simulator.snapshot.instances[outM.id].signals["0"].bits, 5);
});

test("the composed routing and arithmetic landmarks preserve their contracts", async () => {
  const source = await readJson("projects/nand2tetris-hardware-lab.json");
  const customChips = normalizeProject(source).customChips;

  for (const [a, b, sel, expected] of [[0, 1, 0, 0], [0, 1, 1, 1], [1, 0, 0, 1], [1, 0, 1, 0]]) {
    const { project, outputInstances } = compositeTestProject(customChips, "N2T MUX", [
      { id: "a", bits: 1 }, { id: "b", bits: 1 }, { id: "sel", bits: 1 }
    ], [{ id: "out", bits: 1 }], { a, b, sel });
    const simulator = new Simulator(project);
    simulator.step();
    assert.equal(outputBit(simulator, outputInstances[0].id), expected, `MUX(${a},${b},${sel})`);
  }

  for (let a = 0; a <= 1; a += 1) for (let b = 0; b <= 1; b += 1) for (let cin = 0; cin <= 1; cin += 1) {
    const { project, outputInstances } = compositeTestProject(customChips, "N2T FULL ADDER", [
      { id: "a", bits: 1 }, { id: "b", bits: 1 }, { id: "cin", bits: 1 }
    ], [{ id: "sum", bits: 1 }, { id: "carry", bits: 1 }], { a, b, cin });
    const simulator = new Simulator(project);
    simulator.step();
    const total = a + b + cin;
    assert.equal(outputBit(simulator, outputInstances[0].id), total & 1, `sum ${a}${b}${cin}`);
    assert.equal(outputBit(simulator, outputInstances[1].id), Number(total > 1), `carry ${a}${b}${cin}`);
  }

  const { project, outputInstances } = compositeTestProject(customChips, "N2T ADD16", [
    { id: "a", bits: 16 }, { id: "b", bits: 16 }, { id: "cin", bits: 1 }
  ], [{ id: "out", bits: 16 }, { id: "cout", bits: 1 }], { a: 0x1234, b: 0x00ff, cin: 1 });
  const simulator = new Simulator(project);
  simulator.step();
  assert.equal(simulator.snapshot.instances[outputInstances[0].id].signals["0"].bits, 0x1334);
  assert.equal(outputBit(simulator, outputInstances[1].id), 0);
});

test("the composed ALU exposes the expected add and zero flags", async () => {
  const source = await readJson("projects/nand2tetris-hardware-lab.json");
  const customChips = normalizeProject(source).customChips;
  const controls = { zx: 0, nx: 0, zy: 0, ny: 0, f: 1, no: 0 };
  const { project, outputInstances } = compositeTestProject(customChips, "N2T ALU", [
    { id: "x", bits: 16 }, { id: "y", bits: 16 }, ...Object.keys(controls).map(id => ({ id, bits: 1 }))
  ], [{ id: "out", bits: 16 }, { id: "zr", bits: 1 }, { id: "ng", bits: 1 }], { x: 5, y: 3, ...controls });
  const simulator = new Simulator(project);
  simulator.step();
  assert.equal(simulator.snapshot.instances[outputInstances[0].id].signals["0"].bits, 8);
  assert.equal(outputBit(simulator, outputInstances[1].id), 0);
  assert.equal(outputBit(simulator, outputInstances[2].id), 0);
});
