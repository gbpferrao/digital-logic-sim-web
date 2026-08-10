import { clone } from "./core.js";

export const GRID = 20;

export const TYPE = Object.freeze({
  CUSTOM: "custom",
  AND: "AND",
  OR: "OR",
  NOT: "NOT",
  NAND: "NAND",
  NOR: "NOR",
  XOR: "XOR",
  XNOR: "XNOR",
  BUFFER: "BUFFER",
  TRI_STATE: "3-STATE BUFFER",
  CLOCK: "CLOCK",
  PULSE: "PULSE",
  RAM: "dev.RAM-8",
  ROM: "ROM 256x16",
  SEVEN_SEG: "7-SEGMENT",
  RGB: "RGB DISPLAY",
  DOT: "DOT DISPLAY",
  LED: "LED",
  MERGE_1_4: "1-4BIT",
  MERGE_1_8: "1-8BIT",
  MERGE_4_8: "4-8BIT",
  SPLIT_4_1: "4-1BIT",
  SPLIT_8_4: "8-4BIT",
  SPLIT_8_1: "8-1BIT",
  IN_1: "IN-1",
  IN_4: "IN-4",
  IN_8: "IN-8",
  OUT_1: "OUT-1",
  OUT_4: "OUT-4",
  OUT_8: "OUT-8",
  KEY: "KEY",
  BUS_1: "BUS-1",
  BUS_4: "BUS-4",
  BUS_8: "BUS-8",
  BUS_END_1: "BUS-TERMINUS-1",
  BUS_END_4: "BUS-TERMINUS-4",
  BUS_END_8: "BUS-TERMINUS-8",
  BUZZER: "BUZZER"
});

export const COLORS = Object.freeze({
  dark: "#202b3a",
  nand: "#b94e57",
  logic: "#a15c68",
  bus: "#3b4659",
  io: "#3f7ea2",
  memory: "#a66b42",
  rom: "#45658e",
  display: "#3a4658",
  convert: "#343c4b",
  custom: "#7358ad",
  audio: "#4b5361"
});

function pin(id, name, bits = 1, direction = "input", x = 0, y = 0) {
  return { id: String(id), name, bits, direction, x, y, valueDisplay: "off", colour: direction === "output" ? "green" : "gray" };
}

function assignPinPositions(inputs, outputs, width, height) {
  const position = (pins, x) => {
    if (!pins.length) return;
    const spacing = Math.min(20, Math.max(12, (height - 10) / pins.length));
    const total = spacing * (pins.length - 1);
    pins.forEach((item, index) => {
      item.x = x;
      item.y = total / 2 - index * spacing;
    });
  };
  position(inputs, -width / 2);
  position(outputs, width / 2);
}

function builtin(name, type, inputs = [], outputs = [], options = {}) {
  const width = options.width ?? GRID * 8;
  const height = options.height ?? Math.max(GRID * 4, (Math.max(inputs.length, outputs.length) + 1) * 12);
  assignPinPositions(inputs, outputs, width, height);
  return {
    id: `builtin-${name}`,
    name,
    type,
    kind: options.kind ?? "builtin",
    size: { x: width, y: height },
    colour: options.colour ?? COLORS.dark,
    nameLocation: options.nameLocation ?? "centre",
    gate: options.gate ?? null,
    inputPins: inputs,
    outputPins: outputs,
    instances: [],
    wires: [],
    displays: options.displays ?? [],
    special: options.special ?? null,
    builtin: true
  };
}

function createBuiltins() {
  const all = {};
  const add = (desc) => { all[desc.name] = desc; };

  const gateInputs = [pin(0, "IN B"), pin(1, "IN A")];
  const gateOutput = [pin(2, "OUT", 1, "output")];
  const addTwoInputGate = (name, gate, colour = COLORS.logic) => add(builtin(name, name, clone(gateInputs), clone(gateOutput), {
    width: GRID * 6, height: GRID * 4, colour, special: "logicGate", gate, nameLocation: "hidden"
  }));
  addTwoInputGate(TYPE.AND, "and");
  addTwoInputGate(TYPE.OR, "or");
  addTwoInputGate(TYPE.NAND, "nand", COLORS.nand);
  addTwoInputGate(TYPE.NOR, "nor");
  addTwoInputGate(TYPE.XOR, "xor");
  addTwoInputGate(TYPE.XNOR, "xnor");
  add(builtin(TYPE.NOT, TYPE.NOT, [pin(0, "IN")], [pin(1, "OUT", 1, "output")], {
    width: GRID * 6, height: GRID * 4, colour: COLORS.logic, special: "logicGate", gate: "not", nameLocation: "hidden"
  }));
  add(builtin(TYPE.BUFFER, TYPE.BUFFER, [pin(0, "IN")], [pin(1, "OUT", 1, "output")], {
    width: GRID * 6, height: GRID * 4, colour: COLORS.logic, special: "logicGate", gate: "buffer", nameLocation: "hidden"
  }));
  add(builtin(TYPE.TRI_STATE, TYPE.TRI_STATE,
    [pin(0, "IN"), pin(1, "ENABLE")], [pin(2, "OUT", 1, "output")], { width: GRID * 2, height: GRID * 5 }));
  add(builtin(TYPE.CLOCK, TYPE.CLOCK, [], [pin(0, "CLK", 1, "output")], { width: GRID * 2, height: GRID * 3, special: "clock" }));
  add(builtin(TYPE.PULSE, TYPE.PULSE, [pin(0, "IN")], [pin(1, "PULSE", 1, "output")], { width: GRID * 2, height: GRID * 3, special: "pulse" }));

  const io = [
    [TYPE.IN_1, 1], [TYPE.IN_4, 4], [TYPE.IN_8, 8],
    [TYPE.OUT_1, 1], [TYPE.OUT_4, 4], [TYPE.OUT_8, 8]
  ];
  io.forEach(([name, bits]) => {
    const input = name.startsWith("IN-");
    add(builtin(name, name, input ? [] : [pin(0, "IN", bits)], input ? [pin(0, "OUT", bits, "output")] : [], {
      width: GRID * 3, height: GRID * 3, colour: COLORS.io, kind: input ? "input" : "output", nameLocation: "hidden"
    }));
  });
  add(builtin(TYPE.KEY, TYPE.KEY, [], [pin(0, "OUT", 1, "output")], { width: GRID * 3, height: GRID * 3, nameLocation: "hidden", special: "key" }));

  add(builtin(TYPE.RAM, TYPE.RAM,
    [pin(0, "ADDRESS", 8), pin(1, "DATA", 8), pin(2, "WRITE"), pin(3, "RESET"), pin(4, "CLOCK")],
    [pin(5, "OUT", 8, "output")], { width: GRID * 10, height: GRID * 6, colour: COLORS.memory, special: "ram" }));
  add(builtin(TYPE.ROM, TYPE.ROM, [pin(0, "ADDRESS", 8)], [pin(1, "OUT B", 8, "output"), pin(2, "OUT A", 8, "output")], {
    width: GRID * 12, height: GRID * 4, colour: COLORS.rom, special: "rom"
  }));

  const conversions = [
    [TYPE.SPLIT_4_1, 4, 1, 1, 4], [TYPE.SPLIT_8_4, 8, 4, 1, 2], [TYPE.SPLIT_8_1, 8, 1, 1, 8],
    [TYPE.MERGE_1_8, 1, 8, 8, 1], [TYPE.MERGE_1_4, 1, 4, 4, 1], [TYPE.MERGE_4_8, 4, 8, 2, 1]
  ];
  conversions.forEach(([name, inBits, outBits, inputCount, outputCount]) => {
    const inputs = Array.from({ length: inputCount }, (_, index) => pin(index, inputCount === 1 ? "IN" : `IN ${String.fromCharCode(65 + inputCount - index - 1)}`, inBits));
    const outputs = Array.from({ length: outputCount }, (_, index) => pin(inputCount + index, outputCount === 1 ? "OUT" : `OUT ${String.fromCharCode(65 + outputCount - index - 1)}`, outBits, "output"));
    add(builtin(name, name, inputs, outputs, { width: GRID * 9, height: Math.max(GRID * 4, (Math.max(inputCount, outputCount) + 1) * 12), colour: COLORS.convert, special: "convert" }));
  });

  add(builtin(TYPE.SEVEN_SEG, TYPE.SEVEN_SEG,
    ["A", "B", "C", "D", "E", "F", "G", "COL"].map((name, id) => pin(id, name)), [], {
      width: GRID * 10, height: GRID * 7, colour: COLORS.display, special: "sevenSegment", nameLocation: "hidden", displays: [{ type: "sevenSegment" }]
    }));
  add(builtin(TYPE.LED, TYPE.LED, [pin(0, "IN")], [], { width: GRID * 4, height: GRID * 4, colour: COLORS.display, special: "led", nameLocation: "hidden", displays: [{ type: "led" }] }));
  add(builtin(TYPE.DOT, TYPE.DOT,
    [pin(0, "ADDRESS", 8), pin(1, "PIXEL IN"), pin(2, "RESET"), pin(3, "WRITE"), pin(4, "REFRESH"), pin(5, "CLOCK")],
    [pin(6, "PIXEL OUT", 1, "output")], { width: GRID * 12, height: GRID * 12, colour: COLORS.display, special: "dot", nameLocation: "hidden", displays: [{ type: "dot" }] }));
  add(builtin(TYPE.RGB, TYPE.RGB,
    [pin(0, "ADDRESS", 8), pin(1, "RED", 4), pin(2, "GREEN", 4), pin(3, "BLUE", 4), pin(4, "RESET"), pin(5, "WRITE"), pin(6, "REFRESH"), pin(7, "CLOCK")],
    [pin(8, "R OUT", 4, "output"), pin(9, "G OUT", 4, "output"), pin(10, "B OUT", 4, "output")], {
      width: GRID * 21, height: GRID * 21, colour: COLORS.display, special: "rgb", nameLocation: "hidden", displays: [{ type: "rgb" }]
    }));

  const buses = [[TYPE.BUS_1, TYPE.BUS_END_1, 1], [TYPE.BUS_4, TYPE.BUS_END_4, 4], [TYPE.BUS_8, TYPE.BUS_END_8, 8]];
  buses.forEach(([originName, endName, bits]) => {
    add(builtin(originName, originName, [pin(0, `${originName} (Hidden)`, bits)], [pin(1, originName, bits, "output")], {
      width: GRID * 2, height: GRID * (bits === 1 ? 2 : bits === 4 ? 3 : 4), colour: COLORS.bus, kind: "busOrigin", nameLocation: "hidden", special: "bus"
    }));
    add(builtin(endName, endName, [pin(0, originName, bits)], [], {
      width: GRID * 2, height: GRID * (bits === 1 ? 2 : bits === 4 ? 3 : 4), colour: COLORS.bus, kind: "busTerminus", nameLocation: "hidden", special: "busTerminus"
    }));
  });
  add(builtin(TYPE.BUZZER, TYPE.BUZZER, [pin(1, "PITCH", 8), pin(0, "VOLUME", 4)], [], {
    width: GRID * 9, height: GRID * 4, colour: COLORS.audio, special: "buzzer"
  }));
  return all;
}

export const BUILTINS = Object.freeze(createBuiltins());

export const COLLECTIONS = [
  { name: "LOGIC", chips: [TYPE.AND, TYPE.OR, TYPE.NOT, TYPE.NAND, TYPE.NOR, TYPE.XOR, TYPE.XNOR, TYPE.BUFFER] },
  { name: "BASIC", chips: [TYPE.CLOCK, TYPE.PULSE, TYPE.KEY, TYPE.TRI_STATE] },
  { name: "IN/OUT", chips: [TYPE.IN_1, TYPE.IN_4, TYPE.IN_8, TYPE.OUT_1, TYPE.OUT_4, TYPE.OUT_8] },
  { name: "MERGE/SPLIT", chips: [TYPE.MERGE_1_4, TYPE.MERGE_1_8, TYPE.MERGE_4_8, TYPE.SPLIT_4_1, TYPE.SPLIT_8_4, TYPE.SPLIT_8_1] },
  { name: "BUS", chips: [TYPE.BUS_1, TYPE.BUS_4, TYPE.BUS_8] },
  { name: "DISPLAY", chips: [TYPE.SEVEN_SEG, TYPE.DOT, TYPE.RGB, TYPE.LED] },
  { name: "MEMORY", chips: [TYPE.ROM, TYPE.RAM] },
  { name: "AUDIO", chips: [TYPE.BUZZER] }
];

export const CUSTOM_COLLECTION = "CUSTOM";
