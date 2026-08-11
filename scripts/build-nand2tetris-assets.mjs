import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTINS, normalizeProject, refreshReusableFit } from "../src/model.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "storage", "nand2tetris");
const chipDirectory = path.join(outputRoot, "chips");
const projectDirectory = path.join(outputRoot, "projects");
const softwareDirectory = path.join(outputRoot, "software");
const UPDATED_AT = "2026-08-11T00:00:00.000Z";

const TYPE = {
  NAND: "NAND",
  NOT: "NOT",
  AND: "AND",
  OR: "OR",
  XOR: "XOR",
  DFF: "DFF",
  CLOCK: "CLOCK",
  IN: bits => `IN-${bits}`,
  OUT: bits => `OUT-${bits}`,
  SPLIT16: "16-1BIT",
  MERGE16: "1-16BIT",
  SPLIT8: "8-1BIT",
  RAM8: "RAM8",
  RAM64: "RAM64",
  RAM512: "RAM512",
  RAM4K: "RAM4K",
  RAM16K: "RAM16K",
  ROM32K: "ROM32K",
  MEMORY: "MEMORY",
  SCREEN: "SCREEN",
  KEYBOARD: "KEYBOARD",
  CPU: "HACK CPU"
};

const COLOUR = {
  logic: "#706aa4",
  routing: "#5c8d78",
  arithmetic: "#967451",
  state: "#9b8653",
  memory: "#857654",
  computer: "#7358ad"
};

const custom = new Map();

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pin(id, name, bits = 1, direction = "input", x = 0, y = 0) {
  return { id: String(id), name, bits, direction, x, y, valueDisplay: bits > 1 ? "hex" : "off", colour: direction === "output" ? "green" : "gray" };
}

function node(id, name, position, label = "", interfaceId = null, internalData = {}) {
  return {
    id,
    name,
    position: { x: position.x, y: position.y },
    rotation: 0,
    label,
    internalData,
    linkedBusPairId: null,
    interfaceId,
    outputPinColours: {}
  };
}

function endpoint(owner, pinId) { return { owner: String(owner), pin: String(pinId) }; }

function wire(id, source, target) {
  return { id, source, target, points: [], colour: null };
}

function terminalName(direction, bits) {
  const available = [1, 4, 8, 16];
  const requested = Number(bits) || 1;
  const width = available.reduce((best, value) => Math.abs(value - requested) < Math.abs(best - requested) ? value : best, available[0]);
  return direction === "input" ? TYPE.IN(width) : TYPE.OUT(width);
}

function terminalY(index, count) {
  const spacing = 44;
  return (index - (count - 1) / 2) * spacing;
}

function makeChip(name, inputSpecs, outputSpecs, build, options = {}) {
  const instances = [];
  const wires = [];
  const inputNodes = new Map();
  const outputNodes = new Map();
  const inputPins = inputSpecs.map((spec, index) => {
    const id = String(spec.id);
    const instanceId = `interface-input-${slug(id)}`;
    inputNodes.set(id, instanceId);
    instances.push(node(instanceId, terminalName("input", spec.bits ?? 1), { x: -180, y: terminalY(index, inputSpecs.length) }, spec.name, id));
    return pin(id, spec.name, spec.bits ?? 1, "input", -220, terminalY(index, inputSpecs.length));
  });
  const outputPins = outputSpecs.map((spec, index) => {
    const id = String(spec.id);
    const instanceId = `interface-output-${slug(id)}`;
    outputNodes.set(id, instanceId);
    instances.push(node(instanceId, terminalName("output", spec.bits ?? 1), { x: 180, y: terminalY(index, outputSpecs.length) }, spec.name, id));
    return pin(id, spec.name, spec.bits ?? 1, "output", 220, terminalY(index, outputSpecs.length));
  });

  const context = {
    add(id, type, x, y, label = "", internalData = {}) {
      const instance = node(id, type, { x, y }, label, null, internalData);
      instances.push(instance);
      return id;
    },
    in(id, pinId = "0") { return endpoint(inputNodes.get(String(id)), pinId); },
    out(id, pinId = "0") { return endpoint(outputNodes.get(String(id)), pinId); },
    pin(owner, pinId) { return endpoint(owner, pinId); },
    link(id, source, target) { wires.push(wire(id, source, target)); },
    addWire(source, target, id = `wire-${wires.length + 1}`) { wires.push(wire(id, source, target)); }
  };
  build?.(context);

  return {
    id: `chip-${slug(name)}`,
    name,
    type: "custom",
    kind: "custom",
    size: { x: options.width ?? 640, y: options.height ?? 440 },
    colour: options.colour ?? COLOUR.logic,
    nameLocation: options.nameLocation ?? "top",
    inputPins,
    outputPins,
    instances,
    wires,
    junctions: [],
    displays: [],
    annotations: options.note ? [{
      id: `annotation-${slug(name)}`,
      type: "text",
      text: options.note,
      position: { x: -240, y: -190 },
      width: 480,
      height: 70,
      fontSize: 11,
      colour: "#d7eaff",
      background: "#2f3338"
    }] : [],
    interfaceBindings: {
      inputs: inputSpecs.map((spec) => ({ publicId: String(spec.id), instanceId: inputNodes.get(String(spec.id)), pinId: "0", direction: "input" })),
      outputs: outputSpecs.map((spec) => ({ publicId: String(spec.id), instanceId: outputNodes.get(String(spec.id)), pinId: "0", direction: "output" }))
    }
  };
}

function register(name, inputs, outputs, build, options = {}) {
  custom.set(name, makeChip(name, inputs, outputs, build, options));
  return name;
}

function logicInput(id, name = id.toUpperCase(), bits = 1) { return { id, name, bits }; }
function logicOutput(id, name = id.toUpperCase(), bits = 1) { return { id, name, bits }; }

function child(ctx, id, name, x, y, label = "") { return ctx.add(id, name, x, y, label); }
function connect(ctx, id, sourceOwner, sourcePin, targetOwner, targetPin) {
  ctx.link(id, ctx.pin(sourceOwner, sourcePin), ctx.pin(targetOwner, targetPin));
}

function connectInput(ctx, id, inputId, targetOwner, targetPin = "0") {
  ctx.link(id, ctx.in(inputId), ctx.pin(targetOwner, targetPin));
}

function connectOutput(ctx, id, sourceOwner, sourcePin, outputId) {
  ctx.link(id, ctx.pin(sourceOwner, sourcePin), ctx.out(outputId));
}

function bitPinForSplit(bit) { return String(16 - bit); }
function bitPinForMerge(bit) { return String(bit); }

function defineUnaryBitwise(name, gateName, note) {
  return register(name, [logicInput("in", "IN", 16)], [logicOutput("out", "OUT", 16)], (ctx) => {
    child(ctx, "split", TYPE.SPLIT16, -160, 0);
    child(ctx, "merge", TYPE.MERGE16, 160, 0);
    connectInput(ctx, "source", "in", "split", "0");
    for (let bit = 0; bit < 16; bit += 1) {
      const gate = child(ctx, `gate-${bit}`, gateName, 0, (bit - 7.5) * 20);
      connect(ctx, `split-${bit}`, "split", bitPinForSplit(bit), gate, "0");
      connect(ctx, `merge-${bit}`, gate, "out", "merge", bitPinForMerge(bit));
    }
    connect(ctx, "merge-out", "merge", "16", "out");
  }, { colour: COLOUR.logic, note });
}

function defineBinaryBitwise(name, gateName, note) {
  return register(name, [logicInput("a", "A", 16), logicInput("b", "B", 16)], [logicOutput("out", "OUT", 16)], (ctx) => {
    child(ctx, "split-a", TYPE.SPLIT16, -240, -100);
    child(ctx, "split-b", TYPE.SPLIT16, -240, 100);
    child(ctx, "merge", TYPE.MERGE16, 220, 0);
    connectInput(ctx, "a-source", "a", "split-a", "0");
    connectInput(ctx, "b-source", "b", "split-b", "0");
    for (let bit = 0; bit < 16; bit += 1) {
      const gate = child(ctx, `gate-${bit}`, gateName, 0, (bit - 7.5) * 20);
      connect(ctx, `a-${bit}`, "split-a", bitPinForSplit(bit), gate, "0");
      connect(ctx, `b-${bit}`, "split-b", bitPinForSplit(bit), gate, "1");
      connect(ctx, `merge-${bit}`, gate, "out", "merge", bitPinForMerge(bit));
    }
    connect(ctx, "merge-out", "merge", "16", "out");
  }, { colour: COLOUR.logic, note, height: 560 });
}

register("N2T NAND", [logicInput("a", "A"), logicInput("b", "B")], [logicOutput("out", "OUT")], (ctx) => {
  const nand = child(ctx, "nand", TYPE.NAND, 0, 0);
  connectInput(ctx, "a", "a", nand, "0");
  connectInput(ctx, "b", "b", nand, "1");
  connectOutput(ctx, "out", nand, "2", "out");
}, { colour: COLOUR.logic, note: "The primitive used as the construction starting point for the Nand2Tetris hardware track." });

register("N2T NOT", [logicInput("in", "IN")], [logicOutput("out", "OUT")], (ctx) => {
  const nand = child(ctx, "nand", "N2T NAND", 0, 0);
  connectInput(ctx, "in", "in", nand, "a");
  connectInput(ctx, "in-copy", "in", nand, "b");
  connectOutput(ctx, "out", nand, "out", "out");
}, { colour: COLOUR.logic, note: "NOT is NAND with the same signal connected to both inputs." });

register("N2T AND", [logicInput("a", "A"), logicInput("b", "B")], [logicOutput("out", "OUT")], (ctx) => {
  const nand = child(ctx, "nand", "N2T NAND", 0, -50);
  const not = child(ctx, "not", "N2T NOT", 120, -50);
  connectInput(ctx, "a", "a", nand, "a");
  connectInput(ctx, "b", "b", nand, "b");
  connect(ctx, "nand-not", nand, "out", not, "in");
  connectOutput(ctx, "out", not, "out", "out");
}, { colour: COLOUR.logic, note: "AND = NOT(NAND)." });

register("N2T OR", [logicInput("a", "A"), logicInput("b", "B")], [logicOutput("out", "OUT")], (ctx) => {
  const na = child(ctx, "not-a", "N2T NOT", -80, -60);
  const nb = child(ctx, "not-b", "N2T NOT", -80, 60);
  const nand = child(ctx, "nand", "N2T NAND", 100, 0);
  connectInput(ctx, "a", "a", na, "in");
  connectInput(ctx, "b", "b", nb, "in");
  connect(ctx, "na-nand", na, "out", nand, "a");
  connect(ctx, "nb-nand", nb, "out", nand, "b");
  connectOutput(ctx, "out", nand, "out", "out");
}, { colour: COLOUR.logic, note: "OR follows from De Morgan: NOT(NOT A NAND NOT B)." });

register("N2T XOR", [logicInput("a", "A"), logicInput("b", "B")], [logicOutput("out", "OUT")], (ctx) => {
  const or = child(ctx, "or", "N2T OR", -120, -60);
  const nand = child(ctx, "nand", "N2T NAND", -120, 60);
  const and = child(ctx, "and", "N2T AND", 100, 0);
  connectInput(ctx, "a-or", "a", or, "a");
  connectInput(ctx, "b-or", "b", or, "b");
  connectInput(ctx, "a-nand", "a", nand, "a");
  connectInput(ctx, "b-nand", "b", nand, "b");
  connect(ctx, "or-and", or, "out", and, "a");
  connect(ctx, "nand-and", nand, "out", and, "b");
  connectOutput(ctx, "out", and, "out", "out");
}, { colour: COLOUR.logic, note: "XOR = (A OR B) AND NOT(A AND B), expressed using the NAND-derived parts." });

register("N2T NOR", [logicInput("a", "A"), logicInput("b", "B")], [logicOutput("out", "OUT")], (ctx) => {
  const or = child(ctx, "or", "N2T OR", 0, 0);
  const not = child(ctx, "not", "N2T NOT", 120, 0);
  connectInput(ctx, "a", "a", or, "a");
  connectInput(ctx, "b", "b", or, "b");
  connect(ctx, "or-not", or, "out", not, "in");
  connectOutput(ctx, "out", not, "out", "out");
}, { colour: COLOUR.logic, note: "NOR is the inversion of the NAND-derived OR." });

register("N2T XNOR", [logicInput("a", "A"), logicInput("b", "B")], [logicOutput("out", "OUT")], (ctx) => {
  const xor = child(ctx, "xor", "N2T XOR", 0, 0);
  const not = child(ctx, "not", "N2T NOT", 120, 0);
  connectInput(ctx, "a", "a", xor, "a");
  connectInput(ctx, "b", "b", xor, "b");
  connect(ctx, "xor-not", xor, "out", not, "in");
  connectOutput(ctx, "out", not, "out", "out");
}, { colour: COLOUR.logic, note: "XNOR is XOR followed by NOT." });

register("N2T BUFFER", [logicInput("in", "IN")], [logicOutput("out", "OUT")], (ctx) => {
  ctx.link("direct", ctx.in("in"), ctx.out("out"));
}, { colour: COLOUR.logic, note: "A direct signal path, useful when making the data flow explicit." });

register("N2T MUX", [logicInput("a", "A"), logicInput("b", "B"), logicInput("sel", "SEL")], [logicOutput("out", "OUT")], (ctx) => {
  const not = child(ctx, "not-sel", "N2T NOT", -160, 80);
  const left = child(ctx, "left", "N2T AND", 0, -60);
  const right = child(ctx, "right", "N2T AND", 0, 60);
  const or = child(ctx, "or", "N2T OR", 140, 0);
  connectInput(ctx, "sel-not", "sel", not, "in");
  connectInput(ctx, "a", "a", left, "a");
  connect(ctx, "not-left", not, "out", left, "b");
  connectInput(ctx, "b", "b", right, "a");
  connectInput(ctx, "sel-right", "sel", right, "b");
  connect(ctx, "left-or", left, "out", or, "a");
  connect(ctx, "right-or", right, "out", or, "b");
  connectOutput(ctx, "out", or, "out", "out");
}, { colour: COLOUR.routing, note: "SEL=0 routes A; SEL=1 routes B." });

register("N2T DMUX", [logicInput("in", "IN"), logicInput("sel", "SEL")], [logicOutput("a", "A"), logicOutput("b", "B")], (ctx) => {
  const not = child(ctx, "not-sel", "N2T NOT", -100, 60);
  const left = child(ctx, "left", "N2T AND", 80, -60);
  const right = child(ctx, "right", "N2T AND", 80, 60);
  connectInput(ctx, "sel-not", "sel", not, "in");
  connectInput(ctx, "in-left", "in", left, "a");
  connect(ctx, "not-left", not, "out", left, "b");
  connectInput(ctx, "in-right", "in", right, "a");
  connectInput(ctx, "sel-right", "sel", right, "b");
  connectOutput(ctx, "left-out", left, "out", "a");
  connectOutput(ctx, "right-out", right, "out", "b");
}, { colour: COLOUR.routing, note: "The input is routed to exactly one output according to SEL." });

register("N2T OR8WAY", [logicInput("in", "IN", 8)], [logicOutput("out", "OUT")], (ctx) => {
  const split = child(ctx, "split", TYPE.SPLIT8, -180, 0);
  connectInput(ctx, "source", "in", split, "0");
  let previous = [];
  for (let index = 0; index < 8; index += 1) previous.push({ owner: split, pin: String(index + 1) });
  let level = 0;
  while (previous.length > 1) {
    const next = [];
    for (let index = 0; index < previous.length; index += 2) {
      const or = child(ctx, `or-${level}-${index}`, "N2T OR", -20 + level * 70, (index / 2 - (previous.length / 4)) * 40);
      connect(ctx, `or-a-${level}-${index}`, previous[index].owner, previous[index].pin, or, "a");
      connect(ctx, `or-b-${level}-${index}`, previous[index + 1].owner, previous[index + 1].pin, or, "b");
      next.push({ owner: or, pin: "out" });
    }
    previous = next;
    level += 1;
  }
  connectOutput(ctx, "result", previous[0].owner, previous[0].pin, "out");
}, { colour: COLOUR.routing, note: "An 8-input OR tree built from the one-bit OR chip." });

register("N2T MUX4WAY", [logicInput("a", "A"), logicInput("b", "B"), logicInput("c", "C"), logicInput("d", "D"), logicInput("sel0", "SEL 0"), logicInput("sel1", "SEL 1")], [logicOutput("out", "OUT")], (ctx) => {
  const left = child(ctx, "left", "N2T MUX", -80, -60);
  const right = child(ctx, "right", "N2T MUX", -80, 60);
  const final = child(ctx, "final", "N2T MUX", 120, 0);
  connectInput(ctx, "a", "a", left, "a");
  connectInput(ctx, "b", "b", left, "b");
  connectInput(ctx, "c", "c", right, "a");
  connectInput(ctx, "d", "d", right, "b");
  connectInput(ctx, "sel0-left", "sel0", left, "sel");
  connectInput(ctx, "sel0-right", "sel0", right, "sel");
  connect(ctx, "left-final", left, "out", final, "a");
  connect(ctx, "right-final", right, "out", final, "b");
  connectInput(ctx, "sel1-final", "sel1", final, "sel");
  connectOutput(ctx, "out", final, "out", "out");
}, { colour: COLOUR.routing, note: "A two-level selection tree; SEL 0 chooses inside each pair and SEL 1 chooses the pair." });

register("N2T MUX8WAY", ["a", "b", "c", "d", "e", "f", "g", "h"].map(id => logicInput(id, id.toUpperCase())).concat([logicInput("sel0", "SEL 0"), logicInput("sel1", "SEL 1"), logicInput("sel2", "SEL 2")]), [logicOutput("out", "OUT")], (ctx) => {
  const first = child(ctx, "first", "N2T MUX4WAY", -100, -80);
  const second = child(ctx, "second", "N2T MUX4WAY", -100, 80);
  const final = child(ctx, "final", "N2T MUX", 120, 0);
  ["a", "b", "c", "d"].forEach((id, index) => connectInput(ctx, `${id}-first`, id, first, id));
  ["e", "f", "g", "h"].forEach((id, index) => connectInput(ctx, `${id}-second`, id, second, String.fromCharCode(97 + index)));
  [first, second].forEach((target, index) => {
    connectInput(ctx, `sel0-${index}`, "sel0", target, "sel0");
    connectInput(ctx, `sel1-${index}`, "sel1", target, "sel1");
  });
  connect(ctx, "first-final", first, "out", final, "a");
  connect(ctx, "second-final", second, "out", final, "b");
  connectInput(ctx, "sel2-final", "sel2", final, "sel");
  connectOutput(ctx, "out", final, "out", "out");
}, { colour: COLOUR.routing, note: "An 8-way multiplexer composed from two 4-way multiplexers and one final selector.", height: 520 });

register("N2T DMUX4WAY", [logicInput("in", "IN"), logicInput("sel0", "SEL 0"), logicInput("sel1", "SEL 1")], ["a", "b", "c", "d"].map(id => logicOutput(id, id.toUpperCase())), (ctx) => {
  const first = child(ctx, "first", "N2T DMUX", -80, -50);
  const second = child(ctx, "second", "N2T DMUX", -80, 50);
  const low = child(ctx, "low", "N2T DMUX", 120, -90);
  const high = child(ctx, "high", "N2T DMUX", 120, 90);
  connectInput(ctx, "in", "in", first, "in");
  connectInput(ctx, "sel1-first", "sel1", first, "sel");
  connect(ctx, "first-low", first, "a", low, "in");
  connect(ctx, "first-high", first, "b", high, "in");
  connectInput(ctx, "sel0-low", "sel0", low, "sel");
  connectInput(ctx, "sel0-high", "sel0", high, "sel");
  connectOutput(ctx, "a", low, "a", "a");
  connectOutput(ctx, "b", low, "b", "b");
  connectOutput(ctx, "c", high, "a", "c");
  connectOutput(ctx, "d", high, "b", "d");
}, { colour: COLOUR.routing, note: "A decoder tree: SEL 1 selects a pair, then SEL 0 selects inside the pair." });

register("N2T DMUX8WAY", [logicInput("in", "IN"), logicInput("sel0", "SEL 0"), logicInput("sel1", "SEL 1"), logicInput("sel2", "SEL 2")], ["a", "b", "c", "d", "e", "f", "g", "h"].map(id => logicOutput(id, id.toUpperCase())), (ctx) => {
  const first = child(ctx, "first", "N2T DMUX", -180, 0);
  const groupA = child(ctx, "group-a", "N2T DMUX4WAY", 20, -120);
  const groupB = child(ctx, "group-b", "N2T DMUX4WAY", 20, 120);
  connectInput(ctx, "in", "in", first, "in");
  connectInput(ctx, "sel2-first", "sel2", first, "sel");
  connect(ctx, "first-a", first, "a", groupA, "in");
  connect(ctx, "first-b", first, "b", groupB, "in");
  [groupA, groupB].forEach((target, index) => {
    connectInput(ctx, `sel0-${index}`, "sel0", target, "sel0");
    connectInput(ctx, `sel1-${index}`, "sel1", target, "sel1");
  });
  ["a", "b", "c", "d"].forEach(id => connectOutput(ctx, `group-a-${id}`, groupA, id, id));
  ["e", "f", "g", "h"].forEach((id, index) => connectOutput(ctx, `group-b-${id}`, groupB, String.fromCharCode(97 + index), id));
}, { colour: COLOUR.routing, note: "An 8-way decoder composed from two stages of one-bit and four-way routing." });

defineUnaryBitwise("N2T NOT16", "N2T NOT", "Sixteen one-bit NOT chips share the same construction pattern.");
defineBinaryBitwise("N2T AND16", "N2T AND", "Sixteen one-bit AND chips operate in parallel.");
defineBinaryBitwise("N2T OR16", "N2T OR", "Sixteen one-bit OR chips operate in parallel.");
defineBinaryBitwise("N2T XOR16", "N2T XOR", "Sixteen one-bit XOR chips operate in parallel.");

register("N2T MUX16", [logicInput("a", "A", 16), logicInput("b", "B", 16), logicInput("sel", "SEL")], [logicOutput("out", "OUT", 16)], (ctx) => {
  const splitA = child(ctx, "split-a", TYPE.SPLIT16, -240, -100);
  const splitB = child(ctx, "split-b", TYPE.SPLIT16, -240, 100);
  const merge = child(ctx, "merge", TYPE.MERGE16, 220, 0);
  connectInput(ctx, "a-source", "a", splitA, "0");
  connectInput(ctx, "b-source", "b", splitB, "0");
  for (let bit = 0; bit < 16; bit += 1) {
    const mux = child(ctx, `mux-${bit}`, "N2T MUX", 0, (bit - 7.5) * 20);
    connect(ctx, `a-${bit}`, splitA, bitPinForSplit(bit), mux, "a");
    connect(ctx, `b-${bit}`, splitB, bitPinForSplit(bit), mux, "b");
    connectInput(ctx, `sel-${bit}`, "sel", mux, "sel");
    connect(ctx, `merge-${bit}`, mux, "out", merge, bitPinForMerge(bit));
  }
  ctx.link("out", ctx.pin(merge, "16"), ctx.out("out"));
}, { colour: COLOUR.routing, note: "A sixteen-lane MUX with one shared selection signal.", height: 560 });

register("N2T HALF ADDER", [logicInput("a", "A"), logicInput("b", "B")], [logicOutput("sum", "SUM"), logicOutput("carry", "CARRY")], (ctx) => {
  const xor = child(ctx, "xor", "N2T XOR", 0, -50);
  const and = child(ctx, "and", "N2T AND", 0, 50);
  connectInput(ctx, "a-xor", "a", xor, "a");
  connectInput(ctx, "b-xor", "b", xor, "b");
  connectInput(ctx, "a-and", "a", and, "a");
  connectInput(ctx, "b-and", "b", and, "b");
  connectOutput(ctx, "sum", xor, "out", "sum");
  connectOutput(ctx, "carry", and, "out", "carry");
}, { colour: COLOUR.arithmetic, note: "SUM is XOR; CARRY is AND." });

register("N2T FULL ADDER", [logicInput("a", "A"), logicInput("b", "B"), logicInput("cin", "CIN")], [logicOutput("sum", "SUM"), logicOutput("carry", "CARRY")], (ctx) => {
  const first = child(ctx, "first", "N2T HALF ADDER", -80, -60);
  const second = child(ctx, "second", "N2T HALF ADDER", 100, -20);
  const or = child(ctx, "or", "N2T OR", 220, 80);
  connectInput(ctx, "a", "a", first, "a");
  connectInput(ctx, "b", "b", first, "b");
  connect(ctx, "first-sum", first, "sum", second, "a");
  connectInput(ctx, "cin", "cin", second, "b");
  connect(ctx, "first-carry", first, "carry", or, "a");
  connect(ctx, "second-carry", second, "carry", or, "b");
  connectOutput(ctx, "sum", second, "sum", "sum");
  connectOutput(ctx, "carry", or, "out", "carry");
}, { colour: COLOUR.arithmetic, note: "Two half adders plus OR combine the carry paths." });

register("N2T ADD16", [logicInput("a", "A", 16), logicInput("b", "B", 16), logicInput("cin", "CIN")], [logicOutput("out", "OUT", 16), logicOutput("cout", "COUT")], (ctx) => {
  const splitA = child(ctx, "split-a", TYPE.SPLIT16, -260, -100);
  const splitB = child(ctx, "split-b", TYPE.SPLIT16, -260, 100);
  const merge = child(ctx, "merge", TYPE.MERGE16, 260, 0);
  connectInput(ctx, "a-source", "a", splitA, "0");
  connectInput(ctx, "b-source", "b", splitB, "0");
  let carry = null;
  for (let bit = 0; bit < 16; bit += 1) {
    const adder = child(ctx, `adder-${bit}`, "N2T FULL ADDER", 0, (bit - 7.5) * 20);
    connect(ctx, `a-${bit}`, splitA, bitPinForSplit(bit), adder, "a");
    connect(ctx, `b-${bit}`, splitB, bitPinForSplit(bit), adder, "b");
    if (carry) connect(ctx, `carry-${bit}`, carry.owner, carry.pin, adder, "cin");
    else connectInput(ctx, "cin", "cin", adder, "cin");
    connect(ctx, `sum-${bit}`, adder, "sum", merge, bitPinForMerge(bit));
    carry = { owner: adder, pin: "carry" };
  }
  ctx.link("out", ctx.pin(merge, "16"), ctx.out("out"));
  connectOutput(ctx, "cout", carry.owner, carry.pin, "cout");
}, { colour: COLOUR.arithmetic, note: "A ripple-carry 16-bit adder. The least-significant full adder receives CIN.", height: 560 });

register("N2T INC16", [logicInput("in", "IN", 16)], [logicOutput("out", "OUT", 16)], (ctx) => {
  const zero = child(ctx, "zero", "CONST-0-16", -160, 100);
  const one = child(ctx, "one", "CONST-1", -160, 160);
  const add = child(ctx, "add", "N2T ADD16", 80, 0);
  connectInput(ctx, "in", "in", add, "a");
  connect(ctx, "zero-b", zero, "0", add, "b");
  connect(ctx, "one-cin", one, "0", add, "cin");
  connectOutput(ctx, "out", add, "out", "out");
}, { colour: COLOUR.arithmetic, note: "Increment is addition by one, with a 16-bit zero as the second operand." });

register("N2T SUB16", [logicInput("a", "A", 16), logicInput("b", "B", 16)], [logicOutput("out", "OUT", 16), logicOutput("cout", "COUT")], (ctx) => {
  const not = child(ctx, "not-b", "N2T NOT16", -100, 80);
  const one = child(ctx, "one", "CONST-1", -120, 160);
  const add = child(ctx, "add", "N2T ADD16", 140, 0);
  connectInput(ctx, "a", "a", add, "a");
  connectInput(ctx, "b", "b", not, "in");
  connect(ctx, "not-add", not, "out", add, "b");
  connect(ctx, "one-add", one, "0", add, "cin");
  connectOutput(ctx, "out", add, "out", "out");
  connectOutput(ctx, "cout", add, "cout", "cout");
}, { colour: COLOUR.arithmetic, note: "Two's-complement subtraction: A + NOT(B) + 1." });

register("N2T COMPARE16", [logicInput("a", "A", 16), logicInput("b", "B", 16)], [logicOutput("equal", "EQ"), logicOutput("negative", "NEG"), logicOutput("greater", "GT")], (ctx) => {
  const sub = child(ctx, "sub", "N2T SUB16", -120, 0);
  const or = child(ctx, "or", "N2T OR16", 60, 0);
  const not = child(ctx, "not-eq", "N2T NOT", 200, -40);
  const split = child(ctx, "split", TYPE.SPLIT16, 60, 160);
  const gt = child(ctx, "gt", "N2T OR", 200, 80);
  connectInput(ctx, "a", "a", sub, "a");
  connectInput(ctx, "b", "b", sub, "b");
  connect(ctx, "sub-or", sub, "out", or, "a");
  connect(ctx, "sub-split", sub, "out", split, "0");
  connect(ctx, "or-not", or, "out", not, "in");
  ctx.link("neg", ctx.pin(split, "1"), ctx.out("negative"));
  ctx.link("eq", ctx.pin(not, "out"), ctx.out("equal"));
  connect(ctx, "not-neg", split, "1", gt, "a");
  connect(ctx, "not-eq", not, "out", gt, "b");
  connectOutput(ctx, "greater", gt, "out", "greater");
}, { colour: COLOUR.arithmetic, note: "A compact comparison landmark: subtraction exposes equality and sign; GT is a simple unsigned-oriented flag." });

register("N2T ALU", [
  logicInput("x", "X", 16), logicInput("y", "Y", 16), logicInput("zx", "ZX"), logicInput("nx", "NX"),
  logicInput("zy", "ZY"), logicInput("ny", "NY"), logicInput("f", "F"), logicInput("no", "NO")
], [logicOutput("out", "OUT", 16), logicOutput("zr", "ZR"), logicOutput("ng", "NG"), logicOutput("carry", "CARRY")], (ctx) => {
  const zero = child(ctx, "zero", "CONST-0-16", -260, 180);
  const xMux = child(ctx, "x-zero", "N2T MUX16", -80, -130);
  const xNot = child(ctx, "x-not", "N2T NOT16", 80, -130);
  const xNorm = child(ctx, "x-normal", "N2T MUX16", 220, -130);
  const yMux = child(ctx, "y-zero", "N2T MUX16", -80, 130);
  const yNot = child(ctx, "y-not", "N2T NOT16", 80, 130);
  const yNorm = child(ctx, "y-normal", "N2T MUX16", 220, 130);
  const and = child(ctx, "and", "N2T AND16", 360, -70);
  const add = child(ctx, "add", "N2T ADD16", 360, 70);
  const functionMux = child(ctx, "function", "N2T MUX16", 500, 0);
  const notOut = child(ctx, "not-out", "N2T NOT16", 640, 0);
  const outputMux = child(ctx, "output", "N2T MUX16", 780, 0);
  const zeroSplit = child(ctx, "zero-split", "16-8BIT", 640, 140);
  const zeroHigh = child(ctx, "zero-high", "N2T OR8WAY", 780, 140);
  const zeroLow = child(ctx, "zero-low", "N2T OR8WAY", 780, 240);
  const zeroDetect = child(ctx, "zero-detect", "N2T OR", 920, 190);
  const zeroNot = child(ctx, "zero-not", "N2T NOT", 1040, 190);
  const splitOut = child(ctx, "split-out", TYPE.SPLIT16, 780, 240);
  connectInput(ctx, "x", "x", xMux, "a");
  connect(ctx, "zero-x", zero, "0", xMux, "b");
  connectInput(ctx, "zx", "zx", xMux, "sel");
  connect(ctx, "x-mux-not", xMux, "out", xNot, "in");
  connect(ctx, "x-to-normal", xMux, "out", xNorm, "a");
  connect(ctx, "x-not-to-normal", xNot, "out", xNorm, "b");
  connectInput(ctx, "nx", "nx", xNorm, "sel");
  connectInput(ctx, "y", "y", yMux, "a");
  connect(ctx, "zero-y", zero, "0", yMux, "b");
  connectInput(ctx, "zy", "zy", yMux, "sel");
  connect(ctx, "y-mux-not", yMux, "out", yNot, "in");
  connect(ctx, "y-to-normal", yMux, "out", yNorm, "a");
  connect(ctx, "y-not-to-normal", yNot, "out", yNorm, "b");
  connectInput(ctx, "ny", "ny", yNorm, "sel");
  [and, add].forEach(target => {
    connect(ctx, `x-${target}`, xNorm, "out", target, "a");
    connect(ctx, `y-${target}`, yNorm, "out", target, "b");
  });
  connect(ctx, "and-function", and, "out", functionMux, "a");
  connect(ctx, "add-function", add, "out", functionMux, "b");
  connectInput(ctx, "f", "f", functionMux, "sel");
  connect(ctx, "function-not", functionMux, "out", notOut, "in");
  connect(ctx, "function-output", functionMux, "out", outputMux, "a");
  connect(ctx, "not-output", notOut, "out", outputMux, "b");
  connectInput(ctx, "no", "no", outputMux, "sel");
  connectOutput(ctx, "out", outputMux, "out", "out");
  connect(ctx, "output-zero", outputMux, "out", zeroSplit, "0");
  connect(ctx, "zero-high-source", zeroSplit, "1", zeroHigh, "in");
  connect(ctx, "zero-low-source", zeroSplit, "2", zeroLow, "in");
  connect(ctx, "zero-high-detect", zeroHigh, "out", zeroDetect, "a");
  connect(ctx, "zero-low-detect", zeroLow, "out", zeroDetect, "b");
  connect(ctx, "zero-detect-not", zeroDetect, "out", zeroNot, "in");
  connectOutput(ctx, "zr", zeroNot, "out", "zr");
  connect(ctx, "out-split", outputMux, "out", splitOut, "0");
  connectOutput(ctx, "ng", splitOut, "1", "ng");
  connectOutput(ctx, "carry", add, "cout", "carry");
}, { colour: COLOUR.arithmetic, note: "Hack-style ALU control: zero/negate each operand, choose AND or ADD, then optionally negate the result.", width: 980, height: 620 });

register("N2T BIT", [logicInput("in", "IN"), logicInput("load", "LOAD"), logicInput("clock", "CLOCK")], [logicOutput("out", "OUT")], (ctx) => {
  const mux = child(ctx, "mux", "N2T MUX", -40, 0);
  const dff = child(ctx, "dff", TYPE.DFF, 120, 0);
  connectInput(ctx, "in", "in", mux, "a");
  connect(ctx, "stored", dff, "2", mux, "b");
  connectInput(ctx, "load", "load", mux, "sel");
  connect(ctx, "next", mux, "out", dff, "0");
  connectInput(ctx, "clock", "clock", dff, "1");
  connectOutput(ctx, "out", dff, "2", "out");
}, { colour: COLOUR.state, note: "A one-bit state cell: LOAD selects new input data; otherwise the DFF feeds its own stored value back." });

register("N2T REGISTER", [logicInput("in", "IN", 16), logicInput("load", "LOAD"), logicInput("clock", "CLOCK")], [logicOutput("out", "OUT", 16)], (ctx) => {
  const split = child(ctx, "split", TYPE.SPLIT16, -260, 0);
  const merge = child(ctx, "merge", TYPE.MERGE16, 260, 0);
  connectInput(ctx, "in", "in", split, "0");
  for (let bit = 0; bit < 16; bit += 1) {
    const bitChip = child(ctx, `bit-${bit}`, "N2T BIT", 0, (bit - 7.5) * 20);
    connect(ctx, `split-${bit}`, split, bitPinForSplit(bit), bitChip, "in");
    connectInput(ctx, `load-${bit}`, "load", bitChip, "load");
    connectInput(ctx, `clock-${bit}`, "clock", bitChip, "clock");
    connect(ctx, `merge-${bit}`, bitChip, "out", merge, bitPinForMerge(bit));
  }
  ctx.link("out", ctx.pin(merge, "16"), ctx.out("out"));
}, { colour: COLOUR.state, note: "Sixteen BIT cells in parallel form the 16-bit register.", height: 560 });

register("N2T A REGISTER", [logicInput("in", "IN", 16), logicInput("load", "LOAD"), logicInput("clock", "CLOCK")], [logicOutput("out", "OUT", 16)], (ctx) => {
  const register = child(ctx, "register", "N2T REGISTER", 0, 0);
  connectInput(ctx, "in", "in", register, "in");
  connectInput(ctx, "load", "load", register, "load");
  connectInput(ctx, "clock", "clock", register, "clock");
  connectOutput(ctx, "out", register, "out", "out");
}, { colour: COLOUR.state, note: "The A register stores addresses and A-instruction values." });

register("N2T D REGISTER", [logicInput("in", "IN", 16), logicInput("load", "LOAD"), logicInput("clock", "CLOCK")], [logicOutput("out", "OUT", 16)], (ctx) => {
  const register = child(ctx, "register", "N2T REGISTER", 0, 0);
  connectInput(ctx, "in", "in", register, "in");
  connectInput(ctx, "load", "load", register, "load");
  connectInput(ctx, "clock", "clock", register, "clock");
  connectOutput(ctx, "out", register, "out", "out");
}, { colour: COLOUR.state, note: "The D register stores general-purpose computation results." });

register("N2T PC", [logicInput("in", "IN", 16), logicInput("load", "LOAD"), logicInput("inc", "INC"), logicInput("reset", "RESET"), logicInput("clock", "CLOCK")], [logicOutput("out", "OUT", 16)], (ctx) => {
  const current = child(ctx, "register", "N2T REGISTER", 300, 0);
  const increment = child(ctx, "increment", "N2T INC16", -120, -140);
  const loadMux = child(ctx, "load-mux", "N2T MUX16", 0, -40);
  const incMux = child(ctx, "inc-mux", "N2T MUX16", 100, 40);
  const resetMux = child(ctx, "reset-mux", "N2T MUX16", 200, 120);
  const zero = child(ctx, "zero", "CONST-0-16", 0, 200);
  const one = child(ctx, "one", "CONST-1", 260, -150);
  connect(ctx, "current-increment", current, "out", increment, "in");
  connect(ctx, "current-load", current, "out", loadMux, "a");
  connectInput(ctx, "in-load", "in", loadMux, "b");
  connectInput(ctx, "load-select", "load", loadMux, "sel");
  connect(ctx, "load-inc", loadMux, "out", incMux, "a");
  connect(ctx, "increment-inc", increment, "out", incMux, "b");
  connectInput(ctx, "inc-select", "inc", incMux, "sel");
  connect(ctx, "inc-reset", incMux, "out", resetMux, "a");
  connect(ctx, "zero-reset", zero, "0", resetMux, "b");
  connectInput(ctx, "reset-select", "reset", resetMux, "sel");
  connect(ctx, "next-register", resetMux, "out", current, "in");
  connect(ctx, "always-load", one, "0", current, "load");
  connectInput(ctx, "clock-register", "clock", current, "clock");
  connectOutput(ctx, "out", current, "out", "out");
}, { colour: COLOUR.state, note: "PC priority is RESET, then LOAD, then INC. The register is written every clock with the selected next value." , width: 720 });

function memoryWrapper(name, nativeName, addressBits, note, colour = COLOUR.memory) {
  return register(name, [logicInput("address", "ADDRESS", addressBits), logicInput("in", "IN", 16), logicInput("load", "LOAD"), logicInput("reset", "RESET"), logicInput("clock", "CLOCK")], [logicOutput("out", "OUT", 16)], (ctx) => {
    const memory = child(ctx, "memory", nativeName, 0, 0);
    connectInput(ctx, "address", "address", memory, "0");
    connectInput(ctx, "in", "in", memory, "1");
    connectInput(ctx, "load", "load", memory, "2");
    connectInput(ctx, "reset", "reset", memory, "3");
    connectInput(ctx, "clock", "clock", memory, "4");
    connectOutput(ctx, "out", memory, "5", "out");
  }, { colour, note, width: 760 });
}

memoryWrapper("N2T RAM8", TYPE.RAM8, 3, "Eight 16-bit registers addressed by three bits.");
memoryWrapper("N2T RAM64", TYPE.RAM64, 6, "RAM8 banks selected by the upper address bits.");
memoryWrapper("N2T RAM512", TYPE.RAM512, 9, "RAM64 banks selected by the upper address bits.");
memoryWrapper("N2T RAM4K", TYPE.RAM4K, 12, "RAM512 banks selected by the upper address bits.");
memoryWrapper("N2T RAM16K", TYPE.RAM16K, 14, "RAM4K banks selected by the upper address bits.");
memoryWrapper("N2T SCREEN", TYPE.SCREEN, 13, "A memory-mapped 16-bit screen surface. The engine owns the pixel storage contract.", COLOUR.computer);
memoryWrapper("N2T MEMORY", TYPE.MEMORY, 15, "The Hack memory boundary: address, data, load, reset, and clock.");

register("N2T ROM32K", [logicInput("address", "ADDRESS", 15)], [logicOutput("out", "OUT", 16)], (ctx) => {
  const rom = child(ctx, "rom", TYPE.ROM32K, 0, 0);
  connectInput(ctx, "address", "address", rom, "0");
  connectOutput(ctx, "out", rom, "1", "out");
}, { colour: COLOUR.memory, note: "Read-only 32K x 16-bit instruction storage." });

register("N2T KEYBOARD", [], [logicOutput("out", "OUT", 16)], (ctx) => {
  const keyboard = child(ctx, "keyboard", TYPE.KEYBOARD, 0, 0);
  connectOutput(ctx, "out", keyboard, "0", "out");
}, { colour: COLOUR.computer, note: "The keyboard boundary exposes a 16-bit key code to the computer." });

register("N2T INSTRUCTION DECODER", [logicInput("instruction", "INSTRUCTION", 16)], [
  logicOutput("isC", "IS C"), logicOutput("a", "A"), logicOutput("zx", "ZX"), logicOutput("nx", "NX"), logicOutput("zy", "ZY"), logicOutput("ny", "NY"), logicOutput("f", "F"), logicOutput("no", "NO"), logicOutput("destA", "DEST A"), logicOutput("destD", "DEST D"), logicOutput("destM", "DEST M"), logicOutput("jump2", "J2"), logicOutput("jump1", "J1"), logicOutput("jump0", "J0")
], (ctx) => {
  const split = child(ctx, "split", TYPE.SPLIT16, 0, 0);
  connectInput(ctx, "instruction", "instruction", split, "0");
  const fields = [["isC", 1], ["a", 4], ["zx", 5], ["nx", 6], ["zy", 7], ["ny", 8], ["f", 9], ["no", 10], ["destA", 11], ["destD", 12], ["destM", 13], ["jump2", 14], ["jump1", 15], ["jump0", 16]];
  fields.forEach(([id, splitPin]) => connectOutput(ctx, `field-${id}`, split, String(splitPin), id));
}, { colour: COLOUR.computer, note: "The instruction bit positions are surfaced as named control signals for the CPU." , width: 700, height: 560 });

register("N2T CPU", [logicInput("inM", "IN M", 16), logicInput("instruction", "INSTRUCTION", 16), logicInput("reset", "RESET"), logicInput("clock", "CLOCK")], [logicOutput("outM", "OUT M", 16), logicOutput("writeM", "WRITE M"), logicOutput("addressM", "ADDRESS M", 15), logicOutput("pc", "PC", 15)], (ctx) => {
  const cpu = child(ctx, "cpu", TYPE.CPU, 0, 0);
  connectInput(ctx, "inM", "inM", cpu, "0");
  connectInput(ctx, "instruction", "instruction", cpu, "1");
  connectInput(ctx, "reset", "reset", cpu, "2");
  connectInput(ctx, "clock", "clock", cpu, "3");
  connectOutput(ctx, "outM", cpu, "4", "outM");
  connectOutput(ctx, "writeM", cpu, "5", "writeM");
  connectOutput(ctx, "addressM", cpu, "6", "addressM");
  connectOutput(ctx, "pc", cpu, "7", "pc");
}, { colour: COLOUR.computer, note: "The native engine contract executes Hack A- and C-instructions while keeping the observable CPU pins explicit.", width: 760, height: 520 });

register("N2T COMPUTER", [logicInput("reset", "RESET"), logicInput("clock", "CLOCK")], [logicOutput("outM", "OUT M", 16), logicOutput("addressM", "ADDRESS M", 15), logicOutput("writeM", "WRITE M"), logicOutput("pc", "PC", 15), logicOutput("memoryOut", "MEMORY OUT", 16)], (ctx) => {
  const cpu = child(ctx, "cpu", "N2T CPU", -160, 0);
  const rom = child(ctx, "rom", "N2T ROM32K", -160, -180);
  const memory = child(ctx, "memory", "N2T MEMORY", 160, 100);
  connectInput(ctx, "reset-cpu", "reset", cpu, "reset");
  connectInput(ctx, "clock-cpu", "clock", cpu, "clock");
  connectInput(ctx, "reset-memory", "reset", memory, "reset");
  connectInput(ctx, "clock-memory", "clock", memory, "clock");
  connect(ctx, "pc-rom", cpu, "pc", rom, "address");
  connect(ctx, "rom-cpu", rom, "out", cpu, "instruction");
  connect(ctx, "address-memory", cpu, "addressM", memory, "address");
  connect(ctx, "out-memory", cpu, "outM", memory, "in");
  connect(ctx, "write-memory", cpu, "writeM", memory, "load");
  connect(ctx, "memory-cpu", memory, "out", cpu, "inM");
  connectOutput(ctx, "outM", cpu, "outM", "outM");
  connectOutput(ctx, "addressM", cpu, "addressM", "addressM");
  connectOutput(ctx, "writeM", cpu, "writeM", "writeM");
  connectOutput(ctx, "pc", cpu, "pc", "pc");
  connectOutput(ctx, "memoryOut", memory, "out", "memoryOut");
}, { colour: COLOUR.computer, note: "The complete Hack-shaped boundary: instruction ROM, CPU, and data memory are connected as one inspectable computer.", width: 860, height: 600 });

const hardwareStages = [
  { id: "00-nand", title: "NAND foundation", chips: ["N2T NAND"], capability: "One universal two-input gate; every later Boolean construction can be reduced to it." },
  { id: "01-logic", title: "Elementary Boolean logic", chips: ["N2T NOT", "N2T AND", "N2T OR", "N2T XOR", "N2T NOR", "N2T XNOR", "N2T BUFFER"], capability: "Truth tables become reusable, inspectable gates." },
  { id: "02-routing", title: "Selection and routing", chips: ["N2T MUX", "N2T DMUX", "N2T OR8WAY", "N2T MUX4WAY", "N2T MUX8WAY", "N2T DMUX4WAY", "N2T DMUX8WAY"], capability: "One signal can be selected, distributed, or gathered through a small routing hierarchy." },
  { id: "03-multibit", title: "Multi-bit logic", chips: ["N2T NOT16", "N2T AND16", "N2T OR16", "N2T XOR16", "N2T MUX16"], capability: "The same one-bit logic is lifted into parallel 16-bit words." },
  { id: "04-arithmetic", title: "Arithmetic", chips: ["N2T HALF ADDER", "N2T FULL ADDER", "N2T ADD16", "N2T INC16", "N2T SUB16", "N2T COMPARE16", "N2T ALU"], capability: "Words can add, increment, subtract, compare, and perform controlled ALU operations." },
  { id: "05-state", title: "Sequential state", chips: ["DFF", "N2T BIT", "N2T REGISTER", "N2T A REGISTER", "N2T D REGISTER", "N2T PC"], capability: "A clock turns combinational paths into persistent state and controlled time flow." },
  { id: "06-memory", title: "Memory hierarchy", chips: ["N2T RAM8", "N2T RAM64", "N2T RAM512", "N2T RAM4K", "N2T RAM16K", "N2T ROM32K", "N2T SCREEN", "N2T KEYBOARD", "N2T MEMORY"], capability: "Address bits select progressively larger memory structures and device-mapped regions." },
  { id: "07-instruction", title: "Instruction representation", chips: ["N2T INSTRUCTION DECODER"], capability: "A 16-bit instruction becomes named control fields: computation, destinations, and jumps." },
  { id: "08-cpu", title: "CPU building blocks", chips: ["N2T CPU"], capability: "A Hack-shaped CPU executes A- and C-instructions and exposes the memory protocol." },
  { id: "09-computer", title: "Complete computer boundary", chips: ["N2T COMPUTER"], capability: "Instruction ROM, CPU, and data memory form one inspectable computer-like system." }
];

const softwareStages = [
  {
    id: "10-hack-assembly",
    name: "Hack assembly",
    predecessor: "N2T COMPUTER",
    capability: "Write symbolic A- and C-instructions for the Hack CPU.",
    implementation: "learning-artifact",
    requiredEngine: ["CPU instruction contract", "ROM program loading"]
  },
  {
    id: "11-assembler",
    name: "Assembler",
    predecessor: "Hack assembly",
    capability: "Translate Hack assembly text into 16-bit machine code and symbols.",
    implementation: "not-a-canvas-chip",
    requiredEngine: ["text editor or file input", "assembler module", "ROM program loading"]
  },
  {
    id: "12-vm",
    name: "Virtual machine",
    predecessor: "Assembler",
    capability: "Translate stack-based VM commands into Hack assembly.",
    implementation: "not-a-canvas-chip",
    requiredEngine: ["VM translator", "assembler bridge", "execution diagnostics"]
  },
  {
    id: "13-jack-language",
    name: "Jack-like language",
    predecessor: "Virtual machine",
    capability: "Program with a small Java-like object-oriented language.",
    implementation: "not-a-canvas-chip",
    requiredEngine: ["source editor", "parser", "runtime library"]
  },
  {
    id: "14-compiler",
    name: "Jack compiler",
    predecessor: "Jack-like language",
    capability: "Compile Jack source into VM code and connect it to the machine track.",
    implementation: "not-a-canvas-chip",
    requiredEngine: ["compiler", "VM translator", "assembler", "ROM program loading"]
  },
  {
    id: "15-jack-os",
    name: "Jack OS",
    predecessor: "Jack compiler",
    capability: "Provide memory, math, screen, keyboard, output, and string services in the teaching runtime.",
    implementation: "not-a-canvas-chip",
    requiredEngine: ["OS library modules", "device model", "program loader"]
  },
  {
    id: "16-modern-isa",
    name: "Modern instruction-set bridge",
    predecessor: "Jack OS",
    capability: "Compare the teaching Hack machine with a real ISA such as RISC-V RV32I or ARM Thumb/AArch64.",
    implementation: "future-engine-track",
    requiredEngine: ["new ISA decoder", "new assembler", "ABI/runtime model"],
    note: "This is a later bridge, not part of the original Nand2Tetris hardware path."
  },
  {
    id: "17-real-os",
    name: "Real operating-system bridge",
    predecessor: "Modern instruction-set bridge",
    capability: "Move from teaching services to boot, interrupts, drivers, virtual memory, processes, filesystems, and networking.",
    implementation: "future-engine-track",
    requiredEngine: ["boot/runtime boundary", "interrupts", "device drivers", "process model", "filesystem", "networking"]
  }
];

function emptyRoot(name, width = 1800, height = 1100) {
  return {
    id: "root",
    name,
    type: "custom",
    kind: "custom",
    size: { x: width, y: height },
    colour: "#202b3a",
    nameLocation: "top",
    inputPins: [],
    outputPins: [],
    instances: [],
    wires: [],
    junctions: [],
    displays: [],
    annotations: []
  };
}

function addRootNode(root, id, type, x, y, label = "") {
  root.instances.push(node(id, type, { x, y }, label));
  return id;
}

function addRootWire(root, id, sourceOwner, sourcePin, targetOwner, targetPin) {
  root.wires.push(wire(id, endpoint(sourceOwner, sourcePin), endpoint(targetOwner, targetPin)));
}

function makeAluLab() {
  const root = emptyRoot("Nand2Tetris ALU Lab");
  addRootNode(root, "input-x", TYPE.IN(16), -700, -120, "X");
  addRootNode(root, "input-y", TYPE.IN(16), -700, 120, "Y");
  ["zx", "nx", "zy", "ny", "f", "no"].forEach((label, index) => addRootNode(root, `input-${label}`, TYPE.IN(1), -700, 300 + index * 60, label.toUpperCase()));
  addRootNode(root, "alu", "N2T ALU", 0, 0, "Hack-style ALU");
  addRootNode(root, "output", TYPE.OUT(16), 700, -80, "OUT");
  addRootNode(root, "zero", TYPE.OUT(1), 700, 80, "ZR");
  addRootNode(root, "negative", TYPE.OUT(1), 700, 160, "NG");
  addRootNode(root, "carry", TYPE.OUT(1), 700, 240, "CARRY");
  addRootWire(root, "x", "input-x", "0", "alu", "x");
  addRootWire(root, "y", "input-y", "0", "alu", "y");
  ["zx", "nx", "zy", "ny", "f", "no"].forEach(label => addRootWire(root, label, `input-${label}`, "0", "alu", label));
  addRootWire(root, "out", "alu", "out", "output", "0");
  addRootWire(root, "zr", "alu", "zr", "zero", "0");
  addRootWire(root, "ng", "alu", "ng", "negative", "0");
  addRootWire(root, "carry", "alu", "carry", "carry", "0");
  root.annotations.push({ id: "lab-note", type: "text", text: "Try X=0x000F, Y=0x0001 and select F=1. The ALU's control pins are the same conceptual signals used by the Hack machine.", position: { x: -620, y: -480 }, width: 1240, height: 100, fontSize: 13, colour: "#d7eaff", background: "#2f3338" });
  return root;
}

function makeBitLab() {
  const root = emptyRoot("Nand2Tetris BIT Lab", 1100, 700);
  addRootNode(root, "data", TYPE.IN(1), -380, -120, "DATA");
  addRootNode(root, "load", TYPE.IN(1), -380, 0, "LOAD");
  addRootNode(root, "clock", TYPE.IN(1), -380, 120, "CLOCK");
  addRootNode(root, "bit", "N2T BIT", 0, 0, "BIT");
  addRootNode(root, "output", TYPE.OUT(1), 380, 0, "OUT");
  addRootWire(root, "data", "data", "0", "bit", "in");
  addRootWire(root, "load", "load", "0", "bit", "load");
  addRootWire(root, "clock", "clock", "0", "bit", "clock");
  addRootWire(root, "out", "bit", "out", "output", "0");
  root.annotations.push({ id: "bit-note", type: "text", text: "Toggle DATA, then raise CLOCK while LOAD is high. Lower LOAD and clock again to see the stored value persist.", position: { x: -360, y: -280 }, width: 720, height: 90, fontSize: 13, colour: "#d7eaff", background: "#2f3338" });
  return root;
}

function makeComputerLab() {
  const root = emptyRoot("Nand2Tetris Computer Lab", 1400, 900);
  addRootNode(root, "reset", TYPE.IN(1), -540, -80, "RESET");
  addRootNode(root, "clock", TYPE.IN(1), -540, 80, "CLOCK");
  addRootNode(root, "computer", "N2T COMPUTER", 0, 0, "Hack Computer");
  addRootNode(root, "pc", TYPE.OUT(16), 540, -120, "PC");
  addRootNode(root, "address", TYPE.OUT(16), 540, 0, "ADDRESS M");
  addRootNode(root, "memory", TYPE.OUT(16), 540, 120, "MEMORY OUT");
  addRootWire(root, "reset", "reset", "0", "computer", "reset");
  addRootWire(root, "clock", "clock", "0", "computer", "clock");
  addRootWire(root, "pc", "computer", "pc", "pc", "0");
  addRootWire(root, "address", "computer", "addressM", "address", "0");
  addRootWire(root, "memory", "computer", "memoryOut", "memory", "0");
  root.annotations.push({ id: "computer-note", type: "text", text: "The bundled ROM starts at zero, so this is intentionally a quiet machine until a program is loaded into ROM32K. Open the composite in X-ray mode to follow the CPU, ROM, and memory contracts.", position: { x: -560, y: -340 }, width: 1120, height: 100, fontSize: 13, colour: "#d7eaff", background: "#2f3338" });
  return root;
}

function collectDependencies(name, result = new Map()) {
  const description = custom.get(name);
  if (!description) return result;
  for (const instance of description.instances ?? []) {
    if (!custom.has(instance.name) || result.has(instance.name)) continue;
    result.set(instance.name, custom.get(instance.name));
    collectDependencies(instance.name, result);
  }
  return result;
}

function projectWithRoot(name, root) {
  const rawCustom = Object.fromEntries(custom);
  const first = normalizeProject({ name, root, customChips: rawCustom });
  // normalizeProject deliberately avoids depending on another custom chip's
  // fit while all descriptions are being migrated. The generated set is
  // acyclic, so converge the reusable geometry from leaves toward composites
  // before serializing it. This keeps a reusable chip's natural canvas size
  // instead of inheriting the temporary placeholder size of its children.
  for (let pass = 0; pass < custom.size + 2; pass += 1) {
    for (const description of Object.values(first.customChips)) refreshReusableFit(first, description);
  }
  return normalizeProject({ ...first, name, root, customChips: first.customChips, updatedAt: UPDATED_AT, createdAt: UPDATED_AT });
}

function fileName(name) { return `${slug(name)}.json`; }

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const normalizedProject = projectWithRoot("Nand2Tetris Hardware Progression", emptyRoot("Nand2Tetris Hardware Progression"));
const normalizedCustom = new Map(Object.entries(normalizedProject.customChips));
const nativeChipNames = [
  "NAND", "DFF", "CONST-0", "CONST-1", "CONST-0-16", "CONST-1-16", "REGISTER-16", "PROGRAM COUNTER",
  "RAM8", "RAM64", "RAM512", "RAM4K", "RAM16K", "ROM32K", "SCREEN", "KEYBOARD", "MEMORY", "HACK CPU"
];
const nativeChipNameSet = new Set(nativeChipNames);
const projectRoots = {
  "nand2tetris-hardware-lab": makeAluLab(),
  "nand2tetris-bit-lab": makeBitLab(),
  "nand2tetris-computer-lab": makeComputerLab()
};

await mkdir(chipDirectory, { recursive: true });
await mkdir(projectDirectory, { recursive: true });
await mkdir(softwareDirectory, { recursive: true });

for (const [name, description] of normalizedCustom) {
  const dependencies = Object.fromEntries([...collectDependencies(name)].map(([dependencyName]) => [dependencyName, normalizedCustom.get(dependencyName)]));
  await writeJson(path.join(chipDirectory, fileName(name)), {
    schema: "digital-logic-sim-web/chip/1",
    name,
    updatedAt: UPDATED_AT,
    description,
    dependencyNames: Object.keys(dependencies),
    dependencies
  });
}

for (const name of nativeChipNames) {
  const description = BUILTINS[name];
  if (!description) throw new Error(`Missing native catalog primitive: ${name}`);
  await writeJson(path.join(chipDirectory, fileName(name)), {
    schema: "digital-logic-sim-web/chip/1",
    name,
    updatedAt: UPDATED_AT,
    native: true,
    description,
    dependencyNames: [],
    dependencies: {}
  });
}

for (const [id, rootDescription] of Object.entries(projectRoots)) {
  const project = projectWithRoot(id, rootDescription);
  project.storageId = `nand2tetris-${id}`;
  project.updatedAt = UPDATED_AT;
  project.createdAt = UPDATED_AT;
  await writeJson(path.join(projectDirectory, `${id}.json`), project);
}

for (const stage of softwareStages) {
  await writeJson(path.join(softwareDirectory, `${stage.id}.json`), {
    schema: "digital-logic-sim-web/learning-stage/1",
    track: "nand2tetris",
    kind: "software-stage",
    updatedAt: UPDATED_AT,
    ...stage,
    dlsBoundary: stage.implementation === "learning-artifact" ? "The browser simulator can display and eventually execute this layer, but it is not a canvas chip." : "Not implemented as a canvas chip; it belongs to the companion language/runtime track."
  });
}

const nativePrimitives = [
  { name: "NAND", role: "existing-native", reason: "universal Boolean primitive" },
  { name: "DFF", role: "new-native", reason: "clocked one-bit state" },
  { name: "CONST-0", role: "new-native", reason: "explicit logic zero source" },
  { name: "CONST-1", role: "new-native", reason: "explicit logic one source" },
  { name: "CONST-0-16", role: "new-native", reason: "explicit 16-bit zero source" },
  { name: "CONST-1-16", role: "new-native", reason: "explicit 16-bit one source" },
  { name: "REGISTER-16", role: "new-native", reason: "bounded 16-bit state register contract" },
  { name: "PROGRAM COUNTER", role: "new-native", reason: "bounded increment/load/reset state contract" },
  { name: "RAM8/RAM64/RAM512/RAM4K/RAM16K", role: "new-native", reason: "bounded efficient memory contracts" },
  { name: "ROM32K", role: "new-native", reason: "Hack instruction memory contract" },
  { name: "MEMORY", role: "new-native", reason: "Hack data-memory boundary" },
  { name: "HACK CPU", role: "new-native", reason: "executable Hack instruction contract" }
];

await writeJson(path.join(outputRoot, "manifest.json"), {
  schema: "digital-logic-sim-web/nand2tetris/1",
  name: "Nand2Tetris chip progression",
  updatedAt: UPDATED_AT,
  reference: "The Elements of Computing Systems by Noam Nisan and Shimon Schocken (Nand2Tetris)",
  hardwareStages: hardwareStages.map(stage => ({ ...stage, chipFiles: stage.chips.filter(name => custom.has(name) || nativeChipNameSet.has(name)).map(fileName) })),
  chips: [
    ...normalizedCustom.keys(),
    ...nativeChipNames
  ].map(name => ({ name, file: `chips/${fileName(name)}`, native: nativeChipNameSet.has(name), dependencies: [...collectDependencies(name).keys()] })),
  nativePrimitives,
  projects: Object.keys(projectRoots).map(id => ({ name: id, file: `projects/${id}.json` })),
  softwareStages: softwareStages.map(stage => ({ ...stage, file: `software/${stage.id}.json` })),
  boundary: "The hardware path is represented by executable nested chip JSONs. The assembly, VM, language, OS, ARM/RISC-V, and real-OS landmarks are recorded as companion learning-stage JSONs because they are tools and runtimes, not canvas chips."
});

console.log(`Built ${normalizedCustom.size} custom and ${nativeChipNames.length} native Nand2Tetris chips, ${Object.keys(projectRoots).length} projects, and ${softwareStages.length} software-stage records.`);
