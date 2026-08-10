import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILTINS,
  GRID,
  TYPE,
  createProject,
  instanceFor,
  normalizeProject
} from "../src/model.js";
import { Simulator, isHigh } from "../src/simulation.js";

const SEGMENTS = ["a", "b", "c", "d", "e", "f", "g"];
const VARIABLES = ["d3", "d2", "d1", "d0"];
const DECODER_NAME = "HEX TO 7SEG";
const PROJECT_ID = "tiny-hex-display";

// Minimized sum-of-products for hexadecimal glyphs 0..F. A dash means that
// the corresponding input bit is irrelevant to that product term. Terms are
// shared between segments so the chip remains small enough to explore.
const SEGMENT_TERMS = {
  a: ["100-", "01-1", "-0-0", "1--0", "0-1-", "-11-"],
  b: ["0-00", "0-11", "1-01", "00--", "-0-0"],
  c: ["0-0-", "0--1", "01--", "--01", "10--"],
  d: ["00-0", "-101", "-110", "-011", "1-0-"],
  e: ["-0-0", "--10", "1-1-", "11--"],
  f: ["010-", "--00", "-1-0", "10--", "1-1-"],
  g: ["010-", "--10", "10--", "-01-", "1--1"]
};

const GLYPHS = [
  "abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc",
  "abcdefg", "abcdfg", "abcefg", "cdefg", "adef", "bcdeg", "adefg", "aefg"
];

function interfacePin(id, name, direction, x, y) {
  return { id, name, bits: 1, direction, x, y, valueDisplay: "off", colour: "red" };
}

function gateInstance(name, id, position) {
  const instance = instanceFor(name, position);
  instance.id = id;
  return instance;
}

function customInstance(name, id, position, label = "") {
  return { id, name, position, rotation: 0, label, internalData: {}, linkedBusPairId: null, outputPinColours: {} };
}

function addWire(wires, id, source, target, points = []) {
  wires.push({ id, source: { owner: String(source.owner), pin: String(source.pin) }, target: { owner: String(target.owner), pin: String(target.pin) }, points });
}

function outputOf(owner) {
  return { owner, pin: "2" };
}

function buildDecoder() {
  const inputPins = VARIABLES.map((name, index) => interfacePin(name, name.toUpperCase(), "input", -GRID * 7, -90 + index * 60));
  const outputPins = SEGMENTS.map((name, index) => interfacePin(`seg-${name}`, name.toUpperCase(), "output", GRID * 7, 56.875 - index * 16.25));
  const instances = [];
  const wires = [];

  const addGate = (name, id, x, y) => {
    const instance = gateInstance(name, id, { x, y });
    instances.push(instance);
    return instance;
  };

  const positive = Object.fromEntries(VARIABLES.map((name) => [name, { owner: "root", pin: name }]));
  const negative = {};
  VARIABLES.forEach((name, index) => {
    const inverter = addGate(TYPE.NOT, `not-${name}`, -GRID * 25, -90 + index * 60);
    addWire(wires, `wire-${inverter.id}-in`, { owner: "root", pin: name }, { owner: inverter.id, pin: "0" });
    negative[name] = { owner: inverter.id, pin: "1" };
  });

  const uniqueTerms = [...new Set(Object.values(SEGMENT_TERMS).flat())];
  const termOutputs = new Map();
  uniqueTerms.forEach((pattern, index) => {
    const column = Math.floor(index / 10);
    const row = index % 10;
    const y = -382.5 + row * 85;
    const baseX = -GRID * 18 + column * GRID * 14;
    const literals = [];
    [...pattern].forEach((value, bitIndex) => {
      if (value === "-") return;
      const variable = VARIABLES[bitIndex];
      literals.push(value === "1" ? positive[variable] : negative[variable]);
    });
    assert.ok(literals.length >= 2, `Expected a two-input minimum term: ${pattern}`);

    let previous = literals[0];
    for (let literalIndex = 1; literalIndex < literals.length; literalIndex += 1) {
      const gate = addGate(TYPE.AND, `and-${pattern.replaceAll("-", "x")}-${literalIndex}`, baseX + (literalIndex - 1) * GRID * 4, y);
      addWire(wires, `wire-${gate.id}-left`, previous, { owner: gate.id, pin: "0" });
      addWire(wires, `wire-${gate.id}-right`, literals[literalIndex], { owner: gate.id, pin: "1" });
      previous = outputOf(gate.id);
    }
    termOutputs.set(pattern, previous);
  });

  SEGMENTS.forEach((segment, segmentIndex) => {
    const terms = SEGMENT_TERMS[segment];
    let previous = termOutputs.get(terms[0]);
    for (let termIndex = 1; termIndex < terms.length; termIndex += 1) {
      const gate = addGate(TYPE.OR, `or-${segment}-${termIndex}`, GRID * 27 + termIndex * GRID * 4, -240 + segmentIndex * 80);
      addWire(wires, `wire-${gate.id}-left`, previous, { owner: gate.id, pin: "0" });
      addWire(wires, `wire-${gate.id}-right`, termOutputs.get(terms[termIndex]), { owner: gate.id, pin: "1" });
      previous = outputOf(gate.id);
    }
    addWire(wires, `wire-segment-${segment}`, previous, { owner: "root", pin: `seg-${segment}` });
  });

  return {
    id: "chip-hex-to-7seg",
    name: DECODER_NAME,
    type: TYPE.CUSTOM,
    kind: "custom",
    size: { x: GRID * 14, y: GRID * 18 },
    colour: "#7358ad",
    nameLocation: "top",
    inputPins,
    outputPins,
    instances,
    wires,
    junctions: [],
    displays: []
  };
}

function createTinyHexDisplay() {
  const project = createProject("Hex Display Lab");
  project.storageId = PROJECT_ID;
  project.root.name = "Hex Display Lab";
  project.root.size = { x: GRID * 50, y: GRID * 28 };
  project.settings = { ...project.settings, simulationPaused: false, stepsPerSecond: 4 };
  project.starred = ["DISPLAY", DECODER_NAME];

  const decoder = buildDecoder();
  const decoderInstance = customInstance(DECODER_NAME, "decoder", { x: -80, y: 0 }, "HEX DECODER");
  const display = gateInstance(TYPE.SEVEN_SEG, "display", { x: 360, y: 0 });
  display.label = "7-SEG HEX DISPLAY";

  const inputSpecs = [
    ["d3", "input-d3", "D3 (8)", -90, 1],
    ["d2", "input-d2", "D2 (4)", -30, 0],
    ["d1", "input-d1", "D1 (2)", 30, 1],
    ["d0", "input-d0", "D0 (1)", 90, 0]
  ];
  const inputs = inputSpecs.map(([variable, id, label, y, value]) => {
    project.inputValues[id] = value;
    return gateInstance(TYPE.IN_1, id, { x: -400, y });
  });
  inputs.forEach((instance, index) => { instance.label = inputSpecs[index][2]; });

  project.root.instances = [...inputs, decoderInstance, display];
  project.root.annotations = [
    {
      id: "hex-display-title",
      type: "label",
      text: "4-BIT HEX INPUT  ->  DECODER  ->  7-SEG DISPLAY",
      position: { x: -460, y: -245 },
      width: 620,
      height: 26,
      fontSize: 14,
      colour: "#f3d36b",
      background: "#172438"
    },
    {
      id: "hex-display-help",
      type: "text",
      text: "Toggle D3..D0 to choose a hex digit.\nD3 is the 8's bit; D0 is the 1's bit.\nA-G are the seven display segments.",
      position: { x: -460, y: 205 },
      width: 320,
      height: 70,
      fontSize: 11,
      colour: "#d7eaff",
      background: "#172438"
    }
  ];
  project.customChips = { [DECODER_NAME]: decoder };
  project.root.wires = [];
  inputSpecs.forEach(([variable, id]) => addWire(project.root.wires, `wire-input-${variable}`, { owner: id, pin: "0" }, { owner: decoderInstance.id, pin: variable }));
  SEGMENTS.forEach((segment, index) => addWire(project.root.wires, `wire-display-${segment}`, { owner: decoderInstance.id, pin: `seg-${segment}` }, { owner: display.id, pin: String(index) }));
  return normalizeProject(project);
}

function segmentsForDisplay(simulator, displayId) {
  const signals = simulator.snapshot.instances[displayId]?.signals ?? {};
  return SEGMENTS.filter((segment, index) => signals[String(index)]?.tri === 0 && isHigh(signals[String(index)])).join("");
}

async function main() {
  const project = createTinyHexDisplay();
  const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "storage", "projects");
  const projectFile = path.join(projectDir, `${PROJECT_ID}.json`);
  await mkdir(projectDir, { recursive: true });
  await writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`, "utf8");

  const persisted = normalizeProject(JSON.parse(await readFile(projectFile, "utf8")));
  persisted._revision = 1;
  const simulator = new Simulator(persisted);
  const failures = [];
  for (let value = 0; value < 16; value += 1) {
    VARIABLES.forEach((variable, index) => {
      persisted.inputValues[`input-${variable}`] = (value >> (3 - index)) & 1;
    });
    simulator.step();
    const actual = segmentsForDisplay(simulator, "display");
    const expected = GLYPHS[value];
    if (actual !== expected) failures.push({ value, expected, actual });
  }
  assert.deepEqual(failures, [], `Seven-segment validation failed: ${JSON.stringify(failures)}`);

  console.log(JSON.stringify({
    saved: true,
    file: path.relative(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), projectFile).replaceAll(path.sep, "/"),
    project: persisted.name,
    customChips: Object.keys(persisted.customChips),
    instances: persisted.root.instances.length,
    wires: persisted.root.wires.length,
    decoderGates: persisted.customChips[DECODER_NAME].instances.length,
    cases: 16,
    failures
  }, null, 2));
}

await main();
