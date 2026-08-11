import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { annotationBoundingBox, chipBoundingBox, getDescription, createProject, instanceFor, normalizeProject, TYPE } from "../src/model.js";
import { readProjectFile } from "../src/io/project-import.js";
import { Simulator } from "../src/simulation.js";

const root = path.join(process.cwd(), "storage", "nand2tetris");
const nativeRoot = path.join(process.cwd(), "storage", "nand2tetris-native");

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(root, relative), "utf8"));
}

async function readNativeJson(relative) {
  return JSON.parse(await readFile(path.join(nativeRoot, relative), "utf8"));
}

function outputBit(simulator, id, pin = "0") {
  return simulator.snapshot.instances[id]?.signals?.[pin]?.bits & 1;
}

function terminalType(bits, direction) {
  const width = bits === 16 || bits === 15 ? 16 : bits === 8 ? 8 : bits === 4 ? 4 : 1;
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
  assert.equal(manifest.hardwareStages.length, 11);
  assert.equal(manifest.softwareStages.length, 8);
  assert.ok(manifest.reference.includes("Nand2Tetris"));
  assert.equal(manifest.chips.filter(entry => !entry.native).length, 59);
  assert.equal(manifest.chips.filter(entry => entry.native).length, 19);
  const chipNames = new Set(manifest.chips.map(entry => entry.name));
  for (const stage of manifest.hardwareStages) for (const name of stage.chips) assert.ok(chipNames.has(name), `${name} is present in ${stage.id}`);
  for (const entry of manifest.chips) {
    const chip = await readJson(entry.file);
    assert.equal(chip.schema, "digital-logic-sim-web/chip/1");
    assert.equal(chip.description.name, entry.name);
    assert.deepEqual(chip.dependencyNames, Object.keys(chip.dependencies));
  }
});

test("Nand2Tetris Boolean composites use native NAND leaves without redundant wrapper layers", async () => {
  const logicChips = [
    ["N2T NOT", "n2t-not.json"],
    ["N2T AND", "n2t-and.json"],
    ["N2T OR", "n2t-or.json"],
    ["N2T XOR", "n2t-xor.json"]
  ];
  for (const [name, file] of logicChips) {
    const chip = await readJson(`chips/${file}`);
    assert.equal(chip.description.name, name);
    assert.equal(chip.description.instances.some(instance => instance.name === "N2T NAND"), false, `${name} should not nest the wrapper`);
    const nativeNands = chip.description.instances.filter(instance => instance.name === TYPE.NAND);
    assert.ok(nativeNands.length > 0, `${name} should use native NAND`);
    const nandIds = new Set(nativeNands.map(instance => String(instance.id)));
    for (const wire of chip.description.wires) {
      for (const endpoint of [wire.source, wire.target]) {
        if (nandIds.has(String(endpoint.owner))) assert.ok(["0", "1", "2"].includes(String(endpoint.pin)), `${name} has a non-native NAND pin endpoint`);
      }
    }
  }

  for (const directory of ["chips", "projects"]) {
    for (const file of await readdir(path.join(root, directory))) {
      if (!file.endsWith(".json")) continue;
      const raw = await readJson(`${directory}/${file}`);
      const descriptions = [];
      if (raw.description) descriptions.push(raw.description);
      if (raw.root) descriptions.push(raw.root);
      descriptions.push(...Object.values(raw.customChips ?? {}), ...Object.values(raw.dependencies ?? {}));
      for (const description of descriptions) {
        assert.equal((description.instances ?? []).some(instance => instance.name === "N2T NAND"), false, `${directory}/${file} should not use N2T NAND as a nested implementation`);
      }
    }
  }
});

test("the native-primitives Nand2Tetris variant replaces exact basic wrappers and preserves contracts", async () => {
  const manifest = await readNativeJson("manifest.json");
  assert.equal(manifest.variant, "native-primitives");
  assert.equal(manifest.sourceTrack, "nand2tetris");
  assert.equal(manifest.hardwareStages.length, 11);
  assert.equal(manifest.softwareStages.length, 8);
  assert.equal(manifest.chips.filter(entry => !entry.native).length, 59);
  assert.equal(manifest.chips.filter(entry => entry.native).length, 19);
  assert.deepEqual(
    manifest.nativeSubstitutions.map(({ from, name }) => [from, name]),
    [
      ["N2T NAND", "NAND"], ["N2T NOT", "NOT"], ["N2T AND", "AND"], ["N2T OR", "OR"],
      ["N2T XOR", "XOR"], ["N2T NOR", "NOR"], ["N2T XNOR", "XNOR"],
      ["N2T BUFFER", "BUFFER"], ["N2T TRI-STATE", "3-STATE BUFFER"]
    ]
  );

  const nativePins = {
    NAND: new Set(["0", "1", "2"]),
    NOT: new Set(["0", "1"]),
    AND: new Set(["0", "1", "2"]),
    OR: new Set(["0", "1", "2"]),
    XOR: new Set(["0", "1", "2"]),
    NOR: new Set(["0", "1", "2"]),
    XNOR: new Set(["0", "1", "2"]),
    BUFFER: new Set(["0", "1"]),
    "3-STATE BUFFER": new Set(["0", "1", "2"])
  };
  const replacedNames = new Set(Object.keys({
    "N2T NAND": true,
    "N2T NOT": true,
    "N2T AND": true,
    "N2T OR": true,
    "N2T XOR": true,
    "N2T NOR": true,
    "N2T XNOR": true,
    "N2T BUFFER": true,
    "N2T TRI-STATE": true
  }));

  for (const entry of manifest.chips) {
    const raw = await readNativeJson(entry.file);
    assert.equal(raw.description.name, entry.name);
    assert.deepEqual(raw.dependencyNames, Object.keys(raw.dependencies));
    const descriptions = [raw.description, ...Object.values(raw.dependencies ?? {})];
    for (const description of descriptions) {
      const instances = new Map((description.instances ?? []).map(instance => [String(instance.id), instance]));
      for (const instance of description.instances ?? []) {
        assert.equal(replacedNames.has(instance.name), false, `${entry.file} still uses ${instance.name} as an internal instance`);
        const validPins = nativePins[instance.name];
        if (!validPins) continue;
        for (const wire of description.wires ?? []) {
          for (const endpoint of [wire.source, wire.target]) {
            if (String(endpoint.owner) !== String(instance.id)) continue;
            assert.ok(validPins.has(String(endpoint.pin)), `${entry.file}/${description.name} has an invalid ${instance.name} pin ${endpoint.pin}`);
          }
        }
      }
      for (const instance of description.instances ?? []) {
        if (!nativePins[instance.name]) continue;
        assert.ok(instances.has(String(instance.id)));
      }
    }
  }

  for (const file of ["projects/nand2tetris-bit-lab.json", "projects/nand2tetris-hardware-lab.json", "projects/nand2tetris-computer-lab.json"]) {
    const project = normalizeProject(await readNativeJson(file));
    assert.equal(project.variant, "native-primitives");
    const missing = project.root.instances.filter(instance => !getDescription(project, instance.name));
    assert.deepEqual(missing, [], `${file} should resolve every direct child`);
    assert.doesNotThrow(() => new Simulator(project).step(), file);
  }
});

test("the native-primitives variant keeps composed behavior executable", async () => {
  const source = await readNativeJson("projects/nand2tetris-hardware-lab.json");
  const customChips = normalizeProject(source).customChips;

  for (const [a, b, sel, expected] of [[0, 1, 0, 0], [0, 1, 1, 1], [1, 0, 0, 1], [1, 0, 1, 0]]) {
    const { project, outputInstances } = compositeTestProject(customChips, "N2T MUX", [
      { id: "a", bits: 1 }, { id: "b", bits: 1 }, { id: "sel", bits: 1 }
    ], [{ id: "out", bits: 1 }], { a, b, sel });
    const simulator = new Simulator(project);
    simulator.step();
    assert.equal(outputBit(simulator, outputInstances[0].id), expected, `native MUX(${a},${b},${sel})`);
  }

  for (let a = 0; a <= 1; a += 1) for (let b = 0; b <= 1; b += 1) for (let cin = 0; cin <= 1; cin += 1) {
    const { project, outputInstances } = compositeTestProject(customChips, "N2T FULL ADDER", [
      { id: "a", bits: 1 }, { id: "b", bits: 1 }, { id: "cin", bits: 1 }
    ], [{ id: "sum", bits: 1 }, { id: "carry", bits: 1 }], { a, b, cin });
    const simulator = new Simulator(project);
    simulator.step();
    const total = a + b + cin;
    assert.equal(outputBit(simulator, outputInstances[0].id), total & 1, `native sum ${a}${b}${cin}`);
    assert.equal(outputBit(simulator, outputInstances[1].id), Number(total > 1), `native carry ${a}${b}${cin}`);
  }
});

test("Nand2Tetris compositions are collision-free after leaf-to-root layout", async () => {
  for (const file of ["projects/nand2tetris-bit-lab.json", "projects/nand2tetris-hardware-lab.json", "projects/nand2tetris-computer-lab.json"]) {
    const project = normalizeProject(await readJson(file));
    const descriptions = [["root", project.root], ...Object.entries(project.customChips)];
    for (const [name, description] of descriptions) {
      const boxes = description.instances.map((instance) => ({ instance, box: chipBoundingBox(project, instance) }));
      for (let index = 0; index < boxes.length; index += 1) {
        for (let other = index + 1; other < boxes.length; other += 1) {
          const a = boxes[index].box;
          const b = boxes[other].box;
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          assert.ok(!(overlapX > 1 && overlapY > 1), `${file} / ${name}: ${boxes[index].instance.id} overlaps ${boxes[other].instance.id}`);
        }
      }
      for (const annotation of description.annotations ?? []) {
        const note = annotationBoundingBox(annotation);
        for (const { instance, box } of boxes) {
          const overlapX = Math.min(note.x + note.w, box.x + box.w) - Math.max(note.x, box.x);
          const overlapY = Math.min(note.y + note.h, box.y + box.h) - Math.max(note.y, box.y);
          assert.ok(!(overlapX > 1 && overlapY > 1), `${file} / ${name}: annotation overlaps ${instance.id}`);
        }
      }
    }
  }
});

test("standalone Nand2Tetris chip JSONs import with their nested dependencies", async () => {
  for (const file of ["chips/nand.json", "chips/dff.json", "chips/ram8.json", "chips/n2t-nand.json", "chips/n2t-mux.json", "chips/n2t-bit.json", "chips/n2t-alu.json", "chips/n2t-instruction-rom.json", "chips/n2t-jump-control.json", "chips/n2t-cpu-memory.json", "chips/n2t-cpu.json", "chips/n2t-computer.json"]) {
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

test("the composed Hack CPU executes an A-instruction and a D=A instruction", async () => {
  const source = await readJson("projects/nand2tetris-hardware-lab.json");
  const customChips = normalizeProject(source).customChips;
  const { project, outputInstances } = compositeTestProject(customChips, "N2T CPU", [
    { id: "inM", bits: 16 }, { id: "instruction", bits: 16 }, { id: "reset", bits: 1 }, { id: "clock", bits: 1 }
  ], [
    { id: "outM", bits: 16 }, { id: "writeM", bits: 1 }, { id: "addressM", bits: 15 }, { id: "pc", bits: 15 }
  ], { inM: 0, instruction: 5, reset: 0, clock: 0 });
  const simulator = new Simulator(project);
  const instructionInput = project.root.instances.find(instance => instance.name === TYPE.IN_16 && project.inputValues[instance.id] === 5);
  const clockInput = project.root.instances.filter(instance => instance.name === TYPE.IN_1)[1];
  project.inputValues[clockInput.id] = 1;
  simulator.step();
  assert.equal(simulator.snapshot.instances[outputInstances[2].id].signals["0"].bits, 5);
  project.inputValues[clockInput.id] = 0;
  simulator.step();
  project.inputValues[instructionInput.id] = 0xec10;
  project.inputValues[clockInput.id] = 1;
  simulator.step();
  assert.equal(simulator.snapshot.instances[outputInstances[0].id].signals["0"].bits, 5);
});

test("the composed computer fetches instructions from its instruction ROM", async () => {
  const project = normalizeProject(await readJson("projects/nand2tetris-computer-lab.json"));
  const rom = project.customChips["N2T ROM32K"];
  rom.instances.find(instance => instance.name === TYPE.ROM_32K).internalData.memory = [5, 0xec10];
  project.inputValues.clock = 0;
  project.inputValues.reset = 0;
  const simulator = new Simulator(project);
  project.inputValues.clock = 1;
  simulator.step();
  assert.equal(simulator.snapshot.instances.pc.signals["0"].bits, 1);
  assert.equal(simulator.snapshot.instances.address.signals["0"].bits, 5);
  project.inputValues.clock = 0;
  simulator.step();
  project.inputValues.clock = 1;
  simulator.step();
  assert.equal(simulator.snapshot.instances.pc.signals["0"].bits, 2);
  assert.equal(simulator.snapshot.instances.computer.signals.outM.bits, 5);
});

test("the composed memory address decoder selects Hack device ranges", async () => {
  const source = await readJson("projects/nand2tetris-hardware-lab.json");
  const customChips = normalizeProject(source).customChips;
  for (const [address, expected] of [[0x0000, [1, 0, 0]], [0x4000, [0, 1, 0]], [0x6000, [0, 0, 1]], [0x6001, [0, 0, 0]]]) {
    const { project, outputInstances } = compositeTestProject(customChips, "N2T MEMORY-ADDRESS-DECODER", [
      { id: "address", bits: 15 }
    ], [
      { id: "ram", bits: 1 }, { id: "screen", bits: 1 }, { id: "keyboard", bits: 1 }
    ], { address });
    const simulator = new Simulator(project);
    simulator.step();
    expected.forEach((value, index) => assert.equal(outputBit(simulator, outputInstances[index].id), value, `address ${address.toString(16)} output ${index}`));
  }
});

test("the remaining Nand2Tetris landmarks preserve their contracts", async () => {
  const source = await readJson("projects/nand2tetris-hardware-lab.json");
  const customChips = normalizeProject(source).customChips;

  for (const sel of [0, 1]) {
    const { project, outputInstances } = compositeTestProject(customChips, "N2T DMUX16", [
      { id: "in", bits: 16 }, { id: "sel", bits: 1 }
    ], [{ id: "a", bits: 16 }, { id: "b", bits: 16 }], { in: 0xa55a, sel });
    const simulator = new Simulator(project);
    simulator.step();
    assert.equal(simulator.snapshot.instances[outputInstances[0].id].signals["0"].bits, sel ? 0 : 0xa55a);
    assert.equal(simulator.snapshot.instances[outputInstances[1].id].signals["0"].bits, sel ? 0xa55a : 0);
  }

  for (const [input, expected] of [[0, 0], [1, 0xffff], [0x8000, 0x8000], [0x1234, 0xedcc]]) {
    const { project, outputInstances } = compositeTestProject(customChips, "N2T NEG16", [
      { id: "in", bits: 16 }
    ], [{ id: "out", bits: 16 }], { in: input });
    const simulator = new Simulator(project);
    simulator.step();
    assert.equal(simulator.snapshot.instances[outputInstances[0].id].signals["0"].bits, expected, `NEG16(${input.toString(16)})`);
  }

  const counter = compositeTestProject(customChips, "N2T COUNTER", [
    { id: "in", bits: 16 }, { id: "load", bits: 1 }, { id: "inc", bits: 1 }, { id: "clock", bits: 1 }
  ], [{ id: "out", bits: 16 }], { in: 0x1234, load: 0, inc: 1, clock: 0 });
  const counterInputs = counter.project.root.instances.filter(instance => [TYPE.IN_1, TYPE.IN_16].includes(instance.name));
  const counterClock = counterInputs[3];
  const counterLoad = counterInputs[1];
  const counterInc = counterInputs[2];
  const counterSimulator = new Simulator(counter.project);
  counter.project.inputValues[counterClock.id] = 1;
  counterSimulator.step();
  assert.equal(counterSimulator.snapshot.instances[counter.outputInstances[0].id].signals["0"].bits, 1);
  counter.project.inputValues[counterClock.id] = 0;
  counterSimulator.step();
  counter.project.inputValues[counterClock.id] = 1;
  counterSimulator.step();
  assert.equal(counterSimulator.snapshot.instances[counter.outputInstances[0].id].signals["0"].bits, 2);
  counter.project.inputValues[counterClock.id] = 0;
  counter.project.inputValues[counterLoad.id] = 1;
  counter.project.inputValues[counterInc.id] = 0;
  counterSimulator.step();
  counter.project.inputValues[counterClock.id] = 1;
  counterSimulator.step();
  assert.equal(counterSimulator.snapshot.instances[counter.outputInstances[0].id].signals["0"].bits, 0x1234);

  const expectedJump = [false, value => !value.zr && !value.ng, value => value.zr, value => !value.ng, value => value.ng, value => !value.zr, value => value.ng || value.zr, () => true];
  for (let code = 0; code < 8; code += 1) for (const flags of [{ zr: 0, ng: 0 }, { zr: 1, ng: 0 }, { zr: 0, ng: 1 }]) {
    const { project, outputInstances } = compositeTestProject(customChips, "N2T JUMP-CONTROL", [
      { id: "instruction", bits: 16 }, { id: "zr", bits: 1 }, { id: "ng", bits: 1 }
    ], [{ id: "jump", bits: 1 }], { instruction: 0x8000 | code, ...flags });
    const simulator = new Simulator(project);
    simulator.step();
    const expected = typeof expectedJump[code] === "function" ? expectedJump[code](flags) : expectedJump[code];
    assert.equal(outputBit(simulator, outputInstances[0].id), Number(expected), `jump ${code} flags ${JSON.stringify(flags)}`);
  }
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
