import { clone, uid } from "./domain/core.js";
import { BUILTINS, COLLECTIONS, COLORS, CUSTOM_COLLECTION, GRID, TYPE } from "./domain/catalog.js";

export { BUILTINS, COLLECTIONS, CUSTOM_COLLECTION, GRID, TYPE, clone, uid };

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

export function collectionGroupsFor(project) {
  const nativeGroups = project?.collections?.length ? project.collections : COLLECTIONS;
  const nativeNames = new Set(nativeGroups.map((group) => String(group.name || "").trim()));
  const groups = [
    ...nativeGroups.filter((group) => String(group.name || "").trim() !== CUSTOM_COLLECTION),
    ...COLLECTIONS.filter((group) => !nativeNames.has(String(group.name))),
    { name: CUSTOM_COLLECTION, chips: Object.keys(project?.customChips ?? {}) }
  ];
  const byName = new Map();
  for (const group of groups) {
    const name = String(group.name || "").trim();
    if (name && !byName.has(name)) byName.set(name, { name, chips: [...(group.chips ?? [])] });
  }
  const fallback = [...byName.keys()];
  const requested = Array.isArray(project?.collectionOrder) ? project.collectionOrder : fallback;
  const order = [];
  for (const name of [...requested, ...fallback]) {
    if (byName.has(name) && !order.includes(name)) order.push(name);
  }
  return order.map((name) => byName.get(name));
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
