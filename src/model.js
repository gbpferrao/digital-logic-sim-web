import { clone, uid } from "./domain/core.js";
import { BUILTINS, COLLECTIONS, COLORS, CUSTOM_COLLECTION, GRID, MIN_CHIP_SIZE, TYPE } from "./domain/catalog.js";

export { BUILTINS, COLLECTIONS, CUSTOM_COLLECTION, GRID, MIN_CHIP_SIZE, TYPE, clone, uid };

const DEFAULT_ANNOTATION_COLOUR = "#d7eaff";
export const REUSABLE_FIT_VERSION = 1;
export const REUSABLE_FIT_PADDING = GRID * 2;

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
  // Older chip records did not persist a reusable canvas fit. Derive it after
  // all custom descriptions exist so nested custom chips can use their own
  // saved geometry when it is available.
  const missingFits = new Set(Object.entries(project.customChips).filter(([, description]) => !description.fit).map(([name]) => name));
  for (const name of missingFits) project.customChips[name].fit = deriveReusableFit(project, project.customChips[name], { ignoreReusableChildFits: missingFits });
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
  if (!description.kind && description.type === TYPE.CUSTOM) description.kind = TYPE.CUSTOM;
  const rawSize = raw?.size ?? {};
  const rawWidth = Number(rawSize.x);
  const rawHeight = Number(rawSize.y);
  description.size = {
    x: Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : MIN_CHIP_SIZE.x,
    y: Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : MIN_CHIP_SIZE.y
  };
  description.fit = normalizeReusableFit(raw?.fit);
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
  const pinLocal = busFlipped
    ? { x: -pinDesc.x, y: pinDesc.y }
    : { x: pinDesc.x, y: pinDesc.y };
  const reusableLocal = desc.kind === TYPE.CUSTOM ? reusablePoint(desc, pinLocal) : pinLocal;
  const local = rotatePoint(reusableLocal, instance.rotation);
  return { x: instance.position.x + local.x, y: instance.position.y + local.y };
}

export function rootPinPosition(root, pinDesc) {
  const sideX = pinDesc.direction === "input" ? -root.size.x / 2 : root.size.x / 2;
  return { x: sideX, y: pinDesc.y ?? 0 };
}

export function chipBoundingBox(project, instance) {
  const desc = descriptorForInstance(project, instance);
  if (!desc) return { x: instance.position.x - 10, y: instance.position.y - 10, w: 20, h: 20 };
  const boundsSize = chipBoundsSize(desc);
  const quarter = instance.rotation % 2 !== 0;
  const w = quarter ? boundsSize.y : boundsSize.x;
  const h = quarter ? boundsSize.x : boundsSize.y;
  return { x: instance.position.x - w / 2, y: instance.position.y - h / 2, w, h };
}

export function chipBoundsSize(description) {
  const fit = description?.kind === TYPE.CUSTOM ? description.fit?.bounds : null;
  const width = Number(fit?.w ?? description?.size?.x);
  const height = Number(fit?.h ?? description?.size?.y);
  return {
    x: Math.max(MIN_CHIP_SIZE.x, Number.isFinite(width) && width > 0 ? width : MIN_CHIP_SIZE.x),
    y: Math.max(MIN_CHIP_SIZE.y, Number.isFinite(height) && height > 0 ? height : MIN_CHIP_SIZE.y)
  };
}

export function chipVisualSize(description) {
  const fit = description?.kind === TYPE.CUSTOM ? description.fit?.bounds : null;
  const width = Number(fit?.w ?? description?.size?.x);
  const height = Number(fit?.h ?? description?.size?.y);
  return {
    x: Math.max(1, Number.isFinite(width) && width > 0 ? width : MIN_CHIP_SIZE.x),
    y: Math.max(1, Number.isFinite(height) && height > 0 ? height : MIN_CHIP_SIZE.y)
  };
}

export function reusableFitBounds(description) {
  const fit = description?.fit?.bounds;
  const x = Number(fit?.x);
  const y = Number(fit?.y);
  const w = Number(fit?.w);
  const h = Number(fit?.h);
  if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) return { x, y, w, h };
  const size = chipBoundsSize({ ...description, fit: null });
  return { x: -size.x / 2, y: -size.y / 2, w: size.x, h: size.y };
}

export function reusablePoint(description, point) {
  const fit = description?.kind === TYPE.CUSTOM ? reusableFitBounds(description) : null;
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  if (!fit) return { x, y };
  return { x: x - (fit.x + fit.w / 2), y: y - (fit.y + fit.h / 2) };
}

function descriptionPinPosition(description, pin) {
  const width = Number(description?.size?.x) || MIN_CHIP_SIZE.x;
  const x = Number(pin?.x);
  return {
    x: Number.isFinite(x) ? x : (pin?.direction === "input" ? -width / 2 : width / 2),
    y: Number(pin?.y) || 0
  };
}

function descriptionEndpointPosition(project, description, endpoint, options = {}) {
  const owner = String(endpoint?.owner);
  if (owner === "root") {
    const pin = [...(description.inputPins ?? []), ...(description.outputPins ?? [])].find((item) => String(item.id) === String(endpoint.pin));
    return pin ? descriptionPinPosition(description, pin) : { x: 0, y: 0 };
  }
  if (owner === "junction") {
    return description.junctions?.find((item) => String(item.id) === String(endpoint.pin))?.position ?? { x: 0, y: 0 };
  }
  if (owner === "wire") return endpoint.position ? { ...endpoint.position } : { x: 0, y: 0 };
  const instance = (description.instances ?? []).find((item) => String(item.id) === owner);
  if (!instance) return { x: 0, y: 0 };
  if (options.ignoreReusableChildFits?.has(String(instance.name))) {
    const child = getDescription(project, instance.name);
    const pin = getPin(child, endpoint.pin);
    if (pin) {
      const local = rotatePoint({ x: Number(pin.x) || 0, y: Number(pin.y) || 0 }, instance.rotation);
      return { x: (Number(instance.position?.x) || 0) + local.x, y: (Number(instance.position?.y) || 0) + local.y };
    }
  }
  return instancePinPosition({ ...project, root: description }, instance, endpoint.pin);
}

export function deriveReusableFit(project, description, options = {}) {
  const points = [];
  const addPoint = (point) => {
    if (Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))) points.push({ x: Number(point.x), y: Number(point.y) });
  };
  const addBox = (box) => {
    addPoint({ x: box.x, y: box.y });
    addPoint({ x: box.x + box.w, y: box.y + box.h });
  };

  for (const instance of description.instances ?? []) {
    const child = getDescription(project, instance.name);
    if (!child) continue;
    const bounds = options.ignoreReusableChildFits?.has(String(instance.name))
      ? chipBoundsSize({ ...child, fit: null })
      : chipBoundsSize(child);
    const quarterTurn = Math.abs(Number(instance.rotation) || 0) % 2 === 1;
    const width = quarterTurn ? bounds.y : bounds.x;
    const height = quarterTurn ? bounds.x : bounds.y;
    const x = Number(instance.position?.x) || 0;
    const y = Number(instance.position?.y) || 0;
    addBox({ x: x - width / 2, y: y - height / 2, w: width, h: height });
  }
  for (const pin of [...(description.inputPins ?? []), ...(description.outputPins ?? [])]) addPoint(descriptionPinPosition(description, pin));
  for (const junction of description.junctions ?? []) addPoint(junction.position);
  for (const wire of description.wires ?? []) {
    addPoint(descriptionEndpointPosition(project, description, wire.source, options));
    addPoint(descriptionEndpointPosition(project, description, wire.target, options));
    for (const point of wire.points ?? []) addPoint(point);
  }

  if (!points.length) {
    const size = chipVisualSize({ ...description, fit: null });
    return { version: REUSABLE_FIT_VERSION, bounds: { x: -size.x / 2, y: -size.y / 2, w: size.x, h: size.y } };
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = REUSABLE_FIT_PADDING;
  return {
    version: REUSABLE_FIT_VERSION,
    bounds: {
      x: minX - padding,
      y: minY - padding,
      w: Math.max(MIN_CHIP_SIZE.x, maxX - minX + padding * 2),
      h: Math.max(MIN_CHIP_SIZE.y, maxY - minY + padding * 2)
    }
  };
}

export function refreshReusableFit(project, description) {
  if (!description || description.kind !== TYPE.CUSTOM) return description;
  description.fit = deriveReusableFit(project, description);
  return description;
}

function normalizeReusableFit(raw) {
  if (!raw) return null;
  const bounds = raw.bounds ?? raw;
  const x = Number(bounds?.x);
  const y = Number(bounds?.y);
  const w = Number(bounds?.w ?? bounds?.width);
  const h = Number(bounds?.h ?? bounds?.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { version: Number(raw.version) || REUSABLE_FIT_VERSION, bounds: { x, y, w, h } };
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
  root.fit = null;
  const description = normalizeDescription(root);
  refreshReusableFit(project, description);
  return description;
}

export function allLibraryDescriptions(project) {
  return [...Object.values(BUILTINS), ...Object.values(project.customChips ?? {})];
}

export function displayName(description) { return description?.name ?? "Unknown"; }
