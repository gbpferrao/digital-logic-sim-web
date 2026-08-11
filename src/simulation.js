import {
  BUILTINS,
  TYPE,
  clone,
  descriptorForInstance,
  getDescription,
  getInputPin,
  getOutputPin,
  interfaceBindingsFor,
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
export const SIMULATION_SCOPE_ROOT = "root";

export function simulationScopeKey(path = []) {
  const parts = Array.isArray(path) ? path : path == null ? [] : [path];
  return parts.length
    ? `${SIMULATION_SCOPE_ROOT}/${parts.map((part) => encodeURIComponent(String(part))).join("/")}`
    : SIMULATION_SCOPE_ROOT;
}

function emptySnapshotScope() {
  return { endpoints: {}, instances: {} };
}

function cloneSnapshotInstance(item) {
  return {
    ...item,
    signals: Object.fromEntries(Object.entries(item?.signals ?? {}).map(([key, value]) => [key, copyState(value)])),
    internal: clone(item?.internal ?? {})
  };
}

function cloneSnapshotScope(scope) {
  return {
    endpoints: Object.fromEntries(Object.entries(scope?.endpoints ?? {}).map(([key, value]) => [key, copyState(value)])),
    instances: Object.fromEntries(Object.entries(scope?.instances ?? {}).map(([id, item]) => [id, cloneSnapshotInstance(item)]))
  };
}

export function emptySnapshot(step = 0, outputs = new Map()) {
  return {
    version: SIMULATION_SNAPSHOT_VERSION,
    step: Math.max(0, Number(step) || 0),
    endpoints: {},
    instances: {},
    scopes: { [SIMULATION_SCOPE_ROOT]: emptySnapshotScope() },
    outputs
  };
}

export function cloneSnapshot(snapshot) {
  const source = snapshot ?? emptySnapshot();
  const outputs = source.outputs instanceof Map
    ? new Map([...source.outputs].map(([key, value]) => [key, copyState(value)]))
    : Object.fromEntries(Object.entries(source.outputs ?? {}).map(([key, value]) => [key, copyState(value)]));
  const instances = Object.fromEntries(Object.entries(source.instances ?? {}).map(([id, item]) => [id, cloneSnapshotInstance(item)]));
  const scopes = Object.fromEntries(Object.entries(source.scopes ?? {}).map(([key, scope]) => [key, cloneSnapshotScope(scope)]));
  if (!Object.keys(scopes).length) {
    scopes[SIMULATION_SCOPE_ROOT] = {
      endpoints: Object.fromEntries(Object.entries(source.endpoints ?? {}).map(([key, value]) => [key, copyState(value)])),
      instances: Object.fromEntries(Object.entries(instances).map(([id, item]) => [id, cloneSnapshotInstance(item)]))
    };
  } else if (!scopes[SIMULATION_SCOPE_ROOT]) scopes[SIMULATION_SCOPE_ROOT] = emptySnapshotScope();
  return {
    version: Number(source.version) || SIMULATION_SNAPSHOT_VERSION,
    step: Math.max(0, Number(source.step) || 0),
    endpoints: Object.fromEntries(Object.entries(source.endpoints ?? {}).map(([key, value]) => [key, copyState(value)])),
    instances,
    scopes,
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

function runtimeFor(description, project, depth = 0) {
  const interfaceInputs = new Map(interfaceBindingsFor(description, "input").map((binding) => [String(binding.instanceId), binding]));
  const interfaceOutputs = new Map(interfaceBindingsFor(description, "output").map((binding) => [String(binding.instanceId), binding]));
  const runtime = {
    description,
    instances: new Map(),
    junctions: new Map((description.junctions ?? []).map((junction) => [String(junction.id), disconnected()])),
    rootInputs: pinStateMap({ inputPins: description.inputPins ?? [], outputPins: [] }),
    rootOutputs: pinStateMap({ inputPins: [], outputPins: description.outputPins ?? [] }),
    interfaceInputs,
    interfaceOutputs,
    lastTick: -1,
    depth,
    signalVersion: 0,
    settlePasses: 0,
    settleLimitHits: 0
  };
  for (const instance of description.instances ?? []) {
    const desc = getDescription(project, instance.name);
    if (!desc) continue;
    runtime.instances.set(String(instance.id), {
      instance,
      description: desc,
      inputs: pinStateMap({ inputPins: desc.inputPins, outputPins: [] }),
      outputs: pinStateMap({ inputPins: [], outputPins: desc.outputPins }),
      child: desc.kind === "custom" ? runtimeFor(desc, project, depth + 1) : null,
      interfaceInput: interfaceInputs.get(String(instance.id)) ?? null,
      interfaceOutput: interfaceOutputs.get(String(instance.id)) ?? null,
      interfaceInputValue: null,
      internal: clone(instance.internalData ?? {}),
      lastTick: -1,
      runtime
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
  const key = String(id);
  if (!item.outputs.has(key)) return;
  const next = copyState(value);
  const previous = item.outputs.get(key);
  if (!stateEqual(previous, next)) {
    item.outputs.set(key, next);
    item.runtime.signalVersion += 1;
  }
}

function getInput(item, id) { return item.inputs.get(String(id)) ?? disconnected(); }
function getBits(item, id, bits) { return valueOf(getInput(item, id), bits); }

function risingEdge(previous, current) { return isHigh(current) && !previous; }

function ensureMemory(item) {
  const size = Math.max(1, Number(item.description.memorySize) || 256);
  if (!Array.isArray(item.internal.memory) || item.internal.memory.length !== size) {
    const previous = Array.isArray(item.internal.memory) ? item.internal.memory : [];
    item.internal.memory = Array.from({ length: size }, (_, index) => Number(previous[index]) || 0);
  }
  return item.internal.memory;
}

function hackAlu(x, y, comp) {
  let left = x & PIN_MASK;
  let right = y & PIN_MASK;
  if ((comp >> 5) & 1) left = 0;
  if ((comp >> 4) & 1) left = (~left) & PIN_MASK;
  if ((comp >> 3) & 1) right = 0;
  if ((comp >> 2) & 1) right = (~right) & PIN_MASK;
  let result = (comp >> 1) & 1 ? (left + right) : (left & right);
  result &= PIN_MASK;
  if (comp & 1) result = (~result) & PIN_MASK;
  return result;
}

function hackJumpTaken(value, jump) {
  const negative = Boolean(value & 0x8000);
  const zero = value === 0;
  return jump === 1 ? !negative && !zero
    : jump === 2 ? zero
      : jump === 3 ? !negative
        : jump === 4 ? negative
          : jump === 5 ? !zero
            : jump === 6 ? negative || zero
              : jump === 7;
}

function processBuiltin(item, simulator, tickId, commitState = false) {
  const desc = item.description;
  const type = desc.type;
  const firstTickPass = item.lastTick !== tickId;
  if (commitState && firstTickPass) item.lastTick = tickId;

  if (isInputType(type)) {
    const bits = desc.outputPins[0]?.bits ?? 1;
    if (item.interfaceInput) {
      const value = item.interfaceInputValue ?? disconnected();
      setOutput(item, desc.outputPins[0]?.id ?? 0, state(value.bits & maskForBits(bits), value.tri & maskForBits(bits)));
    } else {
      const raw = simulator.project.inputValues[item.instance.id] ?? 0;
      setOutput(item, desc.outputPins[0]?.id ?? 0, driven(Number(raw) & maskForBits(bits)));
    }
    return;
  }
  if (isOutputType(type)) return;
  if (desc.special === "constant") {
    const output = desc.outputPins[0];
    const bits = output?.bits ?? desc.wordBits ?? 1;
    setOutput(item, output?.id ?? 0, driven((Number(desc.constantValue) || 0) & maskForBits(bits)));
    return;
  }
  if (desc.special === "dff") {
    const clock = getInput(item, 1);
    if (commitState && firstTickPass) {
      if (risingEdge(item.internal.lastClock ?? 0, clock)) item.internal.value = getBits(item, 0, 1);
      item.internal.lastClock = isHigh(clock) ? 1 : 0;
    }
    setOutput(item, 2, driven(item.internal.value ?? 0));
    return;
  }
  if (desc.special === "register" || desc.special === "pc") {
    const clockPin = desc.special === "pc" ? 4 : 2;
    const clock = getInput(item, clockPin);
    if (commitState && firstTickPass) {
      if (risingEdge(item.internal.lastClock ?? 0, clock)) {
        if (desc.special === "pc") {
          if (isHigh(getInput(item, 3))) item.internal.value = 0;
          else if (isHigh(getInput(item, 1))) item.internal.value = getBits(item, 0, 16);
          else if (isHigh(getInput(item, 2))) item.internal.value = ((item.internal.value ?? 0) + 1) & PIN_MASK;
        } else if (isHigh(getInput(item, 1))) item.internal.value = getBits(item, 0, 16);
      }
      item.internal.lastClock = isHigh(clock) ? 1 : 0;
    }
    setOutput(item, desc.outputPins[0]?.id ?? (desc.special === "pc" ? 5 : 3), driven(item.internal.value ?? 0));
    return;
  }
  if (desc.special === "keyboard") {
    const key = item.internal.key || "Space";
    const held = simulator.project.keyValues[key] || simulator.project.keyValues[`Key${String(key).toUpperCase()}`] || simulator.project.keyValues[String(key).toLowerCase()];
    const keyCode = held ? Number(item.internal.keyCode || 32) : 0;
    setOutput(item, desc.outputPins[0]?.id ?? 0, driven(keyCode & maskForBits(desc.outputPins[0]?.bits ?? 16)));
    return;
  }
  if (desc.special === "hackCpu") {
    const instruction = getBits(item, 1, 16);
    const inM = getBits(item, 0, 16);
    const isCInstruction = Boolean(instruction & 0x8000);
    const comp = (instruction >> 6) & 0x3f;
    const useMemory = Boolean((instruction >> 12) & 1);
    const alu = hackAlu(item.internal.d ?? 0, useMemory ? inM : item.internal.a ?? 0, comp);
    const dest = (instruction >> 3) & 0x7;
    const jump = instruction & 0x7;
    if (commitState && firstTickPass) {
      const clock = getInput(item, 3);
      if (risingEdge(item.internal.lastClock ?? 0, clock)) {
        const reset = isHigh(getInput(item, 2));
        if (reset) item.internal.pc = 0;
        else if (isCInstruction && hackJumpTaken(alu, jump)) item.internal.pc = (item.internal.a ?? 0) & 0x7fff;
        else item.internal.pc = ((item.internal.pc ?? 0) + 1) & 0x7fff;
        if (isCInstruction) {
          if (dest & 4) item.internal.a = alu & 0x7fff;
          if (dest & 2) item.internal.d = alu;
        } else item.internal.a = instruction & 0x7fff;
      }
      item.internal.lastClock = isHigh(clock) ? 1 : 0;
    }
    setOutput(item, 4, driven(isCInstruction ? alu : 0));
    setOutput(item, 5, driven(isCInstruction && Boolean(dest & 1) ? 1 : 0));
    setOutput(item, 6, driven((item.internal.a ?? 0) & 0x7fff));
    setOutput(item, 7, driven((item.internal.pc ?? 0) & 0x7fff));
    return;
  }
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
  if ([TYPE.MERGE_1_4, TYPE.MERGE_1_8, TYPE.MERGE_4_8, TYPE.MERGE_1_16, TYPE.MERGE_8_16].includes(type)) {
    const out = desc.outputPins[0];
    let bits = 0;
    let tri = 0;
    let offset = 0;
    desc.inputPins.forEach((pin, index) => {
      const input = getInput(item, pin.id);
      bits |= (input.bits & maskForBits(pin.bits)) << offset;
      tri |= (input.tri & maskForBits(pin.bits)) << offset;
      offset += pin.bits;
    });
    setOutput(item, out.id, state(bits, tri));
    return;
  }
  if ([TYPE.SPLIT_4_1, TYPE.SPLIT_8_4, TYPE.SPLIT_8_1, TYPE.SPLIT_16_8, TYPE.SPLIT_16_1].includes(type)) {
    const source = getInput(item, desc.inputPins[0]?.id ?? 0);
    if (desc.outputPins.length === 2 && desc.outputPins[0].bits === 8) {
      setOutput(item, desc.outputPins[0].id, state((source.bits >> 8) & 0xff, (source.tri >> 8) & 0xff));
      setOutput(item, desc.outputPins[1].id, state(source.bits & 0xff, source.tri & 0xff));
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
  if (["ram", "screen", "memoryMap"].includes(desc.special)) {
    const memory = ensureMemory(item);
    const address = getBits(item, 0, desc.addressBits ?? 8) % memory.length;
    const clock = getInput(item, 4);
    const previousClock = item.internal.lastClock ?? 0;
    if (commitState && firstTickPass && risingEdge(previousClock, clock)) {
      if (isHigh(getInput(item, 3))) item.internal.memory.fill(0);
      else if (isHigh(getInput(item, 2))) item.internal.memory[address] = getBits(item, 1, desc.wordBits ?? 16);
    }
    if (commitState && firstTickPass) item.internal.lastClock = isHigh(clock) ? 1 : 0;
    setOutput(item, desc.outputPins[0]?.id ?? 5, driven(item.internal.memory?.[address] ?? 0));
    return;
  }
  if (desc.special === "rom") {
    const memory = ensureMemory(item);
    const word = Number(memory[getBits(item, 0, desc.addressBits ?? 8) % memory.length] ?? 0) & PIN_MASK;
    if (desc.outputPins.length === 1) setOutput(item, desc.outputPins[0].id, driven(word));
    else {
      setOutput(item, desc.outputPins[0]?.id ?? 1, driven((word >> 8) & 0xff));
      setOutput(item, desc.outputPins[1]?.id ?? 2, driven(word & 0xff));
    }
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
    const beforeVersion = runtime.signalVersion;
    for (const item of runtime.instances.values()) processInstance(item, simulator, tickId, false);
    runtime.settlePasses += 1;
    if (runtime.signalVersion === beforeVersion) break;
    if (pass === 31) runtime.settleLimitHits += 1;
  }
}

function resetRuntimeMetrics(runtime) {
  runtime.signalVersion = 0;
  runtime.settlePasses = 0;
  runtime.settleLimitHits = 0;
  for (const item of runtime.instances.values()) if (item.child) resetRuntimeMetrics(item.child);
}

function collectRuntimeMetrics(runtime, metrics = { evaluations: 0, settlePasses: 0, settleLimitHits: 0, maxDepth: 0 }) {
  metrics.evaluations += 1;
  metrics.settlePasses += runtime.settlePasses;
  metrics.settleLimitHits += runtime.settleLimitHits;
  metrics.maxDepth = Math.max(metrics.maxDepth, runtime.depth ?? 0);
  for (const item of runtime.instances.values()) if (item.child) collectRuntimeMetrics(item.child, metrics);
  return metrics;
}

function evaluateNetwork(runtime, simulator, tickId, externalInputs = new Map(), commitState = true) {
  resetRuntimeMetrics(runtime);
  runtime.lastTick = tickId;
  for (const pin of runtime.description.inputPins ?? []) runtime.rootInputs.set(String(pin.id), copyState(externalInputs.get(String(pin.id)) ?? disconnected()));
  for (const item of runtime.instances.values()) {
    item.interfaceInputValue = item.interfaceInput
      ? copyState(externalInputs.get(String(item.interfaceInput.publicId)) ?? disconnected())
      : null;
  }

  // First settle the combinational network using the current input values.
  // Stateful devices commit once after their inputs are settled, then a final
  // combinational pass exposes any changed memory/display/pulse output.
  settleNetwork(runtime, simulator, tickId);
  if (commitState) {
    for (const item of runtime.instances.values()) processInstance(item, simulator, tickId, true);
    settleNetwork(runtime, simulator, tickId);
  }

  for (const binding of interfaceBindingsFor(runtime.description, "output")) {
    const item = runtime.instances.get(String(binding.instanceId));
    if (!item) continue;
    runtime.rootOutputs.set(String(binding.publicId), copyState(item.inputs.get(String(binding.pinId)) ?? disconnected()));
  }

  const outputs = new Map();
  for (const pin of runtime.description.outputPins ?? []) outputs.set(String(pin.id), runtime.rootOutputs.get(String(pin.id)) ?? disconnected());
  return { outputs, runtime };
}

function collectSnapshot(runtime, result = emptySnapshot(), scopePath = []) {
  result.scopes ??= {};
  const scopeKey = simulationScopeKey(scopePath);
  const scope = result.scopes[scopeKey] ?? (result.scopes[scopeKey] = emptySnapshotScope());
  for (const [id, item] of runtime.instances) {
    const signals = {};
    for (const [pin, value] of [...item.inputs, ...item.outputs]) signals[pin] = copyState(value);
    const itemSnapshot = { signals, internal: clone(item.internal), type: item.description.type };
    scope.instances[id] = itemSnapshot;
    result.instances[id] = itemSnapshot;
    for (const [pin, value] of item.inputs) {
      scope.endpoints[`${id}:${pin}`] = copyState(value);
      if (!scopePath.length) result.endpoints[`${id}:${pin}`] = copyState(value);
    }
    for (const [pin, value] of item.outputs) {
      scope.endpoints[`${id}:${pin}`] = copyState(value);
      if (!scopePath.length) result.endpoints[`${id}:${pin}`] = copyState(value);
    }
    if (item.child) collectSnapshot(item.child, result, [...scopePath, id]);
  }
  for (const [id, value] of runtime.junctions) {
    scope.endpoints[`junction:${id}`] = copyState(value);
    if (!scopePath.length) result.endpoints[`junction:${id}`] = copyState(value);
  }
  for (const [pin, value] of runtime.rootInputs) {
    scope.endpoints[`root:${pin}`] = copyState(value);
    if (!scopePath.length) result.endpoints[`root:${pin}`] = copyState(value);
  }
  for (const [pin, value] of runtime.rootOutputs) {
    scope.endpoints[`root:${pin}`] = copyState(value);
    if (!scopePath.length) result.endpoints[`root:${pin}`] = copyState(value);
  }
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
    this._diagnostics = { evaluations: 0, settlePasses: 0, settleLimitHits: 0, maxDepth: 0 };
    this._diagnosticsDirty = true;
    this.syncProject(project);
  }

  get diagnostics() {
    return this._diagnosticsDirty ? this.updateDiagnostics() : this._diagnostics;
  }

  updateDiagnostics() {
    this._diagnostics = collectRuntimeMetrics(this.runtime);
    this._diagnosticsDirty = false;
    return this._diagnostics;
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
      this._diagnosticsDirty = true;
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
    this._diagnosticsDirty = true;
    return this.snapshot;
  }

  evaluate() {
    this.syncProject(this.project);
    this.audioNotes = [];
    const result = evaluateNetwork(this.runtime, this, this.stepCount, new Map(), false);
    this.snapshot = collectSnapshot(this.runtime, emptySnapshot(this.stepCount, result.outputs));
    this._diagnosticsDirty = true;
    return this.snapshot;
  }

  restore(snapshot, stepCount = 0) {
    this.syncProject(this.project);
    this.stepCount = Math.max(0, Number(stepCount) || 0);
    this.audioNotes = [];
    const saved = cloneSnapshot(snapshot);
    const restoreRuntime = (runtime, scopePath = []) => {
      const scope = saved.scopes?.[simulationScopeKey(scopePath)];
      for (const [id, item] of runtime.instances) {
        const itemSnapshot = scope?.instances?.[id] ?? saved.instances?.[id];
        if (itemSnapshot) {
          item.internal = clone(itemSnapshot.internal ?? {});
          for (const pin of item.inputs.keys()) item.inputs.set(pin, copyState(itemSnapshot.signals?.[pin]));
          for (const pin of item.outputs.keys()) item.outputs.set(pin, copyState(itemSnapshot.signals?.[pin]));
        }
        item.lastTick = this.stepCount;
        if (item.child) restoreRuntime(item.child, [...scopePath, id]);
      }
      for (const [id] of runtime.junctions) runtime.junctions.set(id, copyState(scope?.endpoints?.[`junction:${id}`]));
      const endpoints = scope?.endpoints ?? (scopePath.length ? null : saved.endpoints);
      if (endpoints) {
        for (const pin of runtime.rootInputs.keys()) runtime.rootInputs.set(pin, copyState(endpoints[`root:${pin}`]));
        for (const pin of runtime.rootOutputs.keys()) runtime.rootOutputs.set(pin, copyState(endpoints[`root:${pin}`]));
      }
      runtime.lastTick = this.stepCount;
    };
    restoreRuntime(this.runtime);
    this.snapshot = { ...saved, step: this.stepCount };
    this._diagnosticsDirty = true;
    return this.snapshot;
  }

  step() {
    this.syncProject(this.project);
    this.stepCount += 1;
    this.audioNotes = [];
    const result = evaluateNetwork(this.runtime, this, this.stepCount, new Map());
    this.snapshot = collectSnapshot(this.runtime, emptySnapshot(this.stepCount, result.outputs));
    this._diagnosticsDirty = true;
    return this.snapshot;
  }

  snapshotForScope(scopePath = []) {
    return this.snapshot.scopes?.[simulationScopeKey(scopePath)] ?? null;
  }

  stateFor(endpoint, scopePath = []) {
    const key = `${endpoint.owner}:${endpoint.pin}`;
    const scoped = this.snapshotForScope(scopePath);
    return scoped?.endpoints?.[key]
      ?? (!scoped || !scopePath?.length ? this.snapshot.endpoints[key] : null)
      ?? disconnected();
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
