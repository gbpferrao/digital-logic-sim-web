export const SIMULATION_TRACE_VERSION = 1;
export const DEFAULT_TRACE_MAX_EVENTS = 2048;
export const DEFAULT_TRACE_MAX_BYTES = 4 * 1024 * 1024;
export const DEFAULT_TRACE_CHANGE_LIMIT = 64;

function copySignal(value) {
  return value == null ? null : { bits: Number(value.bits) || 0, tri: Number(value.tri) || 0 };
}

function copyValue(value) {
  if (value == null || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value.slice(0, 32);
  return copySignal(value);
}

function signalEqual(left, right) {
  return left?.bits === right?.bits && left?.tri === right?.tri;
}

function snapshotEntries(snapshot) {
  const entries = new Map();
  for (const [scope, scoped] of Object.entries(snapshot?.scopes ?? {})) {
    for (const [endpoint, value] of Object.entries(scoped?.endpoints ?? {})) {
      entries.set(`${scope}|endpoint|${endpoint}`, { kind: "endpoint", scope, endpoint, value: copySignal(value) });
    }
    for (const [instance, item] of Object.entries(scoped?.instances ?? {})) {
      for (const [pin, value] of Object.entries(item?.signals ?? {})) {
        entries.set(`${scope}|signal|${instance}|${pin}`, { kind: "signal", scope, instance, pin, value: copySignal(value) });
      }
      if (item?.internal?.display !== undefined) {
        entries.set(`${scope}|display|${instance}`, { kind: "display", scope, instance, value: copyValue(item.internal.display) });
      }
    }
  }
  if (!entries.size) {
    for (const [endpoint, value] of Object.entries(snapshot?.endpoints ?? {})) {
      entries.set(`root|endpoint|${endpoint}`, { kind: "endpoint", scope: "root", endpoint, value: copySignal(value) });
    }
  }
  return entries;
}

export function summarizeSnapshotChanges(before, after, { maxChanges = DEFAULT_TRACE_CHANGE_LIMIT } = {}) {
  const previous = snapshotEntries(before);
  const next = snapshotEntries(after);
  const keys = [...new Set([...previous.keys(), ...next.keys()])].sort();
  const changes = [];
  const scopes = new Set();
  let changedCount = 0;
  for (const key of keys) {
    const left = previous.get(key);
    const right = next.get(key);
    const same = left?.kind === right?.kind && left?.kind === "display"
      ? JSON.stringify(left.value) === JSON.stringify(right.value)
      : signalEqual(left?.value, right?.value);
    if (same) continue;
    changedCount += 1;
    const entry = right ?? left;
    scopes.add(entry.scope);
    if (changes.length < Math.max(0, Number(maxChanges) || 0)) {
      changes.push({
        kind: entry.kind,
        scope: entry.scope,
        endpoint: entry.endpoint,
        instance: entry.instance,
        pin: entry.pin,
        before: copyValue(left?.value),
        after: copyValue(right?.value)
      });
    }
  }
  return {
    changedCount,
    changedScopes: [...scopes].sort(),
    changes,
    truncated: changedCount > changes.length
  };
}

function estimateEventBytes(event) {
  return 32 + JSON.stringify(event).length * 2;
}

function normalizeEvent(event, sequence) {
  return {
    version: SIMULATION_TRACE_VERSION,
    sequence,
    kind: String(event?.kind || "engine-tick"),
    source: String(event?.source || "simulation"),
    cause: String(event?.cause || "tick"),
    step: Math.max(0, Number(event?.step) || 0),
    visible: Boolean(event?.visible),
    changedCount: Math.max(0, Number(event?.changedCount) || 0),
    changedScopes: Array.isArray(event?.changedScopes) ? event.changedScopes.map(String).slice(0, 32) : [],
    changes: Array.isArray(event?.changes) ? event.changes.slice(0, DEFAULT_TRACE_CHANGE_LIMIT) : [],
    truncated: Boolean(event?.truncated),
    propagations: Math.max(0, Number(event?.propagations) || 0),
    signalChanges: Math.max(0, Number(event?.signalChanges) || 0),
    settlePasses: Math.max(0, Number(event?.settlePasses) || 0),
    settleLimitHits: Math.max(0, Number(event?.settleLimitHits) || 0),
    evaluations: Math.max(0, Number(event?.evaluations) || 0),
    maxDepth: Math.max(0, Number(event?.maxDepth) || 0)
  };
}

export class SimulationTrace {
  constructor({ maxEvents = DEFAULT_TRACE_MAX_EVENTS, maxBytes = DEFAULT_TRACE_MAX_BYTES } = {}) {
    this.maxEvents = Math.max(1, Number(maxEvents) || DEFAULT_TRACE_MAX_EVENTS);
    this.maxBytes = Math.max(256, Number(maxBytes) || DEFAULT_TRACE_MAX_BYTES);
    this.events = [];
    this.estimatedBytes = 0;
    this.sequence = 0;
    this.totalEvents = 0;
    this.truncated = false;
  }

  get length() {
    return this.events.length;
  }

  get memoryBytes() {
    return this.estimatedBytes;
  }

  clear() {
    this.events = [];
    this.estimatedBytes = 0;
    this.sequence = 0;
    this.totalEvents = 0;
    this.truncated = false;
  }

  record(event) {
    const next = normalizeEvent(event, this.sequence++);
    const bytes = estimateEventBytes(next);
    this.events.push(next);
    this.estimatedBytes += bytes;
    this.totalEvents += 1;
    while (this.events.length > this.maxEvents || this.estimatedBytes > this.maxBytes) {
      const removed = this.events.shift();
      if (!removed) break;
      this.estimatedBytes -= estimateEventBytes(removed);
      this.truncated = true;
    }
    this.estimatedBytes = Math.max(0, this.estimatedBytes);
    return next;
  }

  truncateAfterStep(step) {
    const limit = Math.max(0, Number(step) || 0);
    const kept = this.events.filter((event) => event.step <= limit);
    if (kept.length === this.events.length) return;
    this.events = kept;
    this.estimatedBytes = this.events.reduce((total, event) => total + estimateEventBytes(event), 0);
  }
}
