import {
  BUILTINS,
  TYPE,
  clone,
  descriptorForInstance,
  getDescription,
  getInputPin,
  getOutputPin,
  isInputType,
  isOutputType,
  isBusOrigin,
  isBusTerminus
} from "./model.js";

export const PIN_MASK = 0xffff;

export function maskForBits(bits = 1) {
  return (1 << Math.min(bits, 16)) - 1;
}

export function state(bits = 0, tri = PIN_MASK) {
  return { bits: bits & PIN_MASK, tri: tri & PIN_MASK };
}

export function driven(bits = 0) { return state(bits, 0); }
export function disconnected() { return state(0, PIN_MASK); }
export function copyState(value) { return { bits: value?.bits ?? 0, tri: value?.tri ?? PIN_MASK }; }
export function stateEqual(a, b) { return Boolean(a && b && a.bits === b.bits && a.tri === b.tri); }
export function isHigh(value, bit = 0) { return Boolean(value && ((value.bits >> bit) & 1)); }
export function valueOf(value, bits = 16) { return (value?.bits ?? 0) & maskForBits(bits); }
export const SIMULATION_SNAPSHOT_VERSION = 1;

export function emptySnapshot(step = 0, outputs = new Map()) {
  return {
    version: SIMULATION_SNAPSHOT_VERSION,
    step: Math.max(0, Number(step) || 0),
    endpoints: {},
    instances: {},
    outputs
  };
}

export function cloneSnapshot(snapshot) {
  const source = snapshot ?? emptySnapshot();
  const outputs = source.outputs instanceof Map
    ? new Map([...source.outputs].map(([key, value]) => [key, copyState(value)]))
    : Object.fromEntries(Object.entries(source.outputs ?? {}).map(([key, value]) => [key, copyState(value)]));
  const instances = Object.fromEntries(Object.entries(source.instances ?? {}).map(([id, item]) => [
    id,
    {
      ...item,
      signals: Object.fromEntries(Object.entries(item?.signals ?? {}).map(([key, value]) => [key, copyState(value)])),
      internal: clone(item?.internal ?? {})
    }
  ]));
  return {
    version: Number(source.version) || SIMULATION_SNAPSHOT_VERSION,
    step: Math.max(0, Number(source.step) || 0),
    endpoints: Object.fromEntries(Object.entries(source.endpoints ?? {}).map(([key, value]) => [key, copyState(value)])),
    instances,
    outputs
  };
}

// A pin can have more than one input. Connected drivers are merged. If two
// driven values conflict, use an AND merge. This is deterministic in the web
// port and keeps a circuit stable while it is being edited.
export function mergeState(current, incoming, bits = 16) {
  const mask = maskForBits(bits);
  const currentDrive = (~current.tri) & mask;
  const incomingDrive = (~incoming.tri) & mask;
  if (!currentDrive) return { bits: incoming.bits & mask, tri: (~incomingDrive) & mask };
  if (!incomingDrive) return { bits: current.bits & mask, tri: (~currentDrive) & mask };

  const both = currentDrive & incomingDrive;
  const conflict = (current.bits ^ incoming.bits) & both;
  const equalBits = current.bits & ~conflict;
  const mergedConflict = (current.bits & incoming.bits) & conflict;
  const drivenBits = currentDrive | incomingDrive;
  return { bits: (equalBits | mergedConflict) & mask, tri: (~drivenBits) & mask };
}

function pinStateMap(description) {
  const map = new Map();
  for (const item of [...(description.inputPins ?? []), ...(description.outputPins ?? [])]) map.set(String(item.id), disconnected());
  return map;
}

function runtimeFor(description, project) {
  const runtime = {
    description,
    instances: new Map(),
    junctions: new Map((description.junctions ?? []).map((junction) => [String(junction.id), disconnected()])),
    rootInputs: pinStateMap({ inputPins: description.inputPins ?? [], outputPins: [] }),
    rootOutputs: pinStateMap({ inputPins: [], outputPins: description.outputPins ?? [] }),
    lastTick: -1
  };
  for (const instance of description.instances ?? []) {
    const desc = getDescription(project, instance.name);
    if (!desc) continue;
    runtime.instances.set(String(instance.id), {
      instance,
      description: desc,
      inputs: pinStateMap({ inputPins: desc.inputPins, outputPins: [] }),
      outputs: pinStateMap({ inputPins: [], outputPins: desc.outputPins }),
      child: desc.kind === "custom" ? runtimeFor(desc, project) : null,
      internal: clone(instance.internalData ?? {}),
      lastTick: -1
    });
  }
  return runtime;
}

function endpointState(runtime, endpoint) {
  const owner = String(endpoint.owner);
  const pinId = String(endpoint.pin);
  if (owner === "junction") return runtime.junctions.get(pinId) ?? disconnected();
  if (owner === "root") return runtime.rootInputs.get(pinId) ?? runtime.rootOutputs.get(pinId) ?? disconnected();
  const item = runtime.instances.get(owner);
  if (!item) return disconnected();
  return item.outputs.get(pinId) ?? item.inputs.get(pinId) ?? disconnected();
}

function writeEndpoint(runtime, endpoint, value) {
  const owner = String(endpoint.owner);
  const pinId = String(endpoint.pin);
  if (owner === "junction") {
    const current = runtime.junctions.get(pinId) ?? disconnected();
    runtime.junctions.set(pinId, mergeState(current, value, endpoint.bits ?? 1));
    return;
  }
  if (owner === "root") {
    if (runtime.rootOutputs.has(pinId)) {
      const current = runtime.rootOutputs.get(pinId) ?? disconnected();
      const pin = runtime.description.outputPins.find((item) => String(item.id) === pinId);
      runtime.rootOutputs.set(pinId, mergeState(current, value, pin?.bits ?? 1));
    }
    return;
  }
  const item = runtime.instances.get(owner);
  if (!item) return;
  const pin = item.description.inputPins.find((candidate) => String(candidate.id) === pinId);
  if (!pin) return;
  const current = item.inputs.get(pinId) ?? disconnected();
  item.inputs.set(pinId, mergeState(current, value, pin.bits));
}

function propagateWire(runtime, wire) {
  writeEndpoint(runtime, wire.target, endpointState(runtime, wire.source));
}

function propagateAll(runtime) {
  for (const wire of runtime.description.wires ?? []) propagateWire(runtime, wire);
}

function setOutput(item, id, value) {
  if (item.outputs.has(String(id))) item.outputs.set(String(id), copyState(value));
}

function getInput(item, id) { return item.inputs.get(String(id)) ?? disconnected(); }
function getBits(item, id, bits) { return valueOf(getInput(item, id), bits); }

function risingEdge(previous, current) { return isHigh(current) && !previous; }

function processBuiltin(item, simulator, tickId, commitState = false) {
  const desc = item.description;
  const type = desc.type;
  const firstTickPass = item.lastTick !== tickId;
  if (commitState && firstTickPass) item.lastTick = tickId;

  if (isInputType(type)) {
    const raw = simulator.project.inputValues[item.instance.id] ?? 0;
    const bits = desc.outputPins[0]?.bits ?? 1;
    setOutput(item, desc.outputPins[0]?.id ?? 0, driven(Number(raw) & maskForBits(bits)));
    return;
  }
  if (isOutputType(type)) return;
  if ([TYPE.AND, TYPE.OR, TYPE.NAND, TYPE.NOR, TYPE.XOR, TYPE.XNOR].includes(type)) {
    const a = isHigh(getInput(item, 0));
    const b = isHigh(getInput(item, 1));
    const result = type === TYPE.AND ? a && b
      : type === TYPE.OR ? a || b
        : type === TYPE.NAND ? !(a && b)
          : type === TYPE.NOR ? !(a || b)
            : type === TYPE.XOR ? a !== b
              : a === b;
    setOutput(item, 2, driven(result ? 1 : 0));
    return;
  }
  if (type === TYPE.NOT) {
    setOutput(item, 1, driven(isHigh(getInput(item, 0)) ? 0 : 1));
    return;
  }
  if (type === TYPE.BUFFER) {
    setOutput(item, 1, getInput(item, 0));
    return;
  }
  if (type === TYPE.TRI_STATE) {
    setOutput(item, 2, isHigh(getInput(item, 1)) ? getInput(item, 0) : disconnected());
    return;
  }
  if (type === TYPE.CLOCK) {
    const period = Math.max(1, Number(simulator.project.settings.stepsPerClock) || 8);
    setOutput(item, 0, driven(Math.floor(simulator.stepCount / period) % 2));
    return;
  }
  if (type === TYPE.PULSE) {
    const current = isHigh(getInput(item, 0));
    if (commitState && firstTickPass) {
      if (current && !item.internal.previous && item.internal.remaining === 0) item.internal.remaining = Math.max(1, Number(item.internal.duration) || 4);
      item.internal.previous = current ? 1 : 0;
    }
    if (item.internal.remaining > 0) {
      setOutput(item, 1, driven(1));
      if (commitState && firstTickPass) item.internal.remaining -= 1;
    } else {
      setOutput(item, 1, getInput(item, 0).tri ? disconnected() : driven(0));
    }
    return;
  }
  if (type === TYPE.KEY) {
    const key = item.internal.key || "Space";
    const held = simulator.project.keyValues[key] || simulator.project.keyValues[`Key${String(key).toUpperCase()}`] || simulator.project.keyValues[String(key).toLowerCase()];
    setOutput(item, 0, driven(held ? 1 : 0));
    return;
  }
  if (type === TYPE.MERGE_1_4 || type === TYPE.MERGE_1_8 || type === TYPE.MERGE_4_8) {
    const out = desc.outputPins[0];
    let bits = 0;
    let tri = 0;
    desc.inputPins.forEach((pin, index) => {
      const input = getInput(item, pin.id);
      const offset = type === TYPE.MERGE_4_8 ? index * 4 : index;
      bits |= (input.bits & maskForBits(pin.bits)) << offset;
      tri |= (input.tri & maskForBits(pin.bits)) << offset;
    });
    setOutput(item, out.id, state(bits, tri));
    return;
  }
  if (type === TYPE.SPLIT_4_1 || type === TYPE.SPLIT_8_4 || type === TYPE.SPLIT_8_1) {
    const source = getInput(item, desc.inputPins[0]?.id ?? 0);
    if (type === TYPE.SPLIT_8_4) {
      setOutput(item, desc.outputPins[0].id, state((source.bits >> 4) & 0xf, (source.tri >> 4) & 0xf));
      setOutput(item, desc.outputPins[1].id, state(source.bits & 0xf, source.tri & 0xf));
    } else {
      desc.outputPins.forEach((pin, index) => {
        const bit = desc.outputPins.length - index - 1;
        setOutput(item, pin.id, state((source.bits >> bit) & 1, (source.tri >> bit) & 1));
      });
    }
    return;
  }
  if (isBusOrigin(type)) {
    setOutput(item, desc.outputPins[0]?.id ?? 1, getInput(item, desc.inputPins[0]?.id ?? 0));
    return;
  }
  if (isBusTerminus(type)) return;
  if (type === TYPE.RAM) {
    const address = getBits(item, 0, 8);
    const clock = getInput(item, 4);
    const previousClock = item.internal.lastClock ?? 0;
    if (commitState && firstTickPass && risingEdge(previousClock, clock)) {
      if (isHigh(getInput(item, 3))) item.internal.memory = Array.from({ length: 256 }, () => 0);
      else if (isHigh(getInput(item, 2))) item.internal.memory[address] = getBits(item, 1, 8);
    }
    if (commitState && firstTickPass) item.internal.lastClock = isHigh(clock) ? 1 : 0;
    setOutput(item, 5, driven(item.internal.memory?.[address] ?? 0));
    return;
  }
  if (type === TYPE.ROM) {
    const word = Number(item.internal.memory?.[getBits(item, 0, 8)] ?? 0) & 0xffff;
    setOutput(item, 1, driven((word >> 8) & 0xff));
    setOutput(item, 2, driven(word & 0xff));
    return;
  }
  if (type === TYPE.DOT) {
    const address = getBits(item, 0, 8);
    const clock = getInput(item, 5);
    if (commitState && firstTickPass && risingEdge(item.internal.lastClock ?? 0, clock)) {
      if (isHigh(getInput(item, 2))) item.internal.back.fill(0);
      else if (isHigh(getInput(item, 3))) item.internal.back[address] = isHigh(getInput(item, 1)) ? 1 : 0;
      if (isHigh(getInput(item, 4))) item.internal.display = [...item.internal.back];
    }
    if (commitState && firstTickPass) item.internal.lastClock = isHigh(clock) ? 1 : 0;
    setOutput(item, 6, driven(item.internal.display?.[address] ?? 0));
    return;
  }
  if (type === TYPE.RGB) {
    const address = getBits(item, 0, 8);
    const clock = getInput(item, 7);
    if (commitState && firstTickPass && risingEdge(item.internal.lastClock ?? 0, clock)) {
      if (isHigh(getInput(item, 4))) item.internal.back.fill(0);
      else if (isHigh(getInput(item, 5))) {
        const colour = getBits(item, 1, 4) | (getBits(item, 2, 4) << 4) | (getBits(item, 3, 4) << 8);
        item.internal.back[address] = colour;
      }
      if (isHigh(getInput(item, 6))) item.internal.display = [...item.internal.back];
    }
    if (commitState && firstTickPass) item.internal.lastClock = isHigh(clock) ? 1 : 0;
    const colour = item.internal.display?.[address] ?? 0;
    setOutput(item, 8, driven(colour & 0xf));
    setOutput(item, 9, driven((colour >> 4) & 0xf));
    setOutput(item, 10, driven((colour >> 8) & 0xf));
    return;
  }
  if (type === TYPE.BUZZER) {
    simulator.audioNotes.push({ pitch: getBits(item, 1, 8), volume: getBits(item, 0, 4) });
    return;
  }
  // The visual display and buzzer chips have no output signal. Their input
  // state is preserved in snapshots for the renderer and audio adapter.
}

function processInstance(item, simulator, tickId, commitState = false) {
  if (item.description.kind === "custom") {
    const external = new Map(item.description.inputPins.map((pin) => [String(pin.id), getInput(item, pin.id)]));
    const childSnapshot = evaluateNetwork(item.child, simulator, tickId, external, commitState);
    item.description.outputPins.forEach((pin) => setOutput(item, pin.id, childSnapshot.outputs.get(String(pin.id)) ?? disconnected()));
    return;
  }
  processBuiltin(item, simulator, tickId, commitState);
}

function resetDerivedSignals(runtime) {
  for (const key of runtime.rootOutputs.keys()) runtime.rootOutputs.set(key, disconnected());
  for (const key of runtime.junctions.keys()) runtime.junctions.set(key, disconnected());
  for (const item of runtime.instances.values()) {
    for (const key of item.inputs.keys()) item.inputs.set(key, disconnected());
  }
}

function settleNetwork(runtime, simulator, tickId) {
  // Rebuild driven inputs from the current outputs on every pass. This avoids
  // treating a legitimate 0 -> 1 transition as a bus conflict with the value
  // left over from the previous simulation tick.
  for (let pass = 0; pass < 32; pass += 1) {
    resetDerivedSignals(runtime);
    propagateAll(runtime);
    const before = snapshotRuntimeSignals(runtime);
    for (const item of runtime.instances.values()) processInstance(item, simulator, tickId, false);
    if (before === snapshotRuntimeSignals(runtime)) break;
  }
}

function evaluateNetwork(runtime, simulator, tickId, externalInputs = new Map(), commitState = true) {
  runtime.lastTick = tickId;
  for (const pin of runtime.description.inputPins ?? []) runtime.rootInputs.set(String(pin.id), copyState(externalInputs.get(String(pin.id)) ?? disconnected()));

  // First settle the combinational network using the current input values.
  // Stateful devices commit once after their inputs are settled, then a final
  // combinational pass exposes any changed memory/display/pulse output.
  settleNetwork(runtime, simulator, tickId);
  if (commitState) {
    for (const item of runtime.instances.values()) processInstance(item, simulator, tickId, true);
    settleNetwork(runtime, simulator, tickId);
  }

  const outputs = new Map();
  for (const pin of runtime.description.outputPins ?? []) outputs.set(String(pin.id), runtime.rootOutputs.get(String(pin.id)) ?? disconnected());
  return { outputs, runtime };
}

function snapshotRuntimeSignals(runtime) {
  const values = [];
  for (const [key, value] of runtime.rootOutputs) values.push(`r:${key}:${value.bits}:${value.tri}`);
  for (const [key, value] of runtime.junctions) values.push(`j:${key}:${value.bits}:${value.tri}`);
  for (const [id, item] of runtime.instances) {
    for (const [key, value] of item.inputs) values.push(`i:${id}:${key}:${value.bits}:${value.tri}`);
    for (const [key, value] of item.outputs) values.push(`o:${id}:${key}:${value.bits}:${value.tri}`);
  }
  return values.join("|");
}

function collectSnapshot(runtime, result = emptySnapshot()) {
  for (const [id, item] of runtime.instances) {
    const signals = {};
    for (const [pin, value] of [...item.inputs, ...item.outputs]) signals[pin] = copyState(value);
    result.instances[id] = { signals, internal: clone(item.internal), type: item.description.type };
    for (const [pin, value] of item.inputs) result.endpoints[`${id}:${pin}`] = copyState(value);
    for (const [pin, value] of item.outputs) result.endpoints[`${id}:${pin}`] = copyState(value);
    if (item.child) collectSnapshot(item.child, result);
  }
  for (const [pin, value] of runtime.rootInputs) result.endpoints[`root:${pin}`] = copyState(value);
  for (const [pin, value] of runtime.rootOutputs) result.endpoints[`root:${pin}`] = copyState(value);
  return result;
}

export class Simulator {
  constructor(project) {
    this.project = project;
    this.stepCount = 0;
    this.revision = -1;
    this.runtime = null;
    this.snapshot = emptySnapshot();
    this.audioNotes = [];
    this.syncProject(project);
  }

  syncProject(project) {
    const changed = !this.runtime || this.revision !== project._revision || this.root !== project.root;
    this.project = project;
    if (changed) {
      this.runtime = runtimeFor(project.root, project);
      this.revision = project._revision;
      this.root = project.root;
      this.stepCount = 0;
      this.audioNotes = [];
      const result = evaluateNetwork(this.runtime, this, this.stepCount, new Map(), false);
      this.snapshot = collectSnapshot(this.runtime, emptySnapshot(this.stepCount, result.outputs));
    }
    return this;
  }

  reset() {
    this.stepCount = 0;
    this.runtime = runtimeFor(this.project.root, this.project);
    this.revision = this.project._revision;
    this.root = this.project.root;
    this.audioNotes = [];
    const result = evaluateNetwork(this.runtime, this, this.stepCount, new Map(), false);
    this.snapshot = collectSnapshot(this.runtime, emptySnapshot(this.stepCount, result.outputs));
    return this.snapshot;
  }

  evaluate() {
    this.syncProject(this.project);
    this.audioNotes = [];
    const result = evaluateNetwork(this.runtime, this, this.stepCount, new Map(), false);
    this.snapshot = collectSnapshot(this.runtime, emptySnapshot(this.stepCount, result.outputs));
    return this.snapshot;
  }

  restore(snapshot, stepCount = 0) {
    this.syncProject(this.project);
    this.stepCount = Math.max(0, Number(stepCount) || 0);
    this.audioNotes = [];
    const saved = cloneSnapshot(snapshot);
    const restoreRuntime = (runtime, root = false) => {
      for (const [id, item] of runtime.instances) {
        const itemSnapshot = saved.instances?.[id];
        if (itemSnapshot) {
          item.internal = clone(itemSnapshot.internal ?? {});
          for (const pin of item.inputs.keys()) item.inputs.set(pin, copyState(itemSnapshot.signals?.[pin]));
          for (const pin of item.outputs.keys()) item.outputs.set(pin, copyState(itemSnapshot.signals?.[pin]));
        }
        item.lastTick = this.stepCount;
        if (item.child) restoreRuntime(item.child);
      }
      if (root) {
        for (const pin of runtime.rootInputs.keys()) runtime.rootInputs.set(pin, copyState(saved.endpoints?.[`root:${pin}`]));
        for (const pin of runtime.rootOutputs.keys()) runtime.rootOutputs.set(pin, copyState(saved.endpoints?.[`root:${pin}`]));
      }
      runtime.lastTick = this.stepCount;
    };
    restoreRuntime(this.runtime, true);
    this.snapshot = { ...saved, step: this.stepCount };
    return this.snapshot;
  }

  step() {
    this.syncProject(this.project);
    this.stepCount += 1;
    this.audioNotes = [];
    const result = evaluateNetwork(this.runtime, this, this.stepCount, new Map());
    this.snapshot = collectSnapshot(this.runtime, emptySnapshot(this.stepCount, result.outputs));
    return this.snapshot;
  }

  stateFor(endpoint) {
    return this.snapshot.endpoints[`${endpoint.owner}:${endpoint.pin}`] ?? disconnected();
  }

  outputFor(instanceId) {
    const item = this.snapshot.instances[String(instanceId)];
    return item?.signals?.["0"] ?? disconnected();
  }
}

export function stateLabel(value, bits = 1) {
  if (!value || ((value.tri & maskForBits(bits)) === maskForBits(bits))) return "Z";
  if (bits === 1) return isHigh(value) ? "1" : "0";
  return `0x${valueOf(value, bits).toString(16).toUpperCase().padStart(Math.ceil(bits / 4), "0")}`;
}
