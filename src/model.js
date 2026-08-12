import { clone, uid } from "./domain/core.js";
import { BUILTINS, COLLECTIONS, COLORS, CUSTOM_COLLECTION, GRID, MIN_CHIP_SIZE, TYPE } from "./domain/catalog.js";

export { BUILTINS, COLLECTIONS, CUSTOM_COLLECTION, GRID, MIN_CHIP_SIZE, TYPE, clone, uid };

export const FREE_ENDPOINT_OWNER = "free";

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
export function isInterfaceNode(instance) { return Boolean(instance && (isInputType(instance.name) || isOutputType(instance.name))); }
export function interfaceDirectionForInstance(instance) {
  if (isInputType(instance?.name)) return "input";
  if (isOutputType(instance?.name)) return "output";
  return null;
}
export function interfaceBindingsFor(description, direction = null) {
  const bindings = description?.interfaceBindings ?? {};
  const lists = direction ? [direction === "input" ? bindings.inputs : bindings.outputs] : [bindings.inputs, bindings.outputs];
  return lists.flatMap((list) => Array.isArray(list) ? list : []).map((item) => ({
    publicId: String(item.publicId ?? item.id ?? ""),
    instanceId: String(item.instanceId ?? ""),
    pinId: String(item.pinId ?? ""),
    direction: item.direction === "output" ? "output" : "input"
  })).filter((item) => item.publicId && item.instanceId && item.pinId);
}
export function interfaceBindingFor(description, publicId, direction = null) {
  return interfaceBindingsFor(description, direction).find((item) => item.publicId === String(publicId)) ?? null;
}

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
    interfaceId: null,
    outputPinColours: {}
  };
}

function defaultInternalData(desc) {
  if (!desc) return {};
  if (desc.special === "bus" || desc.special === "busTerminus") return { busFlipped: false };
  if (desc.special === "dff") return { value: 0, lastClock: 0 };
  if (desc.special === "register" || desc.special === "pc") return { value: 0, lastClock: 0 };
  if (desc.special === "ram" || desc.special === "screen" || desc.special === "memoryMap") {
    return { memory: Array.from({ length: Number(desc.memorySize) || 256 }, () => 0), lastClock: 0 };
  }
  if (desc.special === "rom") return { memory: Array.from({ length: Number(desc.memorySize) || 256 }, () => 0) };
  if (desc.special === "hackCpu") return { a: 0, d: 0, pc: 0, lastClock: 0 };
  if (desc.special === "pulse") return { duration: 4, remaining: 0, previous: 0 };
  if (desc.special === "key") return { key: "Space" };
  if (desc.special === "keyboard") return { keyCode: 0 };
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
      simulationPaused: true,
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
  project.root = normalizeDescription({ ...base.root, ...(raw?.root ?? {}) }, { isRoot: true });
  project.customChips = {};
  for (const [name, value] of Object.entries(raw?.customChips ?? {})) project.customChips[name] = normalizeDescription(value, { isRoot: false });
  // Older chip records did not persist a reusable canvas fit. Derive it after
  // all custom descriptions exist so nested custom chips can use their own
  // saved geometry when it is available.
  const missingFits = new Set(Object.entries(project.customChips).filter(([, description]) => !description.fit).map(([name]) => name));
  for (const name of missingFits) {
    project.customChips[name].fit = deriveReusableFit(project, project.customChips[name], { ignoreReusableChildFits: missingFits });
    refreshInterfacePorts(project, project.customChips[name]);
  }
  // A loaded project is always opened paused. Running is an explicit UI
  // action, never a persisted side effect of the previous session.
  project.settings = { ...base.settings, ...(raw?.settings ?? {}), simulationPaused: true };
  project.collections = raw?.collections?.length ? raw.collections : clone(COLLECTIONS);
  project.collectionOrder = collectionOrderFor(raw?.collectionOrder, project.collections);
  project.starred = raw?.starred ?? ["IN/OUT", TYPE.NAND];
  project.inputValues = { ...(raw?.inputValues ?? {}) };
  project.keyValues = { ...(raw?.keyValues ?? {}) };
  return project;
}

function normalizeDescription(raw, options = {}) {
  const description = { ...raw };
  if (!description.kind && description.type === TYPE.CUSTOM) description.kind = TYPE.CUSTOM;
  const rawSize = raw?.size ?? {};
  const rawWidth = Number(rawSize.x);
  const rawHeight = Number(rawSize.y);
  description.size = {
    x: Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : MIN_CHIP_SIZE.x,
    y: Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : MIN_CHIP_SIZE.y
  };
  description.interfaceBindings = normalizeInterfaceBindings(raw?.interfaceBindings);
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
    label: item.label ?? "", internalData: item.internalData ?? {}, linkedBusPairId: item.linkedBusPairId ?? null, interfaceId: item.interfaceId == null ? null : String(item.interfaceId), outputPinColours: item.outputPinColours ?? {}
  }));
  const normalizeWireEndpoint = (item) => {
    const endpoint = { ...(item ?? {}) };
    const owner = String(endpoint.owner ?? "");
    const result = { ...endpoint, owner, pin: String(endpoint.pin ?? (owner === FREE_ENDPOINT_OWNER ? uid("free") : "")) };
    if (owner === FREE_ENDPOINT_OWNER) {
      const x = Number(endpoint.position?.x);
      const y = Number(endpoint.position?.y);
      result.position = {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0
      };
      result.direction = ["input", "output", "passive"].includes(String(endpoint.direction)) ? String(endpoint.direction) : "passive";
      const bits = Number(endpoint.bits);
      if (Number.isFinite(bits) && bits > 0) result.bits = bits;
    } else if (endpoint.junction) {
      Object.assign(result, {
        junction: true,
        direction: endpoint.direction,
        bits: endpoint.bits
      });
    }
    return result;
  };
  description.wires = (raw?.wires ?? []).map((wire) => ({
    id: String(wire.id ?? uid("wire")),
    source: normalizeWireEndpoint(wire.source),
    target: normalizeWireEndpoint(wire.target),
    points: (wire.points ?? []).map((point) => ({ x: point.x, y: point.y })),
    colour: wire.colour ?? null
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
  if (!options.isRoot && description.kind === TYPE.CUSTOM) normalizeCompositeInterface(description);
  return description;
}

function normalizeInterfaceBindings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalize = (list, direction) => (Array.isArray(list) ? list : []).map((item) => ({
    publicId: String(item?.publicId ?? item?.id ?? ""),
    instanceId: String(item?.instanceId ?? ""),
    pinId: String(item?.pinId ?? ""),
    direction
  })).filter((item) => item.publicId && item.instanceId && item.pinId);
  return { inputs: normalize(source.inputs, "input"), outputs: normalize(source.outputs, "output") };
}

function terminalTypeFor(direction, bits = 1) {
  const prefix = direction === "input" ? "IN-" : "OUT-";
  const available = [1, 4, 8, 16];
  const requested = Number(bits) || 1;
  const width = available.includes(requested) ? requested : available.reduce((best, value) => Math.abs(value - requested) < Math.abs(best - requested) ? value : best, available[0]);
  return `${prefix}${width}`;
}

function interfacePinDescriptor(instance, direction) {
  const description = BUILTINS[instance?.name];
  if (!description) return null;
  return direction === "input" ? description.outputPins?.[0] ?? null : description.inputPins?.[0] ?? null;
}

function interfaceEndpoint(description, instance, direction) {
  const pin = interfacePinDescriptor(instance, direction);
  if (!pin) return { x: Number(instance?.position?.x) || 0, y: Number(instance?.position?.y) || 0 };
  const local = rotatePoint({ x: Number(pin.x) || 0, y: Number(pin.y) || 0 }, Number(instance.rotation) || 0);
  return { x: (Number(instance.position?.x) || 0) + local.x, y: (Number(instance.position?.y) || 0) + local.y };
}

function nextInterfaceId(direction, used, index = 0) {
  const prefix = direction === "input" ? "in" : "out";
  let candidate = `${prefix}-${index}`;
  let next = index;
  while (used.has(candidate)) candidate = `${prefix}-${++next}`;
  used.add(candidate);
  return candidate;
}

function legacyInterfaceInstance(description, pin, direction, publicId, index) {
  const name = terminalTypeFor(direction, pin.bits);
  const instance = instanceFor(name, { x: 0, y: Number(pin.y) || 0 });
  const terminalPin = interfacePinDescriptor(instance, direction);
  const boundaryX = direction === "input" ? -description.size.x / 2 : description.size.x / 2;
  instance.id = `interface-${direction}-${publicId}`;
  instance.interfaceId = String(publicId);
  instance.label = String(pin.name || "").trim();
  instance.position.x = boundaryX - (Number(terminalPin?.x) || 0);
  instance.position.y = Number(pin.y) || (index * 18 - 18);
  return instance;
}

function normalizeCompositeInterface(description) {
  const publicPins = {
    input: [...(description.inputPins ?? [])],
    output: [...(description.outputPins ?? [])]
  };
  const requested = normalizeInterfaceBindings(description.interfaceBindings);
  const bindings = { inputs: [], outputs: [] };
  const endpointMap = new Map();

  for (const direction of ["input", "output"]) {
    const key = direction === "input" ? "inputs" : "outputs";
    let terminalInstances = description.instances.filter((instance) => interfaceDirectionForInstance(instance) === direction);
    const oldPins = publicPins[direction];
    const usedPublicIds = new Set(requested[key].map((item) => item.publicId));
    if (!terminalInstances.length && oldPins.length) {
      terminalInstances = oldPins.map((pin, index) => {
        const publicId = String(pin.id || nextInterfaceId(direction, usedPublicIds, index));
        const instance = legacyInterfaceInstance(description, pin, direction, publicId, index);
        description.instances.push(instance);
        return instance;
      });
    }

    const validRequested = requested[key].filter((binding) => {
      const instance = description.instances.find((item) => String(item.id) === binding.instanceId);
      return instance && interfaceDirectionForInstance(instance) === direction && interfacePinDescriptor(instance, direction);
    });
    const boundInstances = new Set(validRequested.map((binding) => binding.instanceId));
    const bindingList = [...validRequested];
    const publicById = new Map(oldPins.map((pin) => [String(pin.id), pin]));
    let oldPinIndex = 0;
    for (const instance of terminalInstances) {
      const instanceId = String(instance.id);
      if (boundInstances.has(instanceId)) continue;
      const matchingByIdentity = instance.interfaceId && publicById.has(String(instance.interfaceId)) ? publicById.get(String(instance.interfaceId)) : null;
      const matchingByOrder = oldPins.find((pin) => !usedPublicIds.has(String(pin.id)) && String(pin.id) === String(matchingByIdentity?.id ?? ""))
        ?? oldPins.find((pin) => !usedPublicIds.has(String(pin.id)) && String(pin.id) === String(oldPins[oldPinIndex]?.id ?? ""));
      const publicId = String(instance.interfaceId || matchingByIdentity?.id || matchingByOrder?.id || nextInterfaceId(direction, usedPublicIds, oldPinIndex));
      usedPublicIds.add(publicId);
      instance.interfaceId = publicId;
      if (!instance.label && matchingByIdentity?.name) instance.label = matchingByIdentity.name;
      bindingList.push({ publicId, instanceId, pinId: String(interfacePinDescriptor(instance, direction).id), direction });
      oldPinIndex += 1;
    }

    for (const binding of bindingList) endpointMap.set(`${direction}:${binding.publicId}`, { owner: binding.instanceId, pin: binding.pinId });
    bindings[key] = bindingList;
  }

  const rewrite = (endpoint) => {
    if (String(endpoint?.owner) !== "root") return endpoint;
    const input = endpointMap.get(`input:${String(endpoint.pin)}`);
    const output = endpointMap.get(`output:${String(endpoint.pin)}`);
    return input ?? output ?? endpoint;
  };
  description.wires = (description.wires ?? []).map((wire) => ({ ...wire, source: rewrite(wire.source), target: rewrite(wire.target) }));
  description.interfaceBindings = bindings;
  refreshInterfacePorts(null, description);
  return description;
}

export function refreshInterfacePorts(project, description) {
  if (!description || description.kind !== TYPE.CUSTOM) return description;
  const bindings = normalizeInterfaceBindings(description.interfaceBindings);
  const nextBindings = { inputs: [], outputs: [] };
  const nextPins = { inputs: [], outputs: [] };
  const oldPins = {
    input: new Map((description.inputPins ?? []).map((pin) => [String(pin.id), pin])),
    output: new Map((description.outputPins ?? []).map((pin) => [String(pin.id), pin]))
  };
  for (const direction of ["input", "output"]) {
    const key = direction === "input" ? "inputs" : "outputs";
    const bindingList = bindings[key].filter((binding) => description.instances?.some((item) => String(item.id) === binding.instanceId));
    const boundInstances = new Set(bindingList.map((binding) => binding.instanceId));
    const usedPublicIds = new Set(bindingList.map((binding) => binding.publicId));
    for (const instance of description.instances ?? []) {
      if (interfaceDirectionForInstance(instance) !== direction || boundInstances.has(String(instance.id))) continue;
      const publicId = String(instance.interfaceId || nextInterfaceId(direction, usedPublicIds, bindingList.length));
      instance.interfaceId = publicId;
      const terminalPin = interfacePinDescriptor(instance, direction);
      if (!terminalPin) continue;
      bindingList.push({ publicId, instanceId: String(instance.id), pinId: String(terminalPin.id), direction });
      boundInstances.add(String(instance.id));
    }
    for (const binding of bindingList) {
      const instance = description.instances?.find((item) => String(item.id) === binding.instanceId);
      const terminalPin = interfacePinDescriptor(instance, direction);
      if (!instance || !terminalPin) continue;
      const existing = oldPins[direction].get(binding.publicId) ?? {};
      const endpoint = interfaceEndpoint(description, instance, direction);
      const fit = description.fit?.bounds;
      const edgeX = Number.isFinite(Number(fit?.x)) && Number.isFinite(Number(fit?.w))
        ? (direction === "input" ? Number(fit.x) : Number(fit.x) + Number(fit.w))
        : (direction === "input" ? -description.size.x / 2 : description.size.x / 2);
      instance.interfaceId = binding.publicId;
      nextPins[key].push({
        ...terminalPin,
        ...existing,
        id: binding.publicId,
        name: String(instance.label || existing.name || instance.name),
        bits: Number(existing.bits) || Number(terminalPin.bits) || 1,
        direction,
        x: edgeX,
        y: endpoint.y,
        valueDisplay: existing.valueDisplay || terminalPin.valueDisplay || "off",
        colour: direction === "output" ? "green" : "gray"
      });
    }
    nextBindings[key] = bindingList;
    nextPins[key] = nextPins[key].filter((pin) => pin && pin.id);
  }
  description.interfaceBindings = nextBindings;
  description.inputPins = nextPins.inputs;
  description.outputPins = nextPins.outputs;
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
  const interfacePort = desc.kind === TYPE.CUSTOM ? interfaceBindingFor(desc, pinId) : null;
  const reusableLocal = desc.kind === TYPE.CUSTOM
    ? interfacePort ? reusableInterfacePoint(desc, pinLocal) : reusablePoint(desc, pinLocal)
    : pinLocal;
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

// X-ray maps a reusable description into the inset frame inside its visible
// body. Interface ports are still exposed at the body's outer edge, so their
// vertical coordinate needs the same projection as the hidden IN/OUT node.
export function reusableProjectionGeometry(description) {
  const visualSize = chipVisualSize(description);
  const fit = reusableFitBounds(description);
  const inset = Math.max(8, Math.min(14, Math.min(visualSize.x, visualSize.y) * .12));
  const frame = {
    x: -visualSize.x / 2 + inset,
    y: -visualSize.y / 2 + inset,
    w: Math.max(16, visualSize.x - inset * 2),
    h: Math.max(16, visualSize.y - inset * 2)
  };
  const scale = Math.min(frame.w / Math.max(1, fit.w), frame.h / Math.max(1, fit.h));
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return {
    visualSize,
    fit,
    frame,
    scale,
    translate: {
      x: frame.x + (frame.w - fit.w * scale) / 2 - fit.x * scale,
      y: frame.y + (frame.h - fit.h * scale) / 2 - fit.y * scale
    }
  };
}

export function reusableInterfacePoint(description, point) {
  const normalized = reusablePoint(description, point);
  if (description?.kind !== TYPE.CUSTOM) return normalized;
  const projection = reusableProjectionGeometry(description);
  if (!projection) return normalized;
  const y = Number(point?.y) || 0;
  return { x: normalized.x, y: projection.translate.y + y * projection.scale };
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
  if (owner === FREE_ENDPOINT_OWNER) {
    const x = Number(endpoint?.position?.x);
    const y = Number(endpoint?.position?.y);
    return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
  }
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
  if (!interfaceBindingsFor(description).length) {
    for (const pin of [...(description.inputPins ?? []), ...(description.outputPins ?? [])]) addPoint(descriptionPinPosition(description, pin));
  }
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
  refreshInterfacePorts(project, description);
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
  root.id = uid("chip");
  root.name = name;
  root.type = TYPE.CUSTOM;
  root.kind = "custom";
  root.colour = COLORS.custom;
  root.size = { x: GRID * 32, y: GRID * 22 };
  root.fit = null;
  const description = normalizeDescription(root, { isRoot: false });
  refreshInterfacePorts(project, description);
  refreshReusableFit(project, description);
  return description;
}

export function allLibraryDescriptions(project) {
  return [...Object.values(BUILTINS), ...Object.values(project.customChips ?? {})];
}

export function displayName(description) { return description?.name ?? "Unknown"; }
