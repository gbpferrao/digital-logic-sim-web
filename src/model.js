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

const COLORS = {
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
};

let nextId = 1;
export function uid(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  nextId += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextId.toString(36)}`;
}

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const DEFAULT_ANNOTATION_COLOUR = "#d7eaff";

function parseHexColour(value) {
  const raw = String(value ?? "").trim().replace(/^#/, "");
  const expanded = raw.length === 3 ? raw.split("").map((character) => character + character).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  const number = Number.parseInt(expanded, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function formatHexColour(channels) {
  return `#${channels.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`;
}

export function annotationPalette(colour = DEFAULT_ANNOTATION_COLOUR) {
  const base = parseHexColour(colour) ?? parseHexColour(DEFAULT_ANNOTATION_COLOUR);
  const mix = (target, amount) => formatHexColour(base.map((channel, index) => channel + (target[index] - channel) * amount));
  return {
    colour: formatHexColour(base),
    outline: mix([255, 255, 255], .3),
    background: mix([0, 0, 0], .78)
  };
}

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

function collectionOrderFor(rawOrder, collections) {
  const available = new Set([...COLLECTIONS, ...collections].map((collection) => String(collection.name)));
  available.add(CUSTOM_COLLECTION);
  const fallback = [...COLLECTIONS, ...collections].map((collection) => String(collection.name));
  fallback.push(CUSTOM_COLLECTION);
  const requested = Array.isArray(rawOrder) ? rawOrder.map((name) => String(name)) : fallback;
  const order = [];
  for (const name of [...requested, ...fallback]) {
    if (available.has(name) && !order.includes(name)) order.push(name);
  }
  return order;
}

export function isBuiltin(name) { return Boolean(BUILTINS[name]); }
export function isInputType(name) { return BUILTINS[name]?.kind === "input"; }
export function isOutputType(name) { return BUILTINS[name]?.kind === "output"; }
export function isDeviceType(name) { return isInputType(name) || isOutputType(name); }
export function isBusOrigin(name) { return BUILTINS[name]?.kind === "busOrigin"; }
export function isBusTerminus(name) { return BUILTINS[name]?.kind === "busTerminus"; }
export function getDescription(project, name) { return BUILTINS[name] ?? project.customChips?.[name] ?? null; }
export function getPin(description, pinId) {
  const id = String(pinId);
  return [...(description?.inputPins ?? []), ...(description?.outputPins ?? [])].find((item) => String(item.id) === id) ?? null;
}
export function getInputPin(description, pinId) { return (description?.inputPins ?? []).find((item) => String(item.id) === String(pinId)) ?? null; }
export function getOutputPin(description, pinId) { return (description?.outputPins ?? []).find((item) => String(item.id) === String(pinId)) ?? null; }

export function instanceFor(name, position = { x: 0, y: 0 }) {
  const desc = BUILTINS[name];
  return {
    id: uid("element"),
    name,
    position: { x: position.x, y: position.y },
    rotation: 0,
    label: "",
    internalData: defaultInternalData(desc),
    linkedBusPairId: null,
    outputPinColours: {}
  };
}

function defaultInternalData(desc) {
  if (!desc) return {};
  if (desc.special === "bus" || desc.special === "busTerminus") return { busFlipped: false };
  if (desc.special === "ram") return { memory: Array.from({ length: 256 }, () => 0), lastClock: 0 };
  if (desc.special === "rom") return { memory: Array.from({ length: 256 }, () => 0) };
  if (desc.special === "pulse") return { duration: 4, remaining: 0, previous: 0 };
  if (desc.special === "key") return { key: "Space" };
  if (desc.special === "dot") return { display: Array.from({ length: 256 }, () => 0), back: Array.from({ length: 256 }, () => 0), lastClock: 0 };
  if (desc.special === "rgb") return { display: Array.from({ length: 256 }, () => 0), back: Array.from({ length: 256 }, () => 0), lastClock: 0 };
  return {};
}

export function annotationBoundingBox(annotation) {
  const type = annotation?.type === "label" ? "label" : "text";
  const fontSize = Math.max(8, Number(annotation?.fontSize) || 11);
  return {
    x: Number(annotation?.position?.x) || 0,
    y: Number(annotation?.position?.y) || 0,
    w: Math.max(type === "label" ? 40 : 100, Number(annotation?.width) || (type === "label" ? 180 : 280)),
    h: Math.max(type === "label" ? fontSize * 1.8 : 40, Number(annotation?.height) || (type === "label" ? fontSize * 1.8 : 110))
  };
}

export function createRoot(name = "Main") {
  return {
    id: "root",
    name,
    type: TYPE.CUSTOM,
    kind: "custom",
    size: { x: GRID * 32, y: GRID * 22 },
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

export function createProject(name = "Untitled project") {
  const now = new Date().toISOString();
  return {
    schema: "digital-logic-sim-web/1",
    storageId: uid("project"),
    name,
    createdAt: now,
    updatedAt: now,
    root: createRoot("Main"),
    customChips: {},
    collections: clone(COLLECTIONS),
    collectionOrder: collectionOrderFor(null, COLLECTIONS),
    starred: ["IN/OUT", TYPE.NAND],
    settings: {
      snapping: true,
      straightWires: false,
      grid: true,
      simulationPaused: false,
      stepsPerSecond: 8,
      stepsPerClock: 8
    },
    inputValues: {},
    keyValues: {}
  };
}

export function normalizeProject(raw) {
  const base = createProject(raw?.name || "Untitled project");
  const project = { ...base, ...(raw ?? {}) };
  project.storageId = raw?.storageId || base.storageId;
  project.root = normalizeDescription({ ...base.root, ...(raw?.root ?? {}) });
  project.customChips = {};
  for (const [name, value] of Object.entries(raw?.customChips ?? {})) project.customChips[name] = normalizeDescription(value);
  project.settings = { ...base.settings, ...(raw?.settings ?? {}) };
  project.collections = raw?.collections?.length ? raw.collections : clone(COLLECTIONS);
  project.collectionOrder = collectionOrderFor(raw?.collectionOrder, project.collections);
  project.starred = raw?.starred ?? ["IN/OUT", TYPE.NAND];
  project.inputValues = { ...(raw?.inputValues ?? {}) };
  project.keyValues = { ...(raw?.keyValues ?? {}) };
  return project;
}

function normalizeDescription(raw) {
  const description = { ...raw };
  const normalizePin = (item, direction) => ({
    ...item,
    direction,
    valueDisplay: "off",
    colour: direction === "output" ? "green" : "gray",
    id: String(item.id)
  });
  description.inputPins = (raw?.inputPins ?? []).map((item) => normalizePin(item, "input"));
  description.outputPins = (raw?.outputPins ?? []).map((item) => normalizePin(item, "output"));
  description.instances = (raw?.instances ?? []).map((item) => ({
    id: String(item.id ?? uid("element")), name: item.name, position: { x: 0, y: 0, ...(item.position ?? {}) }, rotation: item.rotation ?? 0,
    label: item.label ?? "", internalData: item.internalData ?? {}, linkedBusPairId: item.linkedBusPairId ?? null, outputPinColours: item.outputPinColours ?? {}
  }));
  description.wires = (raw?.wires ?? []).map((wire) => ({
    id: String(wire.id ?? uid("wire")), source: { ...wire.source }, target: { ...wire.target }, points: (wire.points ?? []).map((point) => ({ x: point.x, y: point.y })), colour: wire.colour ?? null
  }));
  description.junctions = (raw?.junctions ?? []).map((junction) => ({ id: String(junction.id ?? uid("junction")), position: { x: Number(junction.position?.x) || 0, y: Number(junction.position?.y) || 0 }, bits: Number(junction.bits) || 1 }));
  description.displays = raw?.displays ?? [];
  description.annotations = (raw?.annotations ?? []).map((item) => {
    const type = item?.type === "label" ? "label" : "text";
    const fontSize = Math.max(8, Math.min(32, Number(item?.fontSize) || 11));
    const defaultWidth = type === "label" ? 180 : 280;
    const defaultHeight = type === "label" ? fontSize * 1.8 : 110;
    const palette = annotationPalette(item?.colour || (type === "label" ? "#f3d36b" : DEFAULT_ANNOTATION_COLOUR));
    return {
      id: String(item?.id ?? uid("annotation")),
      type,
      text: String(item?.text ?? ""),
      position: { x: Number(item?.position?.x) || 0, y: Number(item?.position?.y) || 0 },
      width: Math.max(type === "label" ? 40 : 100, Math.min(1000, Number(item?.width) || defaultWidth)),
      height: Math.max(type === "label" ? fontSize * 1.8 : 40, Math.min(600, Number(item?.height) || defaultHeight)),
      fontSize,
      colour: palette.colour,
      background: palette.background
    };
  });
  return description;
}

export function pinRef(owner, pinId) { return { owner: String(owner), pin: String(pinId) }; }

export function descriptorForInstance(project, instance) {
  return getDescription(project, instance.name);
}

export function rotatePoint(point, rotation) {
  const r = ((rotation % 4) + 4) % 4;
  if (r === 1) return { x: -point.y, y: point.x };
  if (r === 2) return { x: -point.x, y: -point.y };
  if (r === 3) return { x: point.y, y: -point.x };
  return { x: point.x, y: point.y };
}

export function instancePinPosition(project, instance, pinId) {
  const desc = descriptorForInstance(project, instance);
  const pinDesc = getPin(desc, pinId);
  if (!desc || !pinDesc) return { x: instance.position.x, y: instance.position.y };
  const busFlipped = (isBusOrigin(instance.name) || isBusTerminus(instance.name)) && Boolean(instance.internalData?.busFlipped);
  const pinLocal = busFlipped ? { x: -pinDesc.x, y: pinDesc.y } : { x: pinDesc.x, y: pinDesc.y };
  const local = rotatePoint(pinLocal, instance.rotation);
  return { x: instance.position.x + local.x, y: instance.position.y + local.y };
}

export function rootPinPosition(root, pinDesc) {
  const sideX = pinDesc.direction === "input" ? -root.size.x / 2 : root.size.x / 2;
  return { x: sideX, y: pinDesc.y ?? 0 };
}

export function chipBoundingBox(project, instance) {
  const desc = descriptorForInstance(project, instance);
  if (!desc) return { x: instance.position.x - 10, y: instance.position.y - 10, w: 20, h: 20 };
  const quarter = instance.rotation % 2 !== 0;
  const w = quarter ? desc.size.y : desc.size.x;
  const h = quarter ? desc.size.x : desc.size.y;
  return { x: instance.position.x - w / 2, y: instance.position.y - h / 2, w, h };
}

export function customFromRoot(project, name) {
  const root = clone(project.root);
  const inputPins = [];
  const outputPins = [];
  const removed = new Map();
  const instances = [];
  let inputIndex = 0;
  let outputIndex = 0;

  for (const instance of root.instances) {
    const desc = getDescription(project, instance.name);
    if (isInputType(instance.name)) {
      const sourcePin = desc.outputPins[0];
      const id = `in-${inputIndex++}`;
      inputPins.push({ ...sourcePin, id, name: instance.label || `${instance.name} input`, direction: "input", colour: "gray", x: -GRID * 16, y: (inputIndex - 1) * 18 - 18 });
      removed.set(`${instance.id}:${sourcePin.id}`, pinRef("root", id));
    } else if (isOutputType(instance.name)) {
      const targetPin = desc.inputPins[0];
      const id = `out-${outputIndex++}`;
      outputPins.push({ ...targetPin, id, name: instance.label || `${instance.name} output`, direction: "output", colour: "green", x: GRID * 16, y: (outputIndex - 1) * 18 - 18 });
      removed.set(`${instance.id}:${targetPin.id}`, pinRef("root", id));
    } else {
      instances.push(instance);
    }
  }

  const rewrite = (endpoint) => removed.get(`${endpoint.owner}:${endpoint.pin}`) ?? endpoint;
  root.instances = instances;
  root.wires = root.wires.map((wire) => ({ ...wire, source: rewrite(wire.source), target: rewrite(wire.target) }));
  root.id = uid("chip");
  root.name = name;
  root.type = TYPE.CUSTOM;
  root.kind = "custom";
  root.inputPins = inputPins;
  root.outputPins = outputPins;
  root.colour = COLORS.custom;
  root.size = { x: GRID * 32, y: GRID * 22 };
  return root;
}

export function allLibraryDescriptions(project) {
  return [...Object.values(BUILTINS), ...Object.values(project.customChips ?? {})];
}

export function displayName(description) { return description?.name ?? "Unknown"; }
