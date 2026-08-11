import { SimulationTrace } from "./simulation-trace.js";

export const SIMULATION_BAKE_VERSION = 1;
export const DEFAULT_BAKE_MAX_BYTES = 32 * 1024 * 1024;
export const DEFAULT_BAKE_MAX_INTERACTIONS = 256;

function estimateValueBytes(value, seen = new WeakSet()) {
  if (value == null) return 8;
  if (typeof value === "string") return value.length * 2 + 8;
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (typeof value !== "object") return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) return 16 + value.reduce((total, item) => total + estimateValueBytes(item, seen), 0);
  return 32 + Object.entries(value).reduce((total, [key, item]) => total + key.length * 2 + estimateValueBytes(item, seen), 0);
}

export function estimateFrameBytes(frame) {
  if (Number.isFinite(Number(frame?.estimatedBytes)) && Number(frame.estimatedBytes) >= 0) return Number(frame.estimatedBytes);
  return 64 + estimateValueBytes(frame?.snapshot) + estimateValueBytes(String(frame?.signature ?? ""));
}

export function createTimelineFrame({
  step = 0,
  snapshot = null,
  signature = "",
  estimatedBytes = null,
  cause = "tick",
  source = "simulation",
  visible = true,
  traceStart = null,
  traceEnd = null
} = {}) {
  const boundary = (value) => value == null || value === ""
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
  const frame = {
    version: SIMULATION_BAKE_VERSION,
    step: Math.max(0, Number(step) || 0),
    snapshot,
    signature: String(signature ?? ""),
    cause: String(cause || "tick"),
    source: String(source || "simulation"),
    visible: Boolean(visible),
    traceStart: boundary(traceStart),
    traceEnd: boundary(traceEnd)
  };
  frame.estimatedBytes = Number.isFinite(Number(estimatedBytes)) && Number(estimatedBytes) >= 0
    ? Number(estimatedBytes)
    : estimateFrameBytes(frame);
  return frame;
}

export class SimulationBake {
  constructor({
    maxFrames = 512,
    maxBytes = DEFAULT_BAKE_MAX_BYTES,
    stabilityWindow = 16,
    maxInteractions = DEFAULT_BAKE_MAX_INTERACTIONS,
    trace = {}
  } = {}) {
    this.maxFrames = Math.max(2, Number(maxFrames) || 512);
    this.maxBytes = Math.max(256, Number(maxBytes) || DEFAULT_BAKE_MAX_BYTES);
    this.stabilityWindow = Math.max(1, Number(stabilityWindow) || 16);
    this.maxInteractions = Math.max(1, Number(maxInteractions) || DEFAULT_BAKE_MAX_INTERACTIONS);
    this.frames = [];
    this.interactions = [];
    this.interactionSequence = 0;
    this.totalInteractions = 0;
    this.trace = new SimulationTrace(trace);
    this.estimatedBytes = 0;
    this.cursor = 0;
    this.execution = null;
    this.status = "empty";
    this.reason = null;
    this.stableTicks = 0;
    this.lastSignature = "";
  }

  get length() {
    return this.frames.length;
  }

  get currentIndex() {
    return this.cursor;
  }

  get currentCheckpoint() {
    return this.frames[this.cursor] ?? null;
  }

  get executionFrame() {
    return this.execution ?? this.currentCheckpoint;
  }

  get hasBake() {
    return this.frames.length > 0;
  }

  get isBaking() {
    return this.status === "baking";
  }

  get isReady() {
    return this.status === "ready";
  }

  get latestCheckpoint() {
    return this.frames.at(-1) ?? null;
  }

  get memoryBytes() {
    return this.estimatedBytes;
  }

  get traceMemoryBytes() {
    return this.trace.memoryBytes;
  }

  get traceEvents() {
    return this.trace.events;
  }

  frameAt(index) {
    return this.frames[Math.max(0, Math.min(this.frames.length - 1, Number(index) || 0))] ?? null;
  }

  reset(frame) {
    const next = createTimelineFrame(frame);
    this.frames = [next];
    this.interactions = [];
    this.interactionSequence = 0;
    this.totalInteractions = 0;
    this.trace.clear();
    this.estimatedBytes = next.estimatedBytes;
    this.cursor = 0;
    this.execution = next;
    this.status = "ready";
    this.reason = "reset";
    this.stableTicks = 0;
    this.lastSignature = next.signature;
    return next;
  }

  begin(frame, { stabilityWindow = this.stabilityWindow } = {}) {
    const next = createTimelineFrame(frame);
    this.frames = [next];
    this.interactions = [];
    this.interactionSequence = 0;
    this.totalInteractions = 0;
    this.trace.clear();
    this.estimatedBytes = next.estimatedBytes;
    this.cursor = 0;
    this.execution = next;
    this.status = "baking";
    this.reason = null;
    this.stabilityWindow = Math.max(1, Number(stabilityWindow) || this.stabilityWindow);
    this.stableTicks = 0;
    this.lastSignature = next.signature;
    return next;
  }

  reopen({ stabilityWindow = this.stabilityWindow } = {}) {
    if (!this.hasBake) return null;
    this.status = "baking";
    this.reason = null;
    this.stabilityWindow = Math.max(1, Number(stabilityWindow) || this.stabilityWindow);
    this.stableTicks = 0;
    this.lastSignature = this.executionFrame?.signature ?? "";
    return this.executionFrame;
  }

  finish(reason = "manual") {
    if (!this.hasBake) return null;
    this.status = "ready";
    this.reason = String(reason || "manual");
    return this.executionFrame;
  }

  clear() {
    this.frames = [];
    this.interactions = [];
    this.interactionSequence = 0;
    this.totalInteractions = 0;
    this.trace.clear();
    this.estimatedBytes = 0;
    this.cursor = 0;
    this.execution = null;
    this.status = "empty";
    this.reason = null;
    this.stableTicks = 0;
    this.lastSignature = "";
  }

  observe(signature) {
    if (!this.isBaking) return false;
    const nextSignature = String(signature ?? "");
    if (nextSignature === this.lastSignature) this.stableTicks += 1;
    else {
      this.lastSignature = nextSignature;
      this.stableTicks = 0;
    }
    return this.stableTicks >= this.stabilityWindow;
  }

  setCursor(index) {
    if (!this.frames.length) return null;
    this.cursor = Math.max(0, Math.min(this.frames.length - 1, Number(index) || 0));
    this.execution = this.frames[this.cursor];
    return this.execution;
  }

  truncateFuture() {
    if (this.cursor >= this.frames.length - 1) return;
    this.frames = this.frames.slice(0, this.cursor + 1);
    this.execution = this.currentCheckpoint;
    this.trace.truncateAfterStep(this.currentCheckpoint?.step ?? 0);
    this.interactions = this.interactions.filter((event) => event.step <= (this.currentCheckpoint?.step ?? 0));
    this.recalculateMemory();
  }

  updateExecution(frame) {
    this.execution = createTimelineFrame(frame);
    return this.execution;
  }

  recordInteraction(event = {}) {
    const next = {
      version: SIMULATION_BAKE_VERSION,
      sequence: this.interactionSequence++,
      kind: String(event.kind || "interaction"),
      source: String(event.source || "unknown"),
      step: Math.max(0, Number(event.step) || 0),
      target: event.target == null ? null : String(event.target),
      before: event.before ?? null,
      after: event.after ?? null,
      phase: event.phase == null ? null : String(event.phase),
      reason: event.reason == null ? null : String(event.reason)
    };
    this.interactions.push(next);
    this.totalInteractions += 1;
    if (this.interactions.length > this.maxInteractions) this.interactions.splice(0, this.interactions.length - this.maxInteractions);
    return next;
  }

  recordTrace(event = {}) {
    return this.trace.record(event);
  }

  record(frame, { visible = true } = {}) {
    const next = createTimelineFrame(frame);
    this.truncateFuture();
    if (!this.frames.length) return this.reset(next);
    this.execution = next;
    if (!visible) return next;

    const last = this.latestCheckpoint;
    if (last?.step === next.step) {
      this.estimatedBytes -= last.estimatedBytes ?? estimateFrameBytes(last);
      this.frames[this.frames.length - 1] = next;
      this.estimatedBytes += next.estimatedBytes;
      this.cursor = this.frames.length - 1;
      return next;
    }

    this.frames.push(next);
    this.estimatedBytes += next.estimatedBytes;
    this.cursor = this.frames.length - 1;
    this.prune();
    return next;
  }

  previousIndex(predicate = () => true) {
    for (let index = this.cursor - 1; index >= 0; index -= 1) {
      if (predicate(this.frames[index], index)) return index;
    }
    return -1;
  }

  nextIndex(predicate = () => true) {
    for (let index = this.cursor + 1; index < this.frames.length; index += 1) {
      if (predicate(this.frames[index], index)) return index;
    }
    return -1;
  }

  prune() {
    const excess = this.frames.length - this.maxFrames;
    if (excess > 0) {
      const removed = this.frames.splice(1, excess);
      this.estimatedBytes -= removed.reduce((total, frame) => total + (frame.estimatedBytes ?? estimateFrameBytes(frame)), 0);
      this.cursor = Math.max(0, this.cursor - excess);
    }
    while (this.estimatedBytes > this.maxBytes && this.frames.length > 1) {
      const lastIndex = this.frames.length - 1;
      const candidate = this.frames.findIndex((frame, index) => index > 0 && index !== this.cursor && index !== lastIndex);
      if (candidate < 0) break;
      const [removed] = this.frames.splice(candidate, 1);
      this.estimatedBytes -= removed.estimatedBytes ?? estimateFrameBytes(removed);
      if (candidate < this.cursor) this.cursor -= 1;
    }
    this.estimatedBytes = Math.max(0, this.estimatedBytes);
  }

  recalculateMemory() {
    this.estimatedBytes = this.frames.reduce((total, frame) => total + (frame.estimatedBytes ?? estimateFrameBytes(frame)), 0);
    return this.estimatedBytes;
  }
}
