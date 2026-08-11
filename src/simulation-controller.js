import { descriptorForInstance } from "./model.js";
import { PIN_MASK } from "./simulation.js";
import { DEFAULT_BAKE_MAX_INTERACTIONS, SimulationBake, createTimelineFrame } from "./simulation-timeline.js";
import { SimulationPreview } from "./simulation-preview.js";
import { summarizeSnapshotChanges } from "./simulation-trace.js";

const identityMeasure = (_label, action) => action();
const noop = () => {};
export const DEFAULT_BAKE_MAX_TICKS = 4096;

/**
 * Coordinates the browser-facing simulation lifecycle.
 *
 * Simulator owns execution, SimulationBake owns recorded history, and this
 * controller owns the user-intent transitions between them. DOM rendering
 * remains outside this module and is supplied through small callbacks.
 */
export function createSimulationController({
  getProject,
  getSimulator,
  getState,
  setStatus,
  render,
  scheduleCanvasRender = noop,
  playAudio = noop,
  touch = noop,
  measure = identityMeasure
} = {}) {
  if (typeof getProject !== "function" || typeof getSimulator !== "function" || typeof getState !== "function") {
    throw new TypeError("Simulation controller needs project, simulator, and state accessors.");
  }
  if (typeof setStatus !== "function" || typeof render !== "function") {
    throw new TypeError("Simulation controller needs status and render callbacks.");
  }

  const state = getState();
  if (!state?.bake) throw new TypeError("Simulation controller needs a SimulationBake in state.");
  let pendingInteractions = [];

  function project() { return getProject(); }
  function simulator() { return getSimulator(); }

  function stabilityWindow() {
    const period = Math.max(1, Math.round(Number(project().settings.stepsPerClock) || 8));
    return Math.max(4, Math.min(64, period * 2));
  }

  function clearPreview() {
    if (!state.preview) return false;
    state.preview.dispose();
    state.preview = null;
    return true;
  }

  function previewStabilityWindow() {
    return Math.max(3, Math.min(8, stabilityWindow()));
  }

  let signatureContext = null;

  function getSignatureContext(currentProject) {
    if (signatureContext
      && signatureContext.root === currentProject.root
      && signatureContext.customChips === currentProject.customChips
      && signatureContext.revision === currentProject._revision) return signatureContext;
    const instances = currentProject.root.instances ?? [];
    const connectedEndpointCache = new WeakMap();
    const descriptionForScope = (scope) => {
      const parts = String(scope ?? "").split("/").filter(Boolean);
      if (parts.shift() !== "root") return null;
      let description = currentProject.root;
      for (const instanceId of parts) {
        const instance = (description?.instances ?? []).find((item) => String(item.id) === instanceId);
        description = instance ? descriptorForInstance(currentProject, instance) : null;
        if (!description) return null;
      }
      return description;
    };
    const connectedEndpointsFor = (description) => {
      if (!description || typeof description !== "object") return null;
      if (connectedEndpointCache.has(description)) return connectedEndpointCache.get(description);
      const endpoints = new Set();
      for (const wire of description.wires ?? []) {
        for (const endpoint of [wire.source, wire.target]) {
          const owner = String(endpoint?.owner ?? "").trim();
          const pin = String(endpoint?.pin ?? "").trim();
          if (owner && pin) endpoints.add(`${owner}:${pin}`);
        }
      }
      connectedEndpointCache.set(description, endpoints);
      return endpoints;
    };
    signatureContext = {
      root: currentProject.root,
      customChips: currentProject.customChips,
      revision: currentProject._revision,
      rootOwners: new Set(["root", ...instances.map((instance) => String(instance.id))]),
      descriptionForScope,
      connectedEndpointsFor,
      specialInstances: instances.map((instance) => {
        const descriptor = descriptorForInstance(currentProject, instance);
        return descriptor?.special
          ? { id: String(instance.id), fallbackDisplay: instance.internalData?.display }
          : null;
      }).filter(Boolean)
    };
    return signatureContext;
  }

  function visualSignature(snapshot) {
    const currentProject = project();
    const context = getSignatureContext(currentProject);
    const signals = [];
    const scopes = snapshot?.scopes ?? {};
    for (const scope of Object.keys(scopes)) {
      const connectedEndpoints = context.connectedEndpointsFor(context.descriptionForScope(scope));
      for (const key of Object.keys(scopes[scope]?.endpoints ?? {})) {
        if (connectedEndpoints && !connectedEndpoints.has(key)) continue;
        const value = scopes[scope].endpoints[key];
        if ((value?.tri ?? PIN_MASK) !== PIN_MASK) signals.push([`${scope}:${key}`, value.bits ?? 0, value.tri ?? PIN_MASK]);
      }
    }
    if (!signals.length) {
      const connectedEndpoints = context.connectedEndpointsFor(currentProject.root);
      for (const key of Object.keys(snapshot?.endpoints ?? {})) {
        if (!context.rootOwners.has(key.split(":", 1)[0])) continue;
        const localKey = key.startsWith("root:") ? key.slice("root:".length) : key;
        if (connectedEndpoints && !connectedEndpoints.has(localKey)) continue;
        const value = snapshot.endpoints[key];
        if ((value?.tri ?? PIN_MASK) !== PIN_MASK) signals.push([key, value.bits ?? 0, value.tri ?? PIN_MASK]);
      }
    }
    signals.sort(([left], [right]) => left.localeCompare(right));

    const displays = [];
    for (const scope of Object.keys(scopes)) {
      for (const id of Object.keys(scopes[scope]?.instances ?? {})) {
        const display = scopes[scope].instances[id]?.internal?.display;
        if (display !== undefined) displays.push([`${scope}:${id}`, display]);
      }
    }
    if (!displays.length) {
      for (const { id, fallbackDisplay } of context.specialInstances) {
        const runtime = snapshot?.instances?.[id];
        const display = runtime?.internal?.display ?? fallbackDisplay;
        if (display !== undefined) displays.push([id, display]);
      }
    }
    return JSON.stringify({ signals, displays });
  }

  function simulationFrame(snapshot = simulator().snapshot, metadata = {}) {
    return createTimelineFrame({
      step: simulator().stepCount,
      snapshot,
      signature: measure("simulation.signature", () => visualSignature(snapshot)),
      ...metadata
    });
  }

  function beginBake(source = "simulation") {
    clearPreview();
    const currentProject = project();
    const currentSimulator = simulator();
    currentSimulator.syncProject(currentProject);
    currentSimulator.reset();
    const frame = simulationFrame(undefined, { cause: "initial", source: "bake" });
    state.bake.begin(frame, { stabilityWindow: stabilityWindow() });
    for (const interaction of pendingInteractions) state.bake.recordInteraction(interaction);
    pendingInteractions = [];
    state.bake.recordInteraction({ kind: "bake-start", source, step: currentSimulator.stepCount });
    state.stepCount = currentSimulator.stepCount;
    currentProject._simSnapshot = currentSimulator.snapshot;
    return frame;
  }

  function ensureBake(source = "step-control") {
    if (!state.bake.hasBake) beginBake(source);
    state.stepCount = simulator().stepCount;
  }

  function resetBake() {
    clearPreview();
    const currentProject = project();
    const currentSimulator = simulator();
    currentSimulator.syncProject(currentProject);
    currentSimulator.reset();
    const frame = simulationFrame(undefined, { cause: "initial", source: "reset" });
    state.bake.clear();
    if (state.simRunning) {
      state.bake.begin(frame, { stabilityWindow: stabilityWindow() });
      state.bake.recordInteraction({ kind: "bake-start", source: "structural-reset", step: currentSimulator.stepCount });
    }
    pendingInteractions = [];
    state.stepCount = currentSimulator.stepCount;
    currentProject._simSnapshot = currentSimulator.snapshot;
  }

  function clearSimulationTimer() {
    if (state.simTimer === null) return;
    clearTimeout(state.simTimer);
    state.simTimer = null;
  }

  function scheduleSimulationTick(delay = 1000 / Math.max(1, Number(state.speed) || 1)) {
    if (!state.simRunning || state.simTimer !== null) return;
    state.simTimer = setTimeout(() => {
      state.simTimer = null;
      if (!state.simRunning) return;
      const startedAt = globalThis.performance?.now?.() ?? Date.now();
      runStep({ renderFrame: false });
      if (state.simRunning) {
        const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
        const cadence = 1000 / Math.max(1, Number(state.speed) || 1);
        scheduleSimulationTick(Math.max(0, cadence - elapsed));
      }
    }, Math.max(0, delay));
  }

  function resetForProject() {
    clearSimulationTimer();
    state.simRunning = false;
    project().settings.simulationPaused = true;
    resetBake();
  }

  function recordFrame({ beforeSnapshot = null, cause = "tick", source = "simulation", visible = null } = {}) {
    if (!state.bake.isBaking) return null;
    const currentSimulator = simulator();
    const frame = simulationFrame(undefined, { cause, source, visible: true });
    const previous = state.bake.executionFrame;
    const isVisible = visible == null
      ? !previous || frame.signature !== (previous.signature || visualSignature(previous.snapshot))
      : Boolean(visible);
    const summary = summarizeSnapshotChanges(beforeSnapshot, frame.snapshot);
    const trace = state.bake.recordTrace({
      kind: "engine-tick",
      source,
      cause,
      step: frame.step,
      visible: isVisible,
      ...summary,
      ...currentSimulator.diagnostics
    });
    frame.visible = isVisible;
    frame.traceStart = trace.sequence;
    frame.traceEnd = trace.sequence;
    state.bake.record(frame, { visible: isVisible });
    state.stepCount = currentSimulator.stepCount;
    return frame;
  }

  function recordInteraction(event = {}) {
    const next = { ...event, step: event.step == null ? simulator().stepCount : event.step };
    if (state.bake.hasBake) return state.bake.recordInteraction(next);
    pendingInteractions.push(next);
    if (pendingInteractions.length > DEFAULT_BAKE_MAX_INTERACTIONS) {
      pendingInteractions.splice(0, pendingInteractions.length - DEFAULT_BAKE_MAX_INTERACTIONS);
    }
    return next;
  }

  function syncStepCount() {
    state.stepCount = simulator().stepCount;
  }

  function previousVisibleHistoryIndex() {
    const current = state.bake.executionFrame;
    if (!current) return -1;
    const currentSignature = current.signature || visualSignature(current.snapshot);
    return state.bake.previousIndex((frame) => (frame.signature || visualSignature(frame.snapshot)) !== currentSignature);
  }

  function restoreFrame(index, message = null) {
    if (state.simRunning || !state.bake.length) return;
    clearPreview();
    const currentSimulator = simulator();
    const nextIndex = Math.max(0, Math.min(state.bake.length - 1, Number(index) || 0));
    const frame = state.bake.frameAt(nextIndex);
    if (!frame) return;
    measure("simulation.restore", () => currentSimulator.restore(frame.snapshot, frame.step));
    state.bake.setCursor(nextIndex);
    state.stepCount = frame.step;
    project()._simSnapshot = currentSimulator.snapshot;
    const latest = state.bake.latestCheckpoint?.step ?? frame.step;
    setStatus(message || (nextIndex === state.bake.length - 1 ? "Simulation paused." : `Viewing step ${frame.step} of ${latest}.`));
    scheduleCanvasRender({ simulation: true });
  }

  function jumpToStep(value) {
    if (state.simRunning) return;
    if (!state.bake.hasBake) {
      setStatus("No bake is available. Use Bake or Space to create one.");
      render();
      return;
    }
    const requested = Number(value);
    if (!Number.isFinite(requested)) {
      render();
      return;
    }
    let targetIndex = 0;
    let closestDistance = Infinity;
    for (let index = 0; index < state.bake.length; index += 1) {
      const frame = state.bake.frameAt(index);
      const distance = Math.abs(frame.step - Math.round(requested));
      if (distance < closestDistance) {
        closestDistance = distance;
        targetIndex = index;
      }
    }
    const frame = state.bake.frameAt(targetIndex);
    if (frame) restoreFrame(targetIndex, `Step ${frame.step}.`);
  }

  function runStep(options = {}) {
    const renderFrame = !options || typeof options !== "object" || options.renderFrame !== false;
    const playAudioFrame = !options || typeof options !== "object" || options.playAudio !== false;
    const record = !options || typeof options !== "object" || options.recordFrame !== false;
    const source = options?.source || (state.simRunning ? "timer" : "step-control");
    const cause = options?.cause || (state.simRunning ? "timer-tick" : "manual-step");
    clearPreview();
    if (state.bake.isReady && !state.simRunning) {
      setStatus("Bake already complete. Clear or change the flow before baking again.");
      if (renderFrame) render();
      return;
    }
    const currentProject = project();
    const currentSimulator = simulator();
    currentSimulator.syncProject(currentProject);
    ensureBake(source);
    const beforeSnapshot = currentSimulator.snapshot;
    measure("simulator.step", () => currentSimulator.step());
    state.stepCount = currentSimulator.stepCount;
    const frame = record ? recordFrame({ beforeSnapshot, cause, source }) : null;
    if (playAudioFrame) playAudio(currentSimulator.audioNotes);
    currentProject._simSnapshot = currentSimulator.snapshot;
    if (state.simRunning && frame && state.bake.observe(frame.signature)) finishBake("stable");
    else if (state.simRunning && currentSimulator.stepCount >= DEFAULT_BAKE_MAX_TICKS) finishBake("limit");
    if (renderFrame) render();
    else if (state.simRunning) scheduleCanvasRender({ simulation: true });
  }

  function step() {
    if (state.bake.isReady && !state.simRunning) {
      const nextIndex = Math.min(state.bake.length - 1, state.bake.currentIndex + 1);
      if (nextIndex > state.bake.currentIndex) {
        const frame = state.bake.frameAt(nextIndex);
        restoreFrame(nextIndex, `Step ${frame?.step ?? state.stepCount}.`);
      } else {
        setStatus("Already at the latest baked step.");
        render();
      }
      return;
    }
    recordInteraction({ kind: "manual-step", source: "step-control" });
    runStep();
  }

  function macroStep(direction) {
    if (state.simRunning) {
      setStatus("Pause the simulation before using visible-step controls.");
      render();
      return;
    }
    if (!state.bake.hasBake) {
      setStatus("No bake is available. Use Bake or Step to create one.");
      render();
      return;
    }
    const current = state.bake.executionFrame ?? state.bake.currentCheckpoint;
    if (!current) return;
    const baseline = current.signature || visualSignature(current.snapshot);

    if (direction < 0) {
      const previousIndex = previousVisibleHistoryIndex();
      if (previousIndex >= 0) {
        const frame = state.bake.frameAt(previousIndex);
        restoreFrame(previousIndex, `Previous visible step: ${frame.step}.`);
        return;
      }
      const first = state.bake.frameAt(0);
      if (first && current.step > first.step) {
        restoreFrame(0, "Simulation start.");
        return;
      }
      setStatus("Already at the first visible step.");
      render();
      return;
    }

    const nextIndex = state.bake.nextIndex((frame) => (frame.signature || visualSignature(frame.snapshot)) !== baseline);
    if (nextIndex >= 0) {
      const frame = state.bake.frameAt(nextIndex);
      restoreFrame(nextIndex, `Next visible step: ${frame.step}.`);
      return;
    }
    setStatus("No later visible step in this bake.");
    render();
  }

  function finishBake(reason = "manual") {
    if (!state.bake.isBaking) return;
    state.bake.recordInteraction({ kind: "bake-stop", source: "controller", step: simulator().stepCount, reason });
    const isStaticBake = reason === "stable" && state.bake.length <= 1;
    if (isStaticBake) {
      const initial = state.bake.frameAt(0);
      const currentSimulator = simulator();
      if (initial) {
        currentSimulator.restore(initial.snapshot, initial.step);
        state.bake.setCursor(0);
        state.stepCount = initial.step;
        project()._simSnapshot = currentSimulator.snapshot;
      }
    }
    state.bake.finish(isStaticBake ? "static" : reason);
    const message = isStaticBake
      ? "Bake complete at step 0; no visible flow detected."
      : reason === "stable"
        ? "Bake complete at step " + state.stepCount + "; no further visible change detected."
        : reason === "limit"
          ? "Bake reached its safety limit at step " + state.stepCount + "; stop or clear to begin again."
        : "Bake registered at step " + state.stepCount + ".";
    setRunning(false, false, message);
  }

  function clearBake({ preservePending = false } = {}) {
    clearPreview();
    if (!preservePending) pendingInteractions = [];
    const wasRunning = state.simRunning;
    const currentProject = project();
    const currentSimulator = simulator();
    clearSimulationTimer();
    state.simRunning = false;
    currentProject.settings.simulationPaused = true;
    currentSimulator.syncProject(currentProject);
    currentSimulator.reset();
    state.bake.clear();
    state.stepCount = currentSimulator.stepCount;
    currentProject._simSnapshot = currentSimulator.snapshot;
    if (wasRunning) touch("Bake cleared.", false, false);
    else setStatus("Bake cleared.");
    render();
  }

  function startBake(markDirty = false) {
    if (state.bake.isReady) {
      setStatus("Bake already complete. Clear or change the flow before baking again.");
      render();
      return;
    }
    if (!state.bake.hasBake) beginBake("bake-button");
    else state.bake.recordInteraction({ kind: "bake-start", source: "bake-button", step: simulator().stepCount });
    setRunning(true, markDirty, "Simulation baking.");
  }

  function setRunning(running, markDirty = false, statusMessage = null) {
    const currentProject = project();
    if (running) clearPreview();
    if (running && !state.bake.hasBake) beginBake("bake-button");
    const settingChanged = currentProject.settings.simulationPaused === running;
    state.simRunning = running;
    currentProject.settings.simulationPaused = !running;
    clearSimulationTimer();
    state.simTimer = null;
    if (running) scheduleSimulationTick();
    if (markDirty && settingChanged) touch("Simulation state updated.", false);
    setStatus(statusMessage || (running ? "Simulation baking." : "Simulation paused."));
    render();
  }

  function startCausalPreview(message, source = null, interaction = null) {
    const currentProject = project();
    const currentSimulator = simulator();
    const previewSimulator = state.preview?.simulator ?? currentSimulator;
    const sourceSnapshot = source?.snapshot ?? previewSimulator.snapshot;
    const sourceStep = source?.step ?? previewSimulator.stepCount;
    clearBake({ preservePending: true });
    if (interaction) recordInteraction({ ...interaction, step: interaction.step ?? sourceStep });
    const preview = new SimulationPreview({
      project: currentProject,
      simulator: currentSimulator,
      sourceSnapshot,
      sourceStep,
      signature: (snapshot) => visualSignature(snapshot),
      stabilityWindow: previewStabilityWindow(),
      stepDelay: Math.max(90, Math.min(220, 1000 / Math.max(1, state.speed))),
      onUpdate: (current) => {
        if (state.preview !== current) return;
        scheduleCanvasRender({ simulation: true });
      },
      onFinish: (current) => {
        if (state.preview !== current) return;
        setStatus(current.reason === "limit"
          ? "Ghost preview reached its limit; bake or step to record it."
          : "Ghost preview complete; bake or step to record it.");
        render();
      }
    });
    state.preview = preview;
    setStatus(`Ghost preview: ${message}; bake cleared.`);
    preview.start();
    render();
  }

  return {
    clearPreview,
    startCausalPreview,
    resetBake,
    resetForProject,
    runStep,
    step,
    macroStep,
    jumpToStep,
    finishBake,
    clearBake,
    startBake,
    setRunning,
    recordInteraction,
    restoreFrame,
    previousVisibleHistoryIndex,
    syncStepCount
  };
}

export function createSimulationBake() {
  return new SimulationBake();
}
