const FALLBACK_FRAME_MS = 16;

function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(callback);
  return globalThis.setTimeout(() => callback(performance.now()), FALLBACK_FRAME_MS);
}

function defaultCancelFrame(handle) {
  if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
}

function mergeLanes(current, next) {
  const incoming = typeof next === "string" ? { [next]: true } : next ?? {};
  return {
    canvas: Boolean(current?.canvas || incoming.canvas),
    coordinates: Boolean(current?.coordinates || incoming.coordinates),
    simulation: Boolean(current?.simulation || incoming.simulation),
    full: Boolean(current?.full || incoming.full)
  };
}

export function createRenderScheduler({ onFrame, requestFrame = defaultRequestFrame, cancelFrame = defaultCancelFrame } = {}) {
  let pending = null;
  let handle = null;
  let scheduled = 0;
  let completed = 0;

  const flush = () => {
    if (!pending) return false;
    const lanes = pending;
    pending = null;
    if (handle !== null) {
      cancelFrame(handle);
      handle = null;
    }
    completed += 1;
    onFrame?.(lanes);
    return true;
  };

  const request = (lanes = { canvas: true }) => {
    pending = mergeLanes(pending, lanes);
    if (handle !== null) return;
    scheduled += 1;
    handle = requestFrame(() => {
      handle = null;
      flush();
    });
  };

  const cancel = () => {
    pending = null;
    if (handle !== null) {
      cancelFrame(handle);
      handle = null;
    }
  };

  return {
    request,
    flush,
    cancel,
    get pending() { return pending; },
    get stats() { return { scheduled, completed, pending: Boolean(pending) }; }
  };
}

function diagnosticsEnabled() {
  return Boolean(globalThis.__DLS_PERF__ === true || globalThis.location?.search?.includes("perf=1"));
}

export function createPerformanceDiagnostics({ enabled = diagnosticsEnabled() } = {}) {
  const samples = new Map();
  const counters = new Map();

  function measure(name, callback) {
    if (!enabled) return callback();
    const start = performance.now();
    try {
      return callback();
    } finally {
      const duration = performance.now() - start;
      const entry = samples.get(name) ?? { count: 0, total: 0, worst: 0 };
      entry.count += 1;
      entry.total += duration;
      entry.worst = Math.max(entry.worst, duration);
      samples.set(name, entry);
    }
  }

  function count(name, amount = 1) {
    if (!enabled) return;
    counters.set(name, (counters.get(name) ?? 0) + amount);
  }

  function snapshot(extra = {}) {
    return {
      enabled,
      samples: Object.fromEntries([...samples].map(([name, entry]) => [name, {
        ...entry,
        average: entry.count ? entry.total / entry.count : 0
      }])),
      counters: Object.fromEntries(counters),
      ...extra
    };
  }

  return { enabled, measure, count, snapshot };
}
