import { clone } from "./core.js";

export const GRID = 20;
export const MIN_CHIP_SIZE = Object.freeze({ x: GRID * 6, y: GRID * 4 });

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
  DFF: "DFF",
  REGISTER_16: "REGISTER-16",
  PC: "PROGRAM COUNTER",
  RAM: "dev.RAM-8",
  ROM: "ROM 256x16",
  RAM_8: "RAM8",
  RAM_64: "RAM64",
  RAM_512: "RAM512",
  RAM_4K: "RAM4K",
  RAM_16K: "RAM16K",
  ROM_32K: "ROM32K",
  SCREEN: "SCREEN",
  KEYBOARD: "KEYBOARD",
  MEMORY: "MEMORY",
  HACK_CPU: "HACK CPU",
  CONST_0: "CONST-0",
  CONST_1: "CONST-1",
  CONST_0_16: "CONST-0-16",
  CONST_1_16: "CONST-1-16",
  SEVEN_SEG: "7-SEGMENT",
  RGB: "RGB DISPLAY",
  DOT: "DOT DISPLAY",
  LED: "LED",
  MERGE_1_4: "1-4BIT",
  MERGE_1_8: "1-8BIT",
  MERGE_4_8: "4-8BIT",
  MERGE_1_16: "1-16BIT",
  MERGE_8_16: "8-16BIT",
  SPLIT_4_1: "4-1BIT",
  SPLIT_8_4: "8-4BIT",
  SPLIT_8_1: "8-1BIT",
  SPLIT_16_8: "16-8BIT",
  SPLIT_16_1: "16-1BIT",
  IN_1: "IN-1",
  IN_4: "IN-4",
  IN_8: "IN-8",
  IN_16: "IN-16",
  OUT_1: "OUT-1",
  OUT_4: "OUT-4",
  OUT_8: "OUT-8",
  OUT_16: "OUT-16",
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
  dark: "#4a535c",
  logic: "#706aa4",
  nand: "#8176b3",
  control: "#9b8653",
  bus: "#647488",
  io: "#4e8d91",
  memory: "#967451",
  rom: "#857654",
  display: "#5f7885",
  convert: "#5c8d78",
  custom: "#7358ad",
  audio: "#77738f"
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
  // Compact components keep their narrow visual geometry, but their
  // connection points live on the same minimum interaction bounds as every
  // other component.
  assignPinPositions(inputs, outputs, Math.max(width, MIN_CHIP_SIZE.x), Math.max(height, MIN_CHIP_SIZE.y));
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
    memorySize: options.memorySize ?? null,
    addressBits: options.addressBits ?? null,
    wordBits: options.wordBits ?? null,
    constantValue: options.constantValue ?? null,
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
    [pin(0, "IN"), pin(1, "ENABLE")], [pin(2, "OUT", 1, "output")], { width: GRID * 2, height: GRID * 5, colour: COLORS.control }));
  add(builtin(TYPE.CLOCK, TYPE.CLOCK, [], [pin(0, "CLK", 1, "output")], { width: GRID * 2, height: GRID * 3, colour: COLORS.control, special: "clock" }));
  add(builtin(TYPE.PULSE, TYPE.PULSE, [pin(0, "IN")], [pin(1, "PULSE", 1, "output")], { width: GRID * 2, height: GRID * 3, colour: COLORS.control, special: "pulse" }));
  add(builtin(TYPE.DFF, TYPE.DFF,
    [pin(0, "D"), pin(1, "CLOCK")], [pin(2, "Q", 1, "output")], {
      width: GRID * 6, height: GRID * 4, colour: COLORS.control, special: "dff", nameLocation: "hidden"
    }));
  add(builtin(TYPE.REGISTER_16, TYPE.REGISTER_16,
    [pin(0, "IN", 16), pin(1, "LOAD"), pin(2, "CLOCK")], [pin(3, "OUT", 16, "output")], {
      width: GRID * 10, height: GRID * 5, colour: COLORS.control, special: "register", nameLocation: "hidden"
    }));
  add(builtin(TYPE.PC, TYPE.PC,
    [pin(0, "IN", 16), pin(1, "LOAD"), pin(2, "INC"), pin(3, "RESET"), pin(4, "CLOCK")], [pin(5, "OUT", 16, "output")], {
      width: GRID * 12, height: GRID * 6, colour: COLORS.control, special: "pc", nameLocation: "hidden"
    }));

  add(builtin(TYPE.CONST_0, TYPE.CONST_0, [], [pin(0, "OUT", 1, "output")], {
    width: GRID * 3, height: GRID * 3, colour: COLORS.control, special: "constant", constantValue: 0, nameLocation: "hidden"
  }));
  add(builtin(TYPE.CONST_1, TYPE.CONST_1, [], [pin(0, "OUT", 1, "output")], {
    width: GRID * 3, height: GRID * 3, colour: COLORS.control, special: "constant", constantValue: 1, nameLocation: "hidden"
  }));
  add(builtin(TYPE.CONST_0_16, TYPE.CONST_0_16, [], [pin(0, "OUT", 16, "output")], {
    width: GRID * 4, height: GRID * 3, colour: COLORS.control, special: "constant", constantValue: 0, wordBits: 16, nameLocation: "hidden"
  }));
  add(builtin(TYPE.CONST_1_16, TYPE.CONST_1_16, [], [pin(0, "OUT", 16, "output")], {
    width: GRID * 4, height: GRID * 3, colour: COLORS.control, special: "constant", constantValue: 1, wordBits: 16, nameLocation: "hidden"
  }));

  const io = [
    [TYPE.IN_1, 1], [TYPE.IN_4, 4], [TYPE.IN_8, 8], [TYPE.IN_16, 16],
    [TYPE.OUT_1, 1], [TYPE.OUT_4, 4], [TYPE.OUT_8, 8], [TYPE.OUT_16, 16]
  ];
  io.forEach(([name, bits]) => {
    const input = name.startsWith("IN-");
    add(builtin(name, name, input ? [] : [pin(0, "IN", bits)], input ? [pin(0, "OUT", bits, "output")] : [], {
      width: GRID * 3, height: GRID * 3, colour: COLORS.io, kind: input ? "input" : "output", nameLocation: "hidden"
    }));
  });
  add(builtin(TYPE.KEY, TYPE.KEY, [], [pin(0, "OUT", 1, "output")], { width: GRID * 3, height: GRID * 3, colour: COLORS.control, nameLocation: "hidden", special: "key" }));

  add(builtin(TYPE.RAM, TYPE.RAM,
    [pin(0, "ADDRESS", 8), pin(1, "DATA", 8), pin(2, "WRITE"), pin(3, "RESET"), pin(4, "CLOCK")],
    [pin(5, "OUT", 8, "output")], { width: GRID * 10, height: GRID * 6, colour: COLORS.memory, special: "ram", memorySize: 256, addressBits: 8, wordBits: 8 }));
  add(builtin(TYPE.ROM, TYPE.ROM, [pin(0, "ADDRESS", 8)], [pin(1, "OUT B", 8, "output"), pin(2, "OUT A", 8, "output")], {
    width: GRID * 12, height: GRID * 4, colour: COLORS.rom, special: "rom", memorySize: 256, addressBits: 8, wordBits: 16
  }));

  const memory = [
    [TYPE.RAM_8, 3, 8], [TYPE.RAM_64, 6, 64], [TYPE.RAM_512, 9, 512], [TYPE.RAM_4K, 12, 4096], [TYPE.RAM_16K, 14, 16384]
  ];
  memory.forEach(([name, addressBits, memorySize]) => add(builtin(name, name,
    [pin(0, "ADDRESS", addressBits), pin(1, "IN", 16), pin(2, "LOAD"), pin(3, "RESET"), pin(4, "CLOCK")],
    [pin(5, "OUT", 16, "output")], {
      width: GRID * 12, height: GRID * 6, colour: COLORS.memory, special: "ram", memorySize, addressBits, wordBits: 16
    })));
  add(builtin(TYPE.ROM_32K, TYPE.ROM_32K, [pin(0, "ADDRESS", 15)], [pin(1, "OUT", 16, "output")], {
    width: GRID * 13, height: GRID * 5, colour: COLORS.rom, special: "rom", memorySize: 32768, addressBits: 15, wordBits: 16
  }));
  add(builtin(TYPE.SCREEN, TYPE.SCREEN,
    [pin(0, "ADDRESS", 13), pin(1, "IN", 16), pin(2, "LOAD"), pin(3, "RESET"), pin(4, "CLOCK")],
    [pin(5, "OUT", 16, "output")], {
      width: GRID * 13, height: GRID * 8, colour: COLORS.display, special: "screen", memorySize: 8192, addressBits: 13, wordBits: 16,
      displays: [{ type: "memoryScreen" }]
    }));
  add(builtin(TYPE.KEYBOARD, TYPE.KEYBOARD, [], [pin(0, "OUT", 16, "output")], {
    width: GRID * 8, height: GRID * 4, colour: COLORS.io, special: "keyboard", wordBits: 16, nameLocation: "hidden"
  }));
  add(builtin(TYPE.MEMORY, TYPE.MEMORY,
    [pin(0, "ADDRESS", 15), pin(1, "IN", 16), pin(2, "LOAD"), pin(3, "RESET"), pin(4, "CLOCK")],
    [pin(5, "OUT", 16, "output")], {
      width: GRID * 14, height: GRID * 7, colour: COLORS.memory, special: "memoryMap", memorySize: 32768, addressBits: 15, wordBits: 16
    }));
  add(builtin(TYPE.HACK_CPU, TYPE.HACK_CPU,
    [pin(0, "IN M", 16), pin(1, "INSTRUCTION", 16), pin(2, "RESET"), pin(3, "CLOCK")],
    [pin(4, "OUT M", 16, "output"), pin(5, "WRITE M", 1, "output"), pin(6, "ADDRESS M", 15, "output"), pin(7, "PC", 15, "output")], {
      width: GRID * 16, height: GRID * 9, colour: COLORS.control, special: "hackCpu"
    }));

  const conversions = [
    [TYPE.SPLIT_4_1, 4, 1, 1, 4], [TYPE.SPLIT_8_4, 8, 4, 1, 2], [TYPE.SPLIT_8_1, 8, 1, 1, 8],
    [TYPE.SPLIT_16_8, 16, 8, 1, 2], [TYPE.SPLIT_16_1, 16, 1, 1, 16],
    [TYPE.MERGE_1_8, 1, 8, 8, 1], [TYPE.MERGE_1_4, 1, 4, 4, 1], [TYPE.MERGE_4_8, 4, 8, 2, 1],
    [TYPE.MERGE_1_16, 1, 16, 16, 1], [TYPE.MERGE_8_16, 8, 16, 2, 1]
  ];
  conversions.forEach(([name, inBits, outBits, inputCount, outputCount]) => {
    const inputs = Array.from({ length: inputCount }, (_, index) => pin(index, inputCount === 1 ? "IN" : `IN ${String.fromCharCode(65 + inputCount - index - 1)}`, inBits));
    const outputs = Array.from({ length: outputCount }, (_, index) => pin(inputCount + index, outputCount === 1 ? "OUT" : `OUT ${String.fromCharCode(65 + outputCount - index - 1)}`, outBits, "output"));
    add(builtin(name, name, inputs, outputs, { width: GRID * 9, height: Math.max(GRID * 4, (Math.max(inputCount, outputCount) + 1) * 12), colour: COLORS.convert, special: "convert" }));
  });

  add(builtin(TYPE.SEVEN_SEG, TYPE.SEVEN_SEG,
    ["A", "B", "C", "D", "E", "F", "G", "COL"].map((name, id) => pin(id, name)), [], {
      width: GRID * 8, height: GRID * 9, colour: COLORS.display, special: "sevenSegment", nameLocation: "hidden", displays: [{ type: "sevenSegment" }]
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
  { name: "BASIC", chips: [TYPE.CLOCK, TYPE.PULSE, TYPE.KEY, TYPE.TRI_STATE, TYPE.DFF, TYPE.CONST_0, TYPE.CONST_1, TYPE.CONST_0_16, TYPE.CONST_1_16] },
  { name: "IN/OUT", chips: [TYPE.IN_1, TYPE.IN_4, TYPE.IN_8, TYPE.IN_16, TYPE.OUT_1, TYPE.OUT_4, TYPE.OUT_8, TYPE.OUT_16] },
  { name: "MERGE/SPLIT", chips: [TYPE.MERGE_1_4, TYPE.MERGE_1_8, TYPE.MERGE_4_8, TYPE.MERGE_1_16, TYPE.MERGE_8_16, TYPE.SPLIT_4_1, TYPE.SPLIT_8_4, TYPE.SPLIT_8_1, TYPE.SPLIT_16_8, TYPE.SPLIT_16_1] },
  { name: "BUS", chips: [TYPE.BUS_1, TYPE.BUS_4, TYPE.BUS_8] },
  { name: "DISPLAY", chips: [TYPE.SEVEN_SEG, TYPE.DOT, TYPE.RGB, TYPE.LED] },
  { name: "MEMORY", chips: [TYPE.ROM, TYPE.RAM, TYPE.RAM_8, TYPE.RAM_64, TYPE.RAM_512, TYPE.RAM_4K, TYPE.RAM_16K, TYPE.ROM_32K, TYPE.MEMORY, TYPE.SCREEN, TYPE.KEYBOARD, TYPE.REGISTER_16, TYPE.PC] },
  { name: "AUDIO", chips: [TYPE.BUZZER] }
];

export const CUSTOM_COLLECTION = "CUSTOM";
