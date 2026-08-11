import appPackage from "../package.json";
import "./styles.css";
import {
  BUILTINS,
  GRID,
  TYPE,
  annotationPalette,
  annotationBoundingBox,
  chipBoundingBox,
  clone,
  createProject,
  customFromRoot,
  collectionGroupsFor,
  descriptorForInstance,
  getDescription,
  getInputPin,
  getOutputPin,
  getPin,
  interfaceBindingsFor,
  interfaceDirectionForInstance,
  isInterfaceNode,
  instanceFor,
  isBusOrigin,
  isBusTerminus,
  isInputType,
  isOutputType,
  normalizeProject,
  refreshInterfacePorts,
  refreshReusableFit,
  uid
} from "./model.js";
import { Simulator, disconnected, isHigh, stateLabel } from "./simulation.js";
import { WorldRenderer } from "./renderer.js";
import { STATIC_MODE, downloadProject, loadFromBrowser, loadFromServer, readProjectFile, saveToBrowser, saveToServer } from "./storage.js";
import { $, actionLabel, escapeHtml, icon, inspectorAction, refreshIcons } from "./ui/dom-icons.js";
import { createLibraryController } from "./ui/library-controller.js";
import { createNotificationCenter } from "./ui/notifications.js";
import { createPointerSession, hasPointerMoved } from "./ui/pointer-session.js";
import { createPerformanceDiagnostics, createRenderScheduler } from "./ui/performance.js";
import { createHoverTooltipController } from "./ui/hover-tooltip.js";
import { createSimulationBake, createSimulationController } from "./simulation-controller.js";

const APP_METADATA = Object.freeze({
  name: "Digital Logic Simulator",
  version: appPackage.version,
  projectSchema: "digital-logic-sim-web/1",
  chipSchema: "digital-logic-sim-web/chip/1",
  storage: STATIC_MODE ? "Static site + browser cache; import/export JSON" : "Local JSON API + browser cache fallback"
});

const canvas = $("#world");
const renderer = new WorldRenderer(canvas);
const notifications = createNotificationCenter({ root: $("#notifications"), refreshIcons });
const performanceDiagnostics = createPerformanceDiagnostics();
const renderScheduler = createRenderScheduler({ onFrame: (lanes) => renderScheduled(lanes) });
const hoverTooltipLayer = createHoverTooltipController({ element: $("#canvas-hover-tooltip"), container: canvas.parentElement });
let cachedCanvasRect = null;
let hoverResolveFrame = null;
let pendingHoverResolution = null;

function contextIcon(action) {
  return {
    "set-pin-colour": "palette",
    "edit-annotation": "pencil",
    "delete-annotation": "trash-2",
    "open-custom": "arrow-up-right",
    "toggle-input": "toggle-right",
    "flip-bus": "repeat-2",
    "edit-key": "key-round",
    "edit-rom": "database",
    "edit-pulse": "timer",
    "edit-label": "tag",
    "rotate-cw": "rotate-cw",
    "rotate-ccw": "rotate-ccw",
    "duplicate": "copy",
    "delete": "trash-2",
    "edit-wire": "route",
    "delete-wire": "trash-2"
  }[action] || "circle-dot";
}

window.addEventListener("load", refreshIcons, { once: true });
const PIN_COLOURS = [
  ["red", "Red", "#f47883"], ["orange", "Orange", "#f3a45f"], ["yellow", "Yellow", "#f3d36b"],
  ["green", "Green", "#7df2a8"], ["blue", "Blue", "#76aee6"], ["violet", "Violet", "#b795ff"],
  ["pink", "Pink", "#f29ac7"], ["white", "White", "#e7edf7"]
];

const cachedProject = loadFromBrowser();
let project = cachedProject ?? createProject();
project._revision = 0;
let simulator = new Simulator(project);
let audioContext = null;
const state = {
  tool: "select",
  xray: false,
  placement: null,
  annotationPlacement: null,
  selectedIds: new Set(),
  selectedAnnotationIds: new Set(),
  selectedWirePointKeys: new Set(),
  selectedWireId: null,
  wireStart: null,
  wirePoints: [],
  wireTarget: null,
  wireTargetValid: null,
  mouseWorld: { x: 0, y: 0 },
  drag: null,
  annotationDrag: null,
  annotationResize: null,
  wirePointDrag: null,
  wireEdit: null,
  selectionBox: null,
  chipDrag: null,
  lastChipDragAt: 0,
  annotationToolDrag: null,
  lastAnnotationToolDragAt: 0,
  collectionDragName: null,
  lastCollectionDragAt: 0,
  hover: null,
  hoverTooltip: null,
  mouseScreen: { x: 0, y: 0 },
  hoverPointerActive: false,
  pan: null,
  zoomDrag: null,
  simRunning: false,
  simTimer: null,
  preview: null,
  stepCount: 0,
  speed: Math.max(1, Math.min(30, Math.round(Number(project.settings.stepsPerSecond) || 8))),
  bake: createSimulationBake(),
  undo: [],
  redo: [],
  status: "Ready.",
  savePending: false,
  saveQueued: false,
  projectNameBeforeEdit: null,
  projectNameRevisionBeforeEdit: null,
  projectNameUpdatedAtBeforeEdit: null,
  inspectorSelectionKey: null,
  viewStack: [],
  viewCameras: {},
  projectSaved: Boolean(cachedProject),
  savedRevision: cachedProject ? 0 : -1,
  suppressContextMenu: false,
  pointerSession: null,
  pendingInputToggle: null,
  pointer: { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }
};

let libraryController = null;
let simulationController = null;

function renderLibrary() { libraryController?.renderLibrary(); }
function closeCollectionPopup() { libraryController?.closeCollectionPopup(); }
function toggleCollectionPopup(name, anchor = null) { libraryController?.toggleCollectionPopup(name, anchor); }
function updateChipDragPreview(event) { libraryController?.updateChipDragPreview(event); }
function finishChipDrag(event, cancelled = false) { libraryController?.finishChipDrag(event, cancelled); }

function formatZoomReadout(zoom) {
  const percentage = Math.max(0, Number(zoom) || 0) * 100;
  if (percentage >= 10) return `${Math.round(percentage)}%`;
  if (percentage >= 1) return `${percentage.toFixed(1)}%`;
  return `${percentage.toFixed(2)}%`;
}

const GRID_STEP = 10;

function isMultiMode(input = state.pointer) {
  return Boolean(input?.altKey || input?.shiftKey);
}

function wirePointKey(wireId, index) {
  return `${String(wireId)}:${index}`;
}

function selectedWirePointIndexes(wireId) {
  const prefix = `${String(wireId)}:`;
  return [...state.selectedWirePointKeys]
    .filter((key) => key.startsWith(prefix))
    .map((key) => Number(key.slice(prefix.length)))
    .filter((index) => Number.isInteger(index));
}

function shouldSnap(input = state.pointer) {
  return (project.settings.snapping !== false && project.settings.grid !== false) || input?.ctrlKey || input?.metaKey;
}

function forceStraight(point, reference, input = state.pointer) {
  if (!(project.settings.straightWires === true || input?.shiftKey)) return { ...point };
  const offset = { x: point.x - reference.x, y: point.y - reference.y };
  return Math.abs(offset.x) >= Math.abs(offset.y) ? { x: point.x, y: reference.y } : { x: reference.x, y: point.y };
}

function updatePointerModifiers(input) {
  state.pointer = {
    altKey: Boolean(input?.altKey),
    shiftKey: Boolean(input?.shiftKey),
    ctrlKey: Boolean(input?.ctrlKey),
    metaKey: Boolean(input?.metaKey)
  };
}

function beginCanvasPointer(event, kind, details = {}) {
  if (state.pointerSession) return false;
  state.pointerSession = createPointerSession({
    pointerId: event.pointerId,
    kind,
    originScreen: canvasPoint(event),
    originWorld: details.originWorld ?? state.mouseWorld,
    target: details.target ?? null,
    additive: details.additive ?? false
  });
  try { canvas.setPointerCapture?.(event.pointerId); } catch {}
  return true;
}

function releaseCanvasPointer(pointerId = state.pointerSession?.pointerId) {
  if (pointerId == null) return;
  const ownsSession = state.pointerSession?.pointerId === pointerId;
  if (ownsSession) state.pointerSession = null;
  try {
    if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
  } catch {}
}

function ownsCanvasPointer(event) {
  return !state.pointerSession || state.pointerSession.pointerId === event.pointerId;
}

function cancelPendingInputToggle() {
  if (!state.pendingInputToggle) return;
  clearTimeout(state.pendingInputToggle.timer);
  state.pendingInputToggle = null;
}

function scheduleInputToggle(instance) {
  cancelPendingInputToggle();
  const id = String(instance.id);
  const timer = setTimeout(() => {
    state.pendingInputToggle = null;
    const current = project.root.instances.find((item) => String(item.id) === id);
    if (current && isInputType(current.name)) toggleInput(current);
  }, 350);
  state.pendingInputToggle = { id, timer };
}

function setTool(tool, message = null) {
  state.tool = tool;
  $("#select-tool").classList.toggle("active", tool === "select");
  $("#wire-tool").classList.toggle("active", tool === "wire");
  $("#add-note").classList.toggle("active", tool === "annotation" && state.annotationPlacement?.type === "text");
  $("#add-label").classList.toggle("active", tool === "annotation" && state.annotationPlacement?.type === "label");
  if (message) setStatus(message);
}

function beginAnnotationToolDrag(event) {
  if (event.button !== 0) return;
  const button = event.target.closest("[data-annotation-tool]");
  if (!button) return;
  state.annotationToolDrag = {
    pointerId: event.pointerId,
    type: button.dataset.annotationTool === "label" ? "label" : "text",
    button,
    startX: event.clientX,
    startY: event.clientY,
    moved: false
  };
  button.setPointerCapture?.(event.pointerId);
}

function clearAnnotationToolDrag() {
  const drag = state.annotationToolDrag;
  if (!drag) return;
  state.lastAnnotationToolDragAt = performance.now();
  try { drag.button.releasePointerCapture?.(drag.pointerId); } catch {}
  drag.button.classList.remove("dragging");
  state.annotationToolDrag = null;
}

function updateAnnotationToolDrag(event) {
  const drag = state.annotationToolDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.moved) {
    if (distance < 6) return;
    drag.moved = true;
    const activeDrag = drag;
    state.annotationToolDrag = null;
    beginAnnotationPlacement(activeDrag.type);
    state.annotationToolDrag = activeDrag;
    activeDrag.button.classList.add("dragging");
  }
  event.preventDefault();
  const screen = canvasPoint(event);
  state.mouseWorld = renderer.toWorld(screen.x, screen.y);
  updateAnnotationPlacementPreview(state.mouseWorld);
  scheduleCanvasRender();
}

function finishAnnotationToolDrag(event, cancelled = false) {
  const drag = state.annotationToolDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  state.annotationToolDrag = null;
  try { drag.button.releasePointerCapture?.(event.pointerId); } catch {}
  drag.button.classList.remove("dragging");
  if (!drag.moved) return;
  state.lastAnnotationToolDragAt = performance.now();
  event.preventDefault();
  if (cancelled || !state.annotationPlacement) {
    if (state.annotationPlacement) cancelTransientInteraction();
    return;
  }
  const rect = getCanvasRect();
  const insideCanvas = event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!insideCanvas) {
    cancelTransientInteraction();
    return;
  }
  const screen = canvasPoint(event);
  state.mouseWorld = renderer.toWorld(screen.x, screen.y);
  placeAnnotationAt(state.mouseWorld);
}

function handleAnnotationToolClick(event) {
  const button = event.target.closest("[data-annotation-tool]");
  if (!button) return;
  if (performance.now() - state.lastAnnotationToolDragAt < 300) {
    state.lastAnnotationToolDragAt = 0;
    event.preventDefault();
    return;
  }
  beginAnnotationPlacement(button.dataset.annotationTool === "label" ? "label" : "text");
}

function isKeyboardInteractionBlocked() {
  return $("#app").classList.contains("library-open")
    || !$("#bottom-menu-popup").classList.contains("hidden")
    || !$("#collection-popup").classList.contains("hidden")
    || !$("#help-modal").classList.contains("hidden");
}

function isCanvasInteractionBlocked() {
  return !$("#help-modal").classList.contains("hidden");
}

function viewKey() {
  return project.root?.name || "Main";
}

function rememberCamera() {
  state.viewCameras[viewKey()] = { ...renderer.camera };
}

function restoreCamera(key, fit = true) {
  const camera = state.viewCameras[key];
  if (camera) renderer.camera = { ...camera };
  else if (fit) renderer.fit(project);
}

function resetCamera() {
  delete state.viewCameras[viewKey()];
  renderer.fit(project);
  setStatus("Camera reset.");
  render();
}

function boxesOverlap(a, b, padding = 0) {
  return a.x < b.x + b.w + padding && a.x + a.w > b.x - padding && a.y < b.y + b.h + padding && a.y + a.h > b.y - padding;
}

function duplicatePlacementDelta(world, input = state.pointer) {
  const rawDelta = { x: world.x - state.placement.startPointer.x, y: world.y - state.placement.startPointer.y };
  let delta = rawDelta;
  if (input?.shiftKey) {
    if (!state.placement.straightAxis && Math.hypot(delta.x, delta.y) > 1) state.placement.straightAxis = Math.abs(delta.x) >= Math.abs(delta.y) ? "x" : "y";
    if (state.placement.straightAxis === "x") delta = { x: delta.x, y: 0 };
    if (state.placement.straightAxis === "y") delta = { x: 0, y: delta.y };
  } else {
    state.placement.straightAxis = null;
  }
  return delta;
}

function placementItemsAt(world, input = state.pointer) {
  if (!state.placement) return [];
  if (state.placement.mode === "duplicate") {
    const delta = duplicatePlacementDelta(world, input);
    return state.placement.items.map((item) => ({ ...clone(item), position: snap({ x: item.position.x + delta.x, y: item.position.y + delta.y }, input) }));
  }

  const position = snap(world);
  const first = makeInstance(state.placement.name, position);
  first.rotation = state.placement.rotation ?? 0;
  const items = [first];
  if (isBusOrigin(state.placement.name)) {
    const terminusName = state.placement.name === TYPE.BUS_1 ? TYPE.BUS_END_1 : state.placement.name === TYPE.BUS_4 ? TYPE.BUS_END_4 : TYPE.BUS_END_8;
    const terminus = makeInstance(terminusName, { x: position.x + GRID * 8, y: position.y });
    terminus.rotation = first.rotation;
    first.linkedBusPairId = terminus.id;
    terminus.linkedBusPairId = first.id;
    items.push(terminus);
  }
  return items;
}

function placementValidity(items) {
  const excluded = new Set(state.placement?.sourceIds ?? []);
  const obstacles = (project.root.instances ?? []).filter((obstacle) => !excluded.has(String(obstacle.id)));
  for (const item of items) {
    const itemBox = chipBoundingBox(project, item);
    if (obstacles.some((obstacle) => boxesOverlap(itemBox, chipBoundingBox(project, obstacle), 1))) return { valid: false, message: "Cannot place here: the element overlaps another element." };
  }
  for (let index = 0; index < items.length; index += 1) {
    for (let other = index + 1; other < items.length; other += 1) {
      if (boxesOverlap(chipBoundingBox(project, items[index]), chipBoundingBox(project, items[other]), 1)) return { valid: false, message: "Cannot place here: linked elements overlap." };
    }
  }
  return { valid: true, message: "" };
}

function updatePlacementPreview(world = state.mouseWorld, input = state.pointer) {
  if (!state.placement) return;
  state.placement.previewItems = placementItemsAt(world, input);
  state.placement.validity = placementValidity(state.placement.previewItems);
  if (state.placement.mode === "duplicate") {
    const delta = duplicatePlacementDelta(world, input);
    state.placement.previewWires = state.placement.wires.map((wire) => ({
      ...clone(wire),
      points: (wire.points ?? []).map((point) => snap({ x: point.x + delta.x, y: point.y + delta.y }, input))
    }));
    state.placement.previewJunctions = (state.placement.junctions ?? []).map((junction) => ({
      ...clone(junction),
      position: snap({ x: junction.position.x + delta.x, y: junction.position.y + delta.y }, input)
    }));
  }
}

function touch(message = null, structural = true, resetSimulation = true) {
  if (state.viewStack.length && project.root?.kind === TYPE.CUSTOM) refreshInterfacePorts(project, project.root);
  if (structural) {
    project._revision += 1;
    if (resetSimulation) simulationController?.resetBake();
  }
  project.updatedAt = new Date().toISOString();
  if (message) setStatus(message);
}

function recordHistory() {
  const snapshot = clone(project);
  delete snapshot._revision;
  state.undo.push(snapshot);
  if (state.undo.length > 60) state.undo.shift();
  state.redo.length = 0;
}

function mutate(message, action) {
  recordHistory();
  action();
  touch(message);
  render();
}

function setStatus(message) {
  state.status = message;
  $("#status-message").textContent = message;
}

function notify(message, error = false) {
  return notifications.notify(message, { tone: error ? "error" : "info" });
}

// Simulation lifecycle is a feature boundary; the shell supplies state and UI callbacks.
simulationController = createSimulationController({
  getProject: () => project,
  getSimulator: () => simulator,
  getState: () => state,
  setStatus,
  render,
  scheduleCanvasRender,
  playAudio: (notes) => playAudio(notes),
  touch,
  measure: (label, action) => performanceDiagnostics.measure(label, action)
});

function isCompositeInterfaceInstance(instance) {
  if (!state.viewStack.length || !isInterfaceNode(instance)) return false;
  const direction = interfaceDirectionForInstance(instance);
  return interfaceBindingsFor(project.root, direction).some((binding) => String(binding.instanceId) === String(instance.id));
}

function interfaceNodeIsReferenced(instance) {
  if (!isCompositeInterfaceInstance(instance) || !instance.interfaceId) return false;
  const customName = state.viewStack.at(-1)?.customName;
  if (!customName) return false;
  const descriptions = [project.root, ...state.viewStack.map((frame) => frame.root), ...Object.values(project.customChips ?? {})];
  return descriptions.some((description) => (description.instances ?? [])
    .filter((candidate) => String(candidate.name) === String(customName))
    .some((parent) => (description.wires ?? []).some((wire) =>
      (String(wire.source.owner) === String(parent.id) && String(wire.source.pin) === String(instance.interfaceId))
      || (String(wire.target.owner) === String(parent.id) && String(wire.target.pin) === String(instance.interfaceId)))));
}

function makeInstance(name, position) {
  const descriptor = getDescription(project, name);
  if (!descriptor) throw new Error(`Unknown chip: ${name}`);
  if (BUILTINS[name]) return instanceFor(name, position);
  return { id: uid("element"), name, position: { ...position }, rotation: 0, label: "", internalData: {}, linkedBusPairId: null, outputPinColours: {} };
}

function pinEndpointInfo(endpoint) {
  const owner = String(endpoint.owner);
  if (owner === "wire") {
    const wire = project.root.wires.find((item) => String(item.id) === String(endpoint.pin));
    const source = wire && pinEndpointInfo(wire.source);
    if (!wire || !source) return null;
    return { instance: null, description: project.root, pin: { id: String(wire.id), bits: Number(endpoint.bits) || source.pin.bits || 1 }, direction: "output" };
  }
  if (owner === "junction") {
    const junction = (project.root.junctions ?? []).find((item) => String(item.id) === String(endpoint.pin));
    if (!junction) return null;
    return { instance: null, description: project.root, pin: { id: String(junction.id), bits: Number(endpoint.bits) || junction.bits || 1 }, direction: endpoint.direction || "output" };
  }
  if (owner === "root") {
    const pin = [...(project.root.inputPins ?? []), ...(project.root.outputPins ?? [])].find((item) => String(item.id) === String(endpoint.pin));
    if (!pin) return null;
    // Inside a custom chip, its external input is a local source and its
    // external output is a local target.
    return { instance: null, description: project.root, pin, direction: pin.direction === "input" ? "output" : "input" };
  }
  const instance = project.root.instances.find((item) => String(item.id) === owner);
  const description = instance && descriptorForInstance(project, instance);
  const pin = description && getPin(description, endpoint.pin);
  return instance && description && pin ? { instance, description, pin, direction: pin.direction } : null;
}

function canConnect(first, second) {
  const a = pinEndpointInfo(first);
  const b = pinEndpointInfo(second);
  if (!a || !b) return { ok: false, message: "This pin cannot be connected." };
  if (first.owner === second.owner && String(first.pin) === String(second.pin)) return { ok: false, message: "A pin cannot connect to itself." };
  if (String(first.owner) === "wire" && String(second.owner) === "wire") return { ok: false, message: "A wire cannot connect directly to another wire." };
  if (first.owner === second.owner && !["root", "junction"].includes(String(first.owner))) return { ok: false, message: "A chip cannot connect directly to itself." };
  if (a.pin.bits !== b.pin.bits) return { ok: false, message: `Bit width mismatch: ${a.pin.bits} bits and ${b.pin.bits} bits.` };
  if (a.direction === b.direction) return { ok: false, message: "Connect an output pin to an input pin." };
  const source = a.direction === "output" ? first : second;
  const target = a.direction === "input" ? first : second;
  const duplicate = project.root.wires.some((wire) => wire.source.owner === source.owner && wire.source.pin === source.pin && wire.target.owner === target.owner && wire.target.pin === target.pin);
  if (duplicate) return { ok: false, message: "That connection already exists." };
  const aIsBus = a.instance && (isBusOrigin(a.instance.name) || isBusTerminus(a.instance.name));
  const bIsBus = b.instance && (isBusOrigin(b.instance.name) || isBusTerminus(b.instance.name));
  if (aIsBus && bIsBus && String(a.instance.linkedBusPairId) !== String(b.instance.id) && String(b.instance.linkedBusPairId) !== String(a.instance.id)) {
    return { ok: false, message: "Bus origin and terminus must be connected to their linked pair." };
  }
  return { ok: true, source, target };
}

function serializableEndpoint(endpoint) {
  const result = { owner: String(endpoint.owner), pin: String(endpoint.pin) };
  if (endpoint.junction) Object.assign(result, { junction: true, direction: endpoint.direction, bits: endpoint.bits });
  return result;
}

function snap(point, input = state.pointer) {
  if (!shouldSnap(input)) return { ...point };
  return { x: Math.round(point.x / GRID_STEP) * GRID_STEP, y: Math.round(point.y / GRID_STEP) * GRID_STEP };
}

function beginAnnotationPlacement(type = "text") {
  if (state.annotationPlacement || state.placement || state.drag || state.annotationDrag || state.annotationResize || state.wireStart || state.wireEdit || state.selectionBox) cancelTransientInteraction();
  const width = type === "label" ? 180 : 280;
  const height = type === "label" ? 22 : 110;
  state.annotationPlacement = { type, width, height, position: { ...state.mouseWorld } };
  setTool("annotation");
  state.selectedIds.clear();
  state.selectedAnnotationIds.clear();
  state.selectedWirePointKeys.clear();
  state.selectedWireId = null;
  state.wireStart = null;
  state.wireTarget = null;
  state.wireTargetValid = null;
  $("#app").classList.remove("library-open", "inspector-open");
  closeBottomMenu();
  closeCollectionPopup();
  canvas.parentElement.classList.remove("selecting");
  updateAnnotationPlacementPreview(state.mouseWorld);
  setStatus(`Placing ${type === "label" ? "a label" : "a note"}.`);
  render();
}

function updateAnnotationPlacementPreview(world = state.mouseWorld) {
  if (!state.annotationPlacement) return;
  const { width, height } = state.annotationPlacement;
  const position = snap({ x: world.x - width / 2, y: world.y - height / 2 });
  state.annotationPlacement.position = position;
}

function placeAnnotationAt(world) {
  if (!state.annotationPlacement) return;
  updateAnnotationPlacementPreview(world);
  const placement = state.annotationPlacement;
  const type = placement.type;
  const palette = annotationPalette(type === "label" ? "#f3d36b" : "#d7eaff");
  const annotation = {
    id: uid("annotation"),
    type,
    text: type === "label" ? "Label" : "Explain this part...",
    position: { ...placement.position },
    width: placement.width,
    height: placement.height,
    fontSize: 11,
    colour: palette.colour,
    background: palette.background
  };
  mutate(`${type === "label" ? "Label" : "Note"} added.`, () => { project.root.annotations ??= []; project.root.annotations.push(annotation); });
  state.annotationPlacement = null;
  setTool("select");
  state.selectedIds.clear();
  state.selectedAnnotationIds = new Set([String(annotation.id)]);
  state.selectedWirePointKeys.clear();
  state.selectedWireId = null;
  canvas.parentElement.classList.add("selecting");
  $("#app").classList.add("inspector-open");
  render();
  requestAnimationFrame(() => {
    const editor = document.querySelector('#inspector [data-field="annotation-text"]');
    editor?.focus();
    editor?.select();
  });
}

function beginPlacement(name) {
  const description = getDescription(project, name);
  if (!description) return;
  if (state.annotationPlacement || state.drag || state.annotationDrag || state.annotationResize || state.wireStart || state.wireEdit || state.selectionBox) cancelTransientInteraction();
  state.placement = { mode: "new", name, description, rotation: 0, previewItems: [], validity: { valid: true, message: "" } };
  setTool("place");
  state.selectedIds.clear();
  state.selectedAnnotationIds.clear();
  state.selectedWirePointKeys.clear();
  state.selectedWireId = null;
  state.wireStart = null;
  state.wireTarget = null;
  state.wireTargetValid = null;
  canvas.parentElement.classList.remove("selecting");
  updatePlacementPreview(state.mouseWorld);
  setStatus(`Placing ${name}.`);
  render();
}

function cancelPlacement() {
  if (state.placement?.mode === "duplicate") {
    state.placement = null;
    setTool("select");
    canvas.parentElement.classList.add("selecting");
    setStatus("Duplication cancelled.");
    render();
    return;
  }
  state.placement = null;
  state.wireStart = null;
  state.wirePoints = [];
  state.wireTarget = null;
  state.wireTargetValid = null;
  setTool("select");
  canvas.parentElement.classList.add("selecting");
  setStatus("Placement cancelled.");
  render();
}

function placeAt(world) {
  if (!state.placement) return;
  updatePlacementPreview(world);
  if (!state.placement.validity.valid) {
    setStatus(state.placement.validity.message);
    notify(state.placement.validity.message, true);
    return;
  }

  const placement = state.placement;
  const additions = placement.previewItems.map((item) => clone(item));
  const pairWire = placement.mode === "new" && additions.length === 2 && isBusOrigin(additions[0].name)
    ? { id: uid("bus-wire"), source: { owner: additions[0].id, pin: "1" }, target: { owner: additions[1].id, pin: "0" }, points: [] }
    : null;
  mutate(`${placement.mode === "duplicate" ? "Elements duplicated." : `${placement.name} placed.`}`, () => {
    project.root.instances.push(...additions);
    if (pairWire) project.root.wires.push(pairWire);
    if (placement.mode === "duplicate") {
      project.root.junctions ??= [];
      project.root.junctions.push(...(placement.previewJunctions ?? []).map((junction) => clone(junction)));
      project.root.wires.push(...(placement.previewWires ?? []).map((wire) => clone(wire)));
    }
  });
  state.placement = null;
  setTool("select");
  canvas.parentElement.classList.add("selecting");
  state.selectedIds = new Set(additions.map((item) => String(item.id)));
  state.selectedWirePointKeys.clear();
  if (isMultiMode()) {
    beginDuplicatePlacement(additions);
  }
  render();
}

function selectInstance(instance, additive = false) {
  if (!additive) { state.selectedIds.clear(); state.selectedAnnotationIds.clear(); }
  else if (state.selectedAnnotationIds.size) state.selectedAnnotationIds.clear();
  if (instance) {
    const id = String(instance.id);
    if (additive && state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
  }
  state.selectedWirePointKeys.clear();
  state.selectedWireId = null;
  render();
}

function selectWire(wire) {
  state.selectedIds.clear();
  state.selectedAnnotationIds.clear();
  state.selectedWirePointKeys.clear();
  state.selectedWireId = wire ? wire.id : null;
  render();
}

function selectAnnotation(annotation, additive = false) {
  if (!additive) { state.selectedIds.clear(); state.selectedAnnotationIds.clear(); }
  else if (state.selectedIds.size) state.selectedIds.clear();
  if (annotation) {
    const id = String(annotation.id);
    if (additive && state.selectedAnnotationIds.has(id)) state.selectedAnnotationIds.delete(id);
    else state.selectedAnnotationIds.add(id);
  }
  state.selectedWirePointKeys.clear();
  state.selectedWireId = null;
  render();
}

function clearSelection(message = null) {
  state.selectedIds.clear();
  state.selectedAnnotationIds.clear();
  state.selectedWirePointKeys.clear();
  state.selectedWireId = null;
  if (message) setStatus(message);
  render();
}

function startWire(endpoint) {
  if (state.wireEdit) exitWireEdit();
  setTool("wire");
  state.wireStart = { ...endpoint, owner: String(endpoint.owner), pin: String(endpoint.pin) };
  state.wirePoints = [];
  state.wireTarget = null;
  state.wireTargetValid = null;
  setStatus(endpoint.wireConnection ? "Wire branch started." : "Wire started.");
  render();
}

function completeWire(endpoint) {
  if (state.wireStart?.wireConnection) {
    completeWireFromWire(endpoint);
    return;
  }
  const result = canConnect(state.wireStart, endpoint);
  if (!result.ok) {
    setStatus(result.message);
    notify(result.message, true);
    return;
  }
  mutate("Wire connected.", () => {
    project.root.wires.push({ id: uid("wire"), source: serializableEndpoint(result.source), target: serializableEndpoint(result.target), points: clone(state.wirePoints) });
  });
  finishWirePlacement();
}

function wireSplitAt(wire, world) {
  if (!wire) return null;
  const existing = renderer.closestWireSegment(project, wire, world);
  const point = snap(existing.point);
  const bits = pinEndpointInfo(wire.source)?.pin?.bits ?? 1;
  const junction = { id: uid("junction"), position: point, bits };
  const inserted = [...(wire.points ?? [])];
  inserted.splice(existing.index, 0, point);
  const oldTarget = clone(wire.target);
  const rightWire = {
    id: uid("wire"),
    source: { owner: "junction", pin: junction.id, junction: true, direction: "output", bits },
    target: oldTarget,
    points: inserted.slice(existing.index + 1)
  };
  return {
    junction,
    rightWire,
    leftPoints: inserted.slice(0, existing.index),
    junctionEndpoint: { owner: "junction", pin: junction.id, junction: true, direction: "output", bits, position: point }
  };
}

function applyWireSplit(wire, split) {
  project.root.junctions ??= [];
  project.root.junctions.push(split.junction);
  wire.target = { owner: "junction", pin: split.junction.id, junction: true, direction: "input", bits: split.junction.bits };
  wire.points = split.leftPoints;
  project.root.wires.push(split.rightWire);
}

function wireEndpointAt(wire, world) {
  const split = wireSplitAt(wire, world);
  if (!split) return null;
  return { owner: "wire", pin: String(wire.id), wireConnection: true, direction: "output", bits: split.junction.bits, position: split.junction.position };
}

function wireTargetAt(world) {
  const hit = canvasHitTarget(world);
  if (hit.kind === "pin") return { endpoint: hit.value, wire: null };
  if (hit.kind === "junction") return { endpoint: { ...hit.value, direction: "input" }, wire: null };
  if (hit.kind === "wire") return { endpoint: wireEndpointAt(hit.value, world), wire: hit.value };
  return { endpoint: null, wire: null };
}

function finishWirePlacement() {
  state.wireStart = null;
  state.wirePoints = [];
  state.wireTarget = null;
  state.wireTargetValid = null;
  setTool("select");
  render();
}

function completeWireFromWire(endpoint) {
  const sourceWire = project.root.wires.find((wire) => String(wire.id) === String(state.wireStart.pin));
  if (!sourceWire) {
    setStatus("The source wire no longer exists.");
    cancelTransientInteraction();
    return;
  }
  const result = canConnect(state.wireStart, endpoint);
  if (!result.ok) {
    setStatus(result.message);
    notify(result.message, true);
    return;
  }
  const split = wireSplitAt(sourceWire, state.wireStart.position);
  if (!split) return;
  mutate("Wire branch connected.", () => {
    applyWireSplit(sourceWire, split);
    project.root.wires.push({ id: uid("wire"), source: serializableEndpoint(split.junctionEndpoint), target: serializableEndpoint(result.target), points: clone(state.wirePoints) });
  });
  finishWirePlacement();
}

function completeWireToWire(wire, world) {
  if (!state.wireStart || state.wireStart.wireConnection) {
    setStatus("A wire branch cannot connect to another wire.");
    return;
  }
  const endpoint = wireEndpointAt(wire, world);
  if (!endpoint) return;
  const result = canConnect(state.wireStart, endpoint);
  if (!result.ok) {
    setStatus(result.message);
    notify(result.message, true);
    return;
  }
  const split = wireSplitAt(wire, world);
  if (!split) return;
  mutate("Wire branch connected.", () => {
    applyWireSplit(wire, split);
    project.root.wires.push({ id: uid("wire"), source: serializableEndpoint(split.junctionEndpoint), target: serializableEndpoint(result.target), points: clone(state.wirePoints) });
  });
  finishWirePlacement();
}

function cancelCanvasInteractionBeforeEdit() {
  if (state.annotationPlacement || state.placement || state.drag || state.annotationDrag || state.annotationResize || state.wirePointDrag || state.wireStart || state.wireEdit || state.selectionBox || state.pan || state.zoomDrag || state.pointerSession) {
    cancelTransientInteraction();
  }
}

function enterWireEdit(wire) {
  if (!wire) return;
  if (String(state.wireEdit?.wireId) === String(wire.id)) {
    setStatus("Wire edit mode active.");
    render();
    return;
  }
  cancelCanvasInteractionBeforeEdit();
  state.wireStart = null;
  state.wirePoints = [];
  state.wireTarget = null;
  selectWire(wire);
  state.wirePointDrag = null;
  state.selectedWirePointKeys.clear();
  state.wireEdit = { wireId: wire.id, index: -1, before: null, moved: false };
  setStatus("Wire edit mode active.");
  render();
}

function exitWireEdit(restore = false) {
  if (!state.wireEdit) return;
  if (restore && state.wirePointDrag) restoreWirePointDrag();
  state.wirePointDrag = null;
  if (restore && state.wireEdit.before) {
    const wire = project.root.wires.find((item) => item.id === state.wireEdit.wireId);
    const beforeWire = state.wireEdit.before.root?.wires?.find((item) => item.id === state.wireEdit.wireId);
    if (wire && beforeWire) wire.points = clone(beforeWire.points ?? []);
  }
  state.wireEdit = null;
  state.selectedWirePointKeys.clear();
  render();
}

function insertWirePoint(wire, world) {
  const closest = renderer.closestWireSegment(project, wire, world);
  if (closest.index < 0 || closest.index > (wire.points ?? []).length) return;
  const before = clone(project);
  delete before._revision;
  mutate("Wire route point inserted.", () => {
    wire.points.splice(closest.index, 0, snap(closest.point));
  });
  state.wireEdit = { wireId: wire.id, index: -1, before, moved: false };
  state.selectedWirePointKeys.clear();
  state.selectedWirePointKeys.add(wirePointKey(wire.id, closest.index));
  state.selectedWireId = wire.id;
  startWirePointDrag({ wire, index: closest.index }, world);
  render();
}

function startWirePointDrag(point, world) {
  const wire = point?.wire;
  if (!wire || !state.wireEdit) return;
  const key = wirePointKey(wire.id, point.index);
  if (!state.selectedWirePointKeys.has(key)) {
    state.selectedWirePointKeys.clear();
    state.selectedWirePointKeys.add(key);
  }
  const startPoints = new Map(selectedWirePointIndexes(wire.id)
    .map((index) => [index, wire.points?.[index] ? { ...wire.points[index] } : null])
    .filter(([, position]) => position));
  if (!startPoints.size) return;
  const before = clone(project);
  delete before._revision;
  state.wirePointDrag = {
    wireId: String(wire.id),
    world: { ...world },
    startPoints,
    before,
    moved: false,
    straightAxis: null
  };
  state.wireEdit.index = point.index;
  state.wireEdit.before = null;
  state.wireEdit.moved = false;
}

function restoreWirePointDrag() {
  if (!state.wirePointDrag) return;
  const wire = project.root.wires.find((item) => String(item.id) === state.wirePointDrag.wireId);
  if (!wire) return;
  for (const [index, position] of state.wirePointDrag.startPoints) {
    if (wire.points?.[index]) wire.points[index] = { ...position };
  }
}

function applyWirePointDrag(world, event) {
  if (!state.wirePointDrag) return;
  const wire = project.root.wires.find((item) => String(item.id) === state.wirePointDrag.wireId);
  if (!wire) return;
  let delta = { x: world.x - state.wirePointDrag.world.x, y: world.y - state.wirePointDrag.world.y };
  if (state.wirePointDrag.startPoints.size === 1) {
    const [index, start] = state.wirePointDrag.startPoints.entries().next().value;
    const previous = index > 0 ? wire.points?.[index - 1] : renderer.endpointPosition(project, wire.source);
    const constrained = forceStraight({ x: start.x + delta.x, y: start.y + delta.y }, previous ?? start, event);
    delta = { x: constrained.x - start.x, y: constrained.y - start.y };
    state.wirePointDrag.straightAxis = null;
  } else if (event.shiftKey || project.settings.straightWires === true) {
    if (!state.wirePointDrag.straightAxis && Math.hypot(delta.x, delta.y) > 1) state.wirePointDrag.straightAxis = Math.abs(delta.x) >= Math.abs(delta.y) ? "x" : "y";
    if (state.wirePointDrag.straightAxis === "x") delta.y = 0;
    if (state.wirePointDrag.straightAxis === "y") delta.x = 0;
  } else state.wirePointDrag.straightAxis = null;

  const first = state.wirePointDrag.startPoints.values().next().value;
  const snappedFirst = first ? snap({ x: first.x + delta.x, y: first.y + delta.y }, event) : null;
  for (const [index, start] of state.wirePointDrag.startPoints) {
    const relative = first ? { x: start.x - first.x, y: start.y - first.y } : { x: 0, y: 0 };
    if (wire.points?.[index]) {
      wire.points[index] = snappedFirst
        ? snap({ x: snappedFirst.x + relative.x, y: snappedFirst.y + relative.y }, event)
        : snap({ x: start.x + delta.x, y: start.y + delta.y }, event);
    }
  }
  if (Math.hypot(delta.x, delta.y) > 1) state.wirePointDrag.moved = true;
}

function deleteWireEditPoint(index = null) {
  if (!state.wireEdit) return false;
  const wire = project.root.wires.find((item) => item.id === state.wireEdit.wireId);
  if (!wire) return false;
  const requested = Number.isInteger(index)
    ? [index]
    : selectedWirePointIndexes(wire.id).length
      ? selectedWirePointIndexes(wire.id)
      : state.wireEdit.index >= 0 ? [state.wireEdit.index] : [];
  const indexes = [...new Set(requested)].filter((pointIndex) => pointIndex >= 0 && pointIndex < (wire.points ?? []).length).sort((a, b) => b - a);
  if (!indexes.length) return false;
  mutate(`Wire route point${indexes.length === 1 ? "" : "s"} deleted.`, () => {
    for (const pointIndex of indexes) wire.points.splice(pointIndex, 1);
    // Deletion changes the route while wire edit mode is still active. Force
    // the next canvas frame to use the shortened path immediately.
    renderer.invalidateGeometry();
  });
  state.wireEdit = { wireId: wire.id, index: -1, before: null, moved: false };
  state.selectedWirePointKeys.clear();
  updateCanvasHover(state.mouseWorld, state.mouseScreen);
  renderer.invalidateGeometry();
  render();
  return true;
}

function cancelActiveCanvasPointerSession({ renderState = true } = {}) {
  const wasZooming = state.pointerSession?.kind === "zoom";
  const rolledBackDrag = Boolean(state.drag);
  if (state.drag) restoreDrag();
  if (state.annotationDrag) restoreAnnotationDrag();
  if (state.annotationResize) restoreAnnotationResize();
  if (state.wirePointDrag) restoreWirePointDrag();
  state.drag = null;
  state.annotationDrag = null;
  state.annotationResize = null;
  state.wirePointDrag = null;
  state.selectionBox = null;
  state.pan = null;
  state.zoomDrag = null;
  state.wireTarget = null;
  state.wireTargetValid = null;
  if (wasZooming) state.suppressContextMenu = false;
  canvas.parentElement.classList.remove("panning", "selecting");
  releaseCanvasPointer();
  if (rolledBackDrag && state.hoverPointerActive) updateCanvasHover(state.mouseWorld, state.mouseScreen);
  if (renderState) render();
}

function cancelTransientInteraction() {
  clearAnnotationToolDrag();
  cancelPendingInputToggle();
  cancelActiveCanvasPointerSession({ renderState: false });
  state.chipDrag = null;
  if (state.wireEdit) exitWireEdit(true);
  state.placement = null;
  state.annotationPlacement = null;
  state.wireStart = null;
  state.wirePoints = [];
  state.wireTarget = null;
  state.wireTargetValid = null;
  setTool("select");
  canvas.parentElement.classList.remove("panning", "selecting");
  state.selectedIds.clear();
  state.selectedAnnotationIds.clear();
  state.selectedWirePointKeys.clear();
  state.selectedWireId = null;
  setStatus("Interaction cancelled.");
  render();
}

function cleanupJunctions() {
  const used = new Set();
  for (const wire of project.root.wires ?? []) {
    if (String(wire.source.owner) === "junction") used.add(String(wire.source.pin));
    if (String(wire.target.owner) === "junction") used.add(String(wire.target.pin));
  }
  project.root.junctions = (project.root.junctions ?? []).filter((junction) => used.has(String(junction.id)));
}

function deleteSelection() {
  if (state.wireEdit) {
    if (state.selectedWirePointKeys.size) {
      deleteWireEditPoint();
      return;
    }
    if (state.wireEdit.index >= 0) {
      deleteWireEditPoint(state.wireEdit.index);
      return;
    }
    const point = renderer.findWirePoint(project, state.mouseWorld, 10, state.wireEdit.wireId);
    if (point?.wire.id === state.wireEdit.wireId) {
      deleteWireEditPoint(point.index);
      return;
    }
  }
  if (state.selectedWireId) {
    mutate("Wire deleted.", () => { project.root.wires = project.root.wires.filter((wire) => wire.id !== state.selectedWireId); cleanupJunctions(); });
    state.wireEdit = null;
    state.selectedWirePointKeys.clear();
    state.selectedWireId = null;
    render();
    return;
  }
  if (state.selectedAnnotationIds.size) {
    const selected = new Set([...state.selectedAnnotationIds].map(String));
    mutate(`${selected.size} annotation${selected.size === 1 ? "" : "s"} deleted.`, () => {
      project.root.annotations = (project.root.annotations ?? []).filter((annotation) => !selected.has(String(annotation.id)));
    });
    state.selectedAnnotationIds.clear();
    render();
    return;
  }
  if (!state.selectedIds.size && state.hover?.kind === "wire") {
    const hoveredWire = project.root.wires.find((wire) => wire.id === state.hover.id);
    if (hoveredWire) {
      mutate("Wire deleted.", () => { project.root.wires = project.root.wires.filter((wire) => wire.id !== hoveredWire.id); cleanupJunctions(); });
      render();
    }
    return;
  }
  if (!state.selectedIds.size && state.hover?.kind === "annotation") {
    const hovered = project.root.annotations?.find((annotation) => String(annotation.id) === String(state.hover.id));
    if (hovered) {
      mutate("Annotation deleted.", () => { project.root.annotations = (project.root.annotations ?? []).filter((annotation) => String(annotation.id) !== String(hovered.id)); });
      render();
    }
    return;
  }
  if (!state.selectedIds.size) return;
  const selected = new Set([...state.selectedIds].map(String));
  const protectedInterface = project.root.instances.find((item) => selected.has(String(item.id)) && interfaceNodeIsReferenced(item));
  if (protectedInterface) {
    const message = `Cannot delete ${protectedInterface.label || protectedInterface.name}: a parent chip is still connected to this port.`;
    notify(message, true);
    setStatus(message);
    render();
    return;
  }
  for (const item of project.root.instances) if (selected.has(String(item.id)) && item.linkedBusPairId) selected.add(String(item.linkedBusPairId));
  mutate(`${selected.size} element${selected.size === 1 ? "" : "s"} deleted.`, () => {
    project.root.instances = project.root.instances.filter((item) => !selected.has(String(item.id)));
    project.root.wires = project.root.wires.filter((wire) => !selected.has(String(wire.source.owner)) && !selected.has(String(wire.target.owner)));
    cleanupJunctions();
  });
  state.selectedIds.clear();
  render();
}

function rotateSelection(delta = 1) {
  if (!state.selectedIds.size || state.placement || state.drag || state.wireStart || state.wireEdit) return;
  const before = clone(project);
  delete before._revision;
  const selected = project.root.instances.filter((item) => state.selectedIds.has(String(item.id)));
  selected.forEach((item) => { item.rotation = (item.rotation + delta + 4) % 4; });
  const obstacles = project.root.instances.filter((item) => !state.selectedIds.has(String(item.id)));
  const invalid = selected.some((item) => obstacles.some((obstacle) => boxesOverlap(chipBoundingBox(project, item), chipBoundingBox(project, obstacle), 1)));
  if (invalid) {
    project.root.instances.forEach((item) => {
      const old = before.root.instances.find((candidate) => String(candidate.id) === String(item.id));
      if (old) item.rotation = old.rotation;
    });
    setStatus("Rotation cancelled: the rotated element overlaps another element.");
    notify("Rotation cancelled: overlap.", true);
    render();
    return;
  }
  state.undo.push(before);
  state.redo.length = 0;
  touch("Selection rotated.");
  render();
}

function flipBusSelection() {
  const instance = project.root.instances.find((item) => state.selectedIds.has(String(item.id)) && (isBusOrigin(item.name) || isBusTerminus(item.name)));
  if (!instance) return;
  mutate("Bus orientation flipped.", () => {
    instance.internalData ??= {};
    instance.internalData.busFlipped = !instance.internalData.busFlipped;
  });
}

function setPinColour(instanceId, pinId, colour) {
  const instance = project.root.instances.find((item) => String(item.id) === String(instanceId));
  if (!instance || !colour) return;
  mutate("Output pin colour updated.", () => {
    instance.outputPinColours ??= {};
    instance.outputPinColours[String(pinId)] = colour;
  });
}

function duplicateSelection() {
  if (!state.selectedIds.size) return;
  beginDuplicatePlacement();
}

function beginDuplicatePlacement(placedItems = null) {
  const initial = placedItems ?? project.root.instances.filter((item) => state.selectedIds.has(String(item.id)));
  if (!initial.length) return;
  const sourceIds = new Set(initial.map((item) => String(item.id)));
  for (const item of project.root.instances) {
    if (sourceIds.has(String(item.id)) && item.linkedBusPairId) sourceIds.add(String(item.linkedBusPairId));
  }
  const selected = project.root.instances.filter((item) => sourceIds.has(String(item.id)));
  const idMap = new Map();
  const copies = selected.map((item) => {
    const copy = clone(item);
    const oldId = String(copy.id);
    copy.id = uid("element");
    if (isInterfaceNode(copy)) copy.interfaceId = null;
    idMap.set(oldId, String(copy.id));
    return copy;
  });
  copies.forEach((copy) => { if (copy.linkedBusPairId) copy.linkedBusPairId = idMap.get(String(copy.linkedBusPairId)) ?? null; });
  const junctionIds = new Set();
  for (const wire of project.root.wires ?? []) {
    const sourceJunction = String(wire.source.owner) === "junction";
    const targetJunction = String(wire.target.owner) === "junction";
    if (sourceJunction && sourceIds.has(String(wire.target.owner))) junctionIds.add(String(wire.source.pin));
    if (targetJunction && sourceIds.has(String(wire.source.owner))) junctionIds.add(String(wire.target.pin));
  }
  const internalJunctionIds = new Set([...junctionIds].filter((junctionId) => {
    const incident = (project.root.wires ?? []).filter((wire) => String(wire.source.pin) === junctionId && String(wire.source.owner) === "junction" || String(wire.target.pin) === junctionId && String(wire.target.owner) === "junction");
    return incident.length > 0 && incident.every((wire) => {
      const other = String(wire.source.owner) === "junction" ? wire.target.owner : wire.source.owner;
      return sourceIds.has(String(other)) || String(other) === "junction";
    });
  }));
  const junctionIdMap = new Map();
  const junctions = (project.root.junctions ?? []).filter((junction) => internalJunctionIds.has(String(junction.id))).map((junction) => {
    const copy = clone(junction);
    const oldId = String(copy.id);
    copy.id = uid("junction");
    junctionIdMap.set(oldId, String(copy.id));
    return copy;
  });
  const duplicateOwner = (owner) => idMap.get(String(owner)) ?? junctionIdMap.get(String(owner));
  const wires = project.root.wires
    .filter((wire) => duplicateOwner(wire.source.owner) && duplicateOwner(wire.target.owner))
    .map((wire) => ({ ...clone(wire), id: uid("wire"), source: { ...wire.source, owner: duplicateOwner(wire.source.owner), pin: String(wire.source.owner) === "junction" ? junctionIdMap.get(String(wire.source.pin)) : wire.source.pin }, target: { ...wire.target, owner: duplicateOwner(wire.target.owner), pin: String(wire.target.owner) === "junction" ? junctionIdMap.get(String(wire.target.pin)) : wire.target.pin } }));
  let closestPosition = copies[0]?.position ?? state.mouseWorld;
  let closestDistance = Infinity;
  for (const item of selected) {
    const distance = Math.hypot(item.position.x - state.mouseWorld.x, item.position.y - state.mouseWorld.y);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPosition = item.position;
    }
  }
  state.placement = {
    mode: "duplicate",
    items: copies,
    wires,
    junctions,
    sourceIds: [...sourceIds],
    startPointer: { ...closestPosition },
    previewItems: copies.map((item) => clone(item)),
    previewWires: wires.map((wire) => clone(wire)),
    previewJunctions: junctions.map((junction) => clone(junction)),
    straightAxis: null,
    validity: { valid: true, message: "" }
  };
  setTool("place");
  canvas.parentElement.classList.remove("selecting");
  updatePlacementPreview(state.mouseWorld);
  setStatus("Duplicating selection.");
  render();
}

function startDragging(instance, world) {
  const startPositions = new Map([...state.selectedIds].map((id) => {
    const item = project.root.instances.find((candidate) => String(candidate.id) === id);
    return [id, item ? { ...item.position } : null];
  }).filter(([, position]) => position));
  const selected = new Set(startPositions.keys());
  const startWirePoints = new Map();
  for (const wire of project.root.wires ?? []) {
    if (selected.has(String(wire.source.owner)) && selected.has(String(wire.target.owner))) startWirePoints.set(wire.id, clone(wire.points ?? []));
  }
  state.drag = {
    world: { ...world },
    startPositions,
    startWirePoints,
    before: clone(project),
    moved: false,
    invalid: false,
    straightAxis: null
  };
  delete state.drag.before._revision;
}

function restoreDrag() {
  if (!state.drag) return;
  for (const [id, position] of state.drag.startPositions) {
    const item = project.root.instances.find((candidate) => String(candidate.id) === id);
    if (item) item.position = { ...position };
  }
  for (const [wireId, points] of state.drag.startWirePoints) {
    const wire = project.root.wires.find((candidate) => candidate.id === wireId);
    if (wire) wire.points = clone(points);
  }
  // Dragging mutates positions without changing the project revision. The
  // renderer caches geometry by revision, so a rollback must invalidate that
  // cache before the next non-drag render/hit-test can use the committed
  // position again.
  renderer.invalidateGeometry?.();
}

function applyDrag(world, event) {
  if (!state.drag) return;
  let delta = { x: world.x - state.drag.world.x, y: world.y - state.drag.world.y };
  if (event.shiftKey) {
    if (!state.drag.straightAxis && Math.hypot(delta.x, delta.y) > 1) state.drag.straightAxis = Math.abs(delta.x) >= Math.abs(delta.y) ? "x" : "y";
    if (state.drag.straightAxis === "x") delta.y = 0;
    if (state.drag.straightAxis === "y") delta.x = 0;
  } else {
    state.drag.straightAxis = null;
  }

  const first = state.drag.startPositions.values().next().value;
  const snappedFirst = first ? snap({ x: first.x + delta.x, y: first.y + delta.y }, event) : null;
  for (const [id, start] of state.drag.startPositions) {
    const item = project.root.instances.find((candidate) => String(candidate.id) === id);
    if (!item) continue;
    const relative = first ? { x: start.x - first.x, y: start.y - first.y } : { x: 0, y: 0 };
    item.position = snappedFirst ? snap({ x: snappedFirst.x + relative.x, y: snappedFirst.y + relative.y }, event) : snap({ x: start.x + delta.x, y: start.y + delta.y }, event);
  }

  for (const [wireId, points] of state.drag.startWirePoints) {
    const wire = project.root.wires.find((candidate) => candidate.id === wireId);
    if (!wire) continue;
    const source = project.root.instances.find((item) => String(item.id) === String(wire.source.owner));
    const target = project.root.instances.find((item) => String(item.id) === String(wire.target.owner));
    const sourceStart = state.drag.startPositions.get(String(wire.source.owner));
    const targetStart = state.drag.startPositions.get(String(wire.target.owner));
    if (!source || !target || !sourceStart || !targetStart) continue;
    const offset = { x: ((source.position.x - sourceStart.x) + (target.position.x - targetStart.x)) / 2, y: ((source.position.y - sourceStart.y) + (target.position.y - targetStart.y)) / 2 };
    wire.points = points.map((point) => snap({ x: point.x + offset.x, y: point.y + offset.y }, event));
  }

  const selectedItems = project.root.instances.filter((item) => state.drag.startPositions.has(String(item.id)));
  const obstacles = project.root.instances.filter((item) => !state.drag.startPositions.has(String(item.id)));
  state.drag.invalid = selectedItems.some((item) => obstacles.some((obstacle) => boxesOverlap(chipBoundingBox(project, item), chipBoundingBox(project, obstacle), 1)))
    || selectedItems.some((item, index) => selectedItems.slice(index + 1).some((other) => boxesOverlap(chipBoundingBox(project, item), chipBoundingBox(project, other), 1)));
  if (Math.hypot(delta.x, delta.y) > 1) state.drag.moved = true;
}

function startDraggingAnnotation(annotation, world) {
  const startPositions = new Map([...state.selectedAnnotationIds].map((id) => {
    const item = project.root.annotations?.find((candidate) => String(candidate.id) === id);
    return [id, item ? { ...item.position } : null];
  }).filter(([, position]) => position));
  state.annotationDrag = {
    world: { ...world },
    startPositions,
    before: clone(project),
    moved: false,
    straightAxis: null
  };
  delete state.annotationDrag.before._revision;
}

function restoreAnnotationDrag() {
  if (!state.annotationDrag) return;
  for (const [id, position] of state.annotationDrag.startPositions) {
    const annotation = project.root.annotations?.find((candidate) => String(candidate.id) === id);
    if (annotation) annotation.position = { ...position };
  }
}

function applyAnnotationDrag(world, event) {
  if (!state.annotationDrag) return;
  let delta = { x: world.x - state.annotationDrag.world.x, y: world.y - state.annotationDrag.world.y };
  if (event.shiftKey) {
    if (!state.annotationDrag.straightAxis && Math.hypot(delta.x, delta.y) > 1) state.annotationDrag.straightAxis = Math.abs(delta.x) >= Math.abs(delta.y) ? "x" : "y";
    if (state.annotationDrag.straightAxis === "x") delta.y = 0;
    if (state.annotationDrag.straightAxis === "y") delta.x = 0;
  } else state.annotationDrag.straightAxis = null;

  const first = state.annotationDrag.startPositions.values().next().value;
  const snappedFirst = first ? snap({ x: first.x + delta.x, y: first.y + delta.y }, event) : null;
  for (const [id, start] of state.annotationDrag.startPositions) {
    const annotation = project.root.annotations?.find((candidate) => String(candidate.id) === id);
    if (!annotation) continue;
    const relative = first ? { x: start.x - first.x, y: start.y - first.y } : { x: 0, y: 0 };
    annotation.position = snappedFirst
      ? snap({ x: snappedFirst.x + relative.x, y: snappedFirst.y + relative.y }, event)
      : snap({ x: start.x + delta.x, y: start.y + delta.y }, event);
  }
  if (Math.hypot(delta.x, delta.y) > 1) state.annotationDrag.moved = true;
}

function startAnnotationResize(annotation, world) {
  if (!annotation || annotation.type !== "text") return;
  const before = clone(project);
  delete before._revision;
  state.annotationResize = {
    annotationId: String(annotation.id),
    world: { ...world },
    width: Number(annotation.width) || 280,
    height: Number(annotation.height) || 110,
    before,
    moved: false
  };
  state.selectedIds.clear();
  state.selectedAnnotationIds = new Set([String(annotation.id)]);
  state.selectedWirePointKeys.clear();
  state.selectedWireId = null;
}

function restoreAnnotationResize() {
  if (!state.annotationResize) return;
  const annotation = project.root.annotations?.find((item) => String(item.id) === state.annotationResize.annotationId);
  if (!annotation) return;
  const snapshot = state.annotationResize.before?.root?.annotations?.find((item) => String(item.id) === String(annotation.id));
  if (snapshot) {
    annotation.width = snapshot.width;
    annotation.height = snapshot.height;
  }
}

function applyAnnotationResize(world, event) {
  if (!state.annotationResize) return;
  const annotation = project.root.annotations?.find((item) => String(item.id) === state.annotationResize.annotationId);
  if (!annotation) return;
  const delta = { x: world.x - state.annotationResize.world.x, y: world.y - state.annotationResize.world.y };
  const minWidth = annotation.type === "label" ? 40 : 100;
  const minHeight = annotation.type === "label" ? Math.max(18, Number(annotation.fontSize) * 1.8) : 40;
  let width = Math.max(minWidth, Math.min(1000, state.annotationResize.width + delta.x));
  let height = Math.max(minHeight, Math.min(600, state.annotationResize.height + delta.y));
  if (event.shiftKey) {
    const ratio = state.annotationResize.width / Math.max(1, state.annotationResize.height);
    if (Math.abs(delta.x) >= Math.abs(delta.y)) height = Math.max(minHeight, Math.min(600, width / ratio));
    else width = Math.max(minWidth, Math.min(1000, height * ratio));
  }
  annotation.width = Math.round(width);
  annotation.height = Math.round(height);
  if (Math.hypot(delta.x, delta.y) > 1) state.annotationResize.moved = true;
}

function undo() {
  const snapshot = state.undo.pop();
  if (!snapshot) return;
  const current = clone(project); delete current._revision;
  state.redo.push(current);
  project = normalizeProject(snapshot); project._revision += 1;
  simulator.syncProject(project);
  simulationController.resetBake();
  state.selectedIds.clear(); state.selectedAnnotationIds.clear(); state.selectedWirePointKeys.clear(); state.selectedWireId = null;
  setStatus("Undo."); render();
}

function redo() {
  const snapshot = state.redo.pop();
  if (!snapshot) return;
  const current = clone(project); delete current._revision;
  state.undo.push(current);
  project = normalizeProject(snapshot); project._revision += 1;
  simulator.syncProject(project);
  simulationController.resetBake();
  state.selectedIds.clear(); state.selectedAnnotationIds.clear(); state.selectedWirePointKeys.clear(); state.selectedWireId = null;
  setStatus("Redo."); render();
}

function toggleInput(instance) {
  const sourceSimulator = state.preview?.simulator ?? simulator;
  const source = { snapshot: sourceSimulator.snapshot, step: sourceSimulator.stepCount };
  const descriptor = descriptorForInstance(project, instance);
  const bits = descriptor?.outputPins?.[0]?.bits ?? 1;
  const mask = (1 << bits) - 1;
  const before = project.inputValues[instance.id] ?? 0;
  const after = (before ^ 1) & mask;
  project.inputValues[instance.id] = after;
  touch(`Input ${instance.label || instance.name} set to ${project.inputValues[instance.id]}.`, false);
  simulationController.startCausalPreview(
    `input ${instance.label || instance.name} set to ${project.inputValues[instance.id]}`,
    source,
    { kind: "input-change", source: "canvas", target: instance.id, before, after }
  );
}

function createCustomChip() {
  const name = window.prompt("Name for the custom chip:", `CHIP ${Object.keys(project.customChips).length + 1}`)?.trim();
  if (!name) return;
  if (BUILTINS[name] || project.customChips[name]) { notify("A chip with that name already exists.", true); return; }
  if (!project.root.instances.length) { notify("Place at least one chip before saving a custom chip.", true); return; }
  mutate(`${name} added to the library.`, () => {
    project.customChips[name] = customFromRoot(project, name);
  });
  notify(`${name} is now available in the library.`);
  renderLibrary();
  void saveCurrentProject({ quiet: true });
}

function resetProject() {
  if (!confirmDiscardChanges("Create a new project?")) return;
  project = createProject(); project._revision = 0; simulator = new Simulator(project);
  state.projectSaved = false;
  resetEditorStateForProject();
  renderer.fit(project);
  setStatus("New project created.");
  render();
}

function focusInstanceEditor(description) {
  const field = description?.special === "key"
    ? "key"
    : description?.special === "rom"
      ? "rom"
      : description?.special === "pulse"
        ? "duration"
        : "label";
  const editor = document.querySelector(`#inspector [data-field="${field}"]`);
  editor?.focus();
  editor?.select?.();
}

function enterInstanceEdit(instance) {
  const description = instance && descriptorForInstance(project, instance);
  if (!instance || !description) return;
  openInstanceInspector(instance);
}

function enterCustomView(instance) {
  const description = descriptorForInstance(project, instance);
  if (!description || description.kind !== "custom") return;
  if (!confirmDiscardChanges("Open this chip?")) return;
  rememberCamera();
  state.viewStack.push({ root: project.root, name: project.name, customName: instance.name, parentViewKey: viewKey() });
 project.root = description;
 project.name = `${description.name} internals`;
 simulator.syncProject(project);
  simulationController.resetBake();
  state.selectedIds.clear(); state.selectedAnnotationIds.clear(); state.selectedWirePointKeys.clear(); state.selectedWireId = null; state.wireStart = null;
  state.wireEdit = null;
  state.wirePointDrag = null;
  $("#app").classList.remove("library-open", "inspector-open");
  restoreCamera(viewKey());
  setStatus(`Editing ${description.name}.`);
  render();
}

function exitCustomView() {
  const frame = state.viewStack.pop();
  if (!frame) return;
  if (!confirmDiscardChanges("Leave this chip?")) {
    state.viewStack.push(frame);
    return;
  }
  rememberCamera();
  refreshInterfacePorts(project, project.root);
  project.customChips[frame.customName] = refreshReusableFit(project, project.root);
 project.root = frame.root;
 project.name = frame.name;
 simulator.syncProject(project);
  simulationController.resetBake();
  state.selectedIds.clear(); state.selectedAnnotationIds.clear(); state.selectedWirePointKeys.clear(); state.selectedWireId = null; state.wireStart = null;
  restoreCamera(frame.parentViewKey || viewKey());
  setStatus(`Returned to ${frame.name}.`);
  render();
}

function playAudio(notes) {
  if (!notes?.length || !audioContext) return;
  const now = audioContext.currentTime;
  for (const note of notes.slice(0, 4)) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const frequency = Math.max(55, Math.min(2200, 55 * 2 ** ((Number(note.pitch) - 24) / 12)));
    const volume = Math.max(0, Math.min(0.08, (Number(note.volume) / 15) * 0.08));
    oscillator.type = "square"; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, now); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    oscillator.connect(gain).connect(audioContext.destination); oscillator.start(now); oscillator.stop(now + 0.13);
  }
}

function updateSimulationSpeed(value) {
  const next = Math.max(1, Math.min(30, Math.round(Number(value) || state.speed)));
  $("#sim-speed").value = String(next);
  if (next === state.speed) return;
  state.speed = next;
  project.settings.stepsPerSecond = next;
  touch("Simulation speed updated.", false);
  if (state.simRunning) simulationController.setRunning(true);
  else render();
}

function updateName(value) {
  const nextName = String(value ?? "").trim() || "Untitled project";
  if (nextName === project.name) {
    if (document.activeElement !== $("#project-name")) $("#project-name").value = project.name;
    return;
  }
  project.name = nextName;
  touch("Project name updated.", true, false);
  render();
}

function beginProjectNameEdit() {
  if (state.projectNameBeforeEdit == null) {
    state.projectNameBeforeEdit = project.name;
    state.projectNameRevisionBeforeEdit = project._revision;
    state.projectNameUpdatedAtBeforeEdit = project.updatedAt;
  }
}

function commitProjectNameEdit() {
  const input = $("#project-name");
  const nextName = input.value;
  state.projectNameBeforeEdit = null;
  state.projectNameRevisionBeforeEdit = null;
  state.projectNameUpdatedAtBeforeEdit = null;
  input.blur();
  updateName(nextName);
}

function commitProjectNameEditIfOutside(event) {
  const input = $("#project-name");
  if (document.activeElement === input && !input.contains(event.target)) commitProjectNameEdit();
}

function cancelProjectNameEdit() {
  const input = $("#project-name");
  const previousName = state.projectNameBeforeEdit;
  const previousRevision = state.projectNameRevisionBeforeEdit;
  if (previousName != null) {
    project.name = previousName;
    if (Number.isInteger(previousRevision)) project._revision = previousRevision;
    if (state.projectNameUpdatedAtBeforeEdit) project.updatedAt = state.projectNameUpdatedAtBeforeEdit;
  }
  input.value = previousName ?? project.name;
  state.projectNameBeforeEdit = null;
  state.projectNameRevisionBeforeEdit = null;
  state.projectNameUpdatedAtBeforeEdit = null;
  input.blur();
  render();
}

function confirmDiscardChanges(action) {
  return project._revision === state.savedRevision || window.confirm(`${action} Unsaved changes will be replaced.`);
}

function saveTargetForNewProject() {
  const answer = window.prompt("Save this new circuit as a project or a chip? Enter PROJECT or CHIP.", "project");
  if (answer == null) return null;
  const target = answer.trim().toLowerCase();
  if (["project", "p"].includes(target)) return "project";
  if (["chip", "c"].includes(target)) return "chip";
  notify("Choose PROJECT or CHIP to save.", true);
  return null;
}

function refreshActiveCustomFits() {
  if (!state.viewStack.length) return;
  refreshInterfacePorts(project, project.root);
  refreshReusableFit(project, project.root);
  for (const frame of [...state.viewStack].reverse()) {
    if (frame.root?.kind === TYPE.CUSTOM) {
      refreshInterfacePorts(project, frame.root);
      refreshReusableFit(project, frame.root);
    }
  }
}

async function saveCurrentProject({ quiet = false, promptIfNeeded = !quiet } = {}) {
  if (!state.projectSaved && promptIfNeeded) {
    const target = saveTargetForNewProject();
    if (target === "chip") { createCustomChip(); return; }
    if (target !== "project") return;
  }
  if (state.savePending) {
    state.saveQueued = true;
    return;
  }
  refreshActiveCustomFits();
  const revisionAtStart = project._revision;
  state.savePending = true;
  setStatus("Saving project and custom chips...");
  render();
  try {
    const saved = await saveToServer(project);
    project.storageId = saved.storageId || project.storageId;
    project.updatedAt = saved.updatedAt || project.updatedAt;
    state.projectSaved = true;
    saveToBrowser(project);
    if (project._revision === revisionAtStart) state.savedRevision = revisionAtStart;
    if (!quiet) notify(STATIC_MODE ? "Saved in this browser. Export JSON to share." : "Project and custom chips saved to storage.");
    setStatus(STATIC_MODE ? "Saved to browser cache; export JSON to share." : "Saved to local JSON storage.");
  } catch (error) {
    saveToBrowser(project);
    state.projectSaved = true;
    if (project._revision === revisionAtStart) state.savedRevision = revisionAtStart;
    if (!quiet) notify("Storage server unavailable; saved to browser cache.", true);
    setStatus("Saved to browser cache; server will be used when available.");
  } finally {
    state.savePending = false;
    render();
    if (state.saveQueued) {
      state.saveQueued = false;
      void saveCurrentProject({ quiet: true });
    }
  }
}

function saveAsProject() {
  void saveCurrentProject({ promptIfNeeded: false });
}

function toggleGrid() {
  project.settings.grid = project.settings.grid === false;
  touch(`Grid ${project.settings.grid ? "enabled" : "hidden"}.`);
  render();
}

function toggleXray() {
  state.xray = !state.xray;
  if (state.xray) updateCanvasHover(state.mouseWorld, state.mouseScreen);
  else {
    state.hoverTooltip = null;
    hoverTooltipLayer.hide();
  }
  setStatus(`X-ray ${state.xray ? "enabled" : "disabled"}.`);
  render();
}

function resetEditorStateForProject() {
  simulationController.resetForProject();
  cancelPendingInputToggle();
  cancelActiveCanvasPointerSession({ renderState: false });
  state.speed = Math.max(1, Math.min(30, Math.round(Number(project.settings.stepsPerSecond) || 8)));
  $("#sim-speed").value = String(state.speed);
  state.viewStack.length = 0;
  state.viewCameras = {};
  state.xray = false;
  state.selectedIds.clear();
  state.selectedAnnotationIds.clear();
  state.selectedWirePointKeys.clear();
  state.selectedWireId = null;
  state.wireStart = null;
  state.wirePoints = [];
  state.wireTarget = null;
  state.wireTargetValid = null;
  state.placement = null;
  state.annotationPlacement = null;
  state.drag = null;
  state.annotationDrag = null;
  state.annotationResize = null;
  state.wirePointDrag = null;
  state.selectionBox = null;
  state.chipDrag = null;
  state.lastChipDragAt = 0;
  state.collectionDragName = null;
  state.pan = null;
  state.wireEdit = null;
  state.zoomDrag = null;
  state.hover = null;
  state.hoverTooltip = null;
  state.mouseScreen = { x: 0, y: 0 };
  state.hoverPointerActive = false;
  cancelPendingHoverResolution();
  hoverTooltipLayer.hide();
  state.undo.length = 0;
  state.redo.length = 0;
  state.savedRevision = state.projectSaved ? 0 : -1;
  state.projectNameBeforeEdit = null;
  state.projectNameRevisionBeforeEdit = null;
  state.projectNameUpdatedAtBeforeEdit = null;
  $("#app").classList.remove("library-open", "inspector-open");
  closeBottomMenu();
  closeCollectionPopup();
  closeHelp();
  setTool("select");
  canvas.parentElement.classList.remove("panning", "selecting");
}

function positionContextMenu(menu, anchor, openAbove = false) {
  const margin = 8;
  menu.classList.remove("hidden");
  const menuBox = menu.getBoundingClientRect();
  const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - menuBox.width - margin));
  const spaceBelow = window.innerHeight - anchor.top - margin;
  const shouldOpenAbove = openAbove || menuBox.height > spaceBelow;
  const preferredTop = shouldOpenAbove ? anchor.top - menuBox.height - margin : anchor.top;
  const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - menuBox.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function currentInspectorSelectionKey() {
  const rootId = String(project.root?.id ?? viewKey());
  if (state.selectedWireId) return `${rootId}:wire:${String(state.selectedWireId)}`;
  if (state.selectedAnnotationIds.size === 1) return `${rootId}:annotation:${[...state.selectedAnnotationIds][0]}`;
  if (state.selectedIds.size === 1) return `${rootId}:instance:${[...state.selectedIds][0]}`;
  if (state.selectedIds.size > 1) return `${rootId}:instances:${[...state.selectedIds].sort().join(",")}`;
  if (state.selectedAnnotationIds.size > 1) return `${rootId}:annotations:${[...state.selectedAnnotationIds].sort().join(",")}`;
  return `${rootId}:empty`;
}

function preserveFocusedInspectorEditor(selectionKey) {
  const active = document.activeElement;
  return state.inspectorSelectionKey === selectionKey
    && active
    && active.matches("input, textarea")
    && $("#inspector").contains(active);
}

function renderInspector() {
  const root = $("#inspector");
  const selectionKey = currentInspectorSelectionKey();
  $("#selection-count").textContent = String(state.selectedIds.size + state.selectedAnnotationIds.size + (state.selectedWireId ? 1 : 0) + state.selectedWirePointKeys.size);
  if (preserveFocusedInspectorEditor(selectionKey)) return;
  state.inspectorSelectionKey = selectionKey;
  if (state.selectedWireId) {
    const wire = project.root.wires.find((item) => item.id === state.selectedWireId);
    root.innerHTML = `<div class="selected-card"><div class="selected-title"><span class="chip-swatch" style="background:#a1a7ab"></span><div><strong>Wire</strong><div class="selected-kind">signal connection</div></div></div><div class="inspector-row"><span>source</span><span class="inspector-value">${wire?.source.owner}:${wire?.source.pin}</span></div><div class="inspector-row"><span>target</span><span class="inspector-value">${wire?.target.owner}:${wire?.target.pin}</span></div><div class="inspector-actions" aria-label="Wire actions">${inspectorAction("delete-wire", "trash-2", "DEL", "Delete wire")}</div></div>`;
    return;
  }
  if (state.selectedAnnotationIds.size) {
    if (state.selectedAnnotationIds.size !== 1) {
      root.innerHTML = `<div class="empty-inspector">${state.selectedAnnotationIds.size} annotations selected.</div>`;
      return;
    }
    const id = [...state.selectedAnnotationIds][0];
    const annotation = project.root.annotations?.find((item) => String(item.id) === id);
    if (!annotation) return;
    const box = annotationBoundingBox(annotation);
    const palette = annotationPalette(annotation.colour);
    root.innerHTML = `<div class="selected-card"><div class="selected-title"><span class="chip-swatch" style="background:${palette.colour}"></span><div><strong>${annotation.type === "label" ? "Label" : "Note"}</strong><div class="selected-kind">canvas annotation</div></div></div><div class="inspector-row"><span>type</span><select class="inspector-input" data-field="annotation-type"><option value="text"${annotation.type === "text" ? " selected" : ""}>note</option><option value="label"${annotation.type === "label" ? " selected" : ""}>label</option></select></div><div class="inspector-row"><span>colour</span><input class="inspector-input annotation-colour-input" type="color" data-field="annotation-colour" value="${palette.colour}" title="Set annotation colour" /></div><label class="annotation-editor-label">content<textarea class="inspector-input annotation-textarea" data-field="annotation-text" rows="6">${escapeHtml(annotation.text)}</textarea></label><div class="inspector-row"><span>position</span><span class="inspector-value">${Math.round(box.x)}, ${Math.round(box.y)}</span></div><div class="inspector-row"><span>width</span><input class="inspector-input" type="number" min="40" max="1000" data-field="annotation-width" value="${Math.round(annotation.width)}" /></div><div class="inspector-row"><span>height</span><input class="inspector-input" type="number" min="22" max="600" data-field="annotation-height" value="${Math.round(annotation.height)}" /></div><div class="inspector-row"><span>font size</span><input class="inspector-input" type="number" min="8" max="32" data-field="annotation-font-size" value="${Math.round(annotation.fontSize)}" /></div><div class="inspector-actions" aria-label="Annotation actions">${inspectorAction("delete-annotation", "trash-2", "DEL", `Delete ${annotation.type === "label" ? "label" : "note"}`)}</div></div>`;
    return;
  }
  if (state.selectedIds.size !== 1) {
    root.innerHTML = state.selectedIds.size > 1
      ? `<div class="empty-inspector">${state.selectedIds.size} elements selected.</div>`
      : state.viewStack.length
        ? `<div class="empty-inspector">Chip interface nodes.</div><button class="inspector-control" data-action="add-root-input">${actionLabel("plus", "Add input node")}<span>IN</span></button><button class="inspector-control" data-action="add-root-output">${actionLabel("plus", "Add output node")}<span>OUT</span></button>`
        : `<div class="empty-inspector">No selection.</div>`;
    return;
  }
  const id = [...state.selectedIds][0];
  const instance = project.root.instances.find((item) => String(item.id) === id);
  const desc = instance && descriptorForInstance(project, instance);
  if (!instance || !desc) return;
  const interfaceNode = isCompositeInterfaceInstance(instance);
  const signal = isInputType(instance.name) ? (project.inputValues[instance.id] ?? 0) : null;
  const signalLabel = signal ? "HIGH" : "LOW";
  const inputToggle = isInputType(instance.name) && !interfaceNode ? `<button class="inspector-control input-toggle-control ${signal ? "high" : ""}" data-action="toggle-input" title="Toggle input (currently ${signalLabel})" aria-label="Toggle input, currently ${signalLabel}"><span class="action-label"><span class="signal-dot ${signal ? "high" : "low"}"></span><span>${signalLabel}</span></span></button>` : "";
  const specialEditor = desc.special === "key"
    ? `<div class="inspector-row"><span>key</span><input class="inspector-input" data-field="key" value="${escapeHtml(instance.internalData.key || "Space")}" /></div>`
    : desc.special === "pulse"
      ? `<div class="inspector-row"><span>pulse ticks</span><input class="inspector-input" type="number" min="1" max="1000" data-field="duration" value="${Number(instance.internalData.duration) || 4}" /></div>`
      : desc.special === "rom"
        ? `<div class="inspector-row"><span>ROM first 16 words</span><input class="inspector-input" data-field="rom" value="${escapeHtml((instance.internalData.memory || []).slice(0, 16).join(" "))}" /></div>`
        : desc.special === "ram"
          ? `<button class="inspector-control" data-action="reset-memory">${actionLabel("refresh-cw", "Reset RAM")}</button>`
          : "";
  const busEditor = isBusOrigin(instance.name) || isBusTerminus(instance.name)
    ? `<button class="inspector-control" data-action="flip-bus">${actionLabel("repeat-2", "Flip bus")}</button>`
    : "";
  const customEditor = desc.kind === "custom"
    ? `<button class="inspector-control" data-action="open-custom">${actionLabel("arrow-up-right", "Open internals")}</button>`
    : "";
  const selectionActions = `<div class="inspector-actions" aria-label="Chip actions">${inspectorAction("rotate", "rotate-cw", "ROT", "Rotate clockwise (R)")}${inspectorAction("duplicate", "copy", "DUP", "Duplicate selection (Ctrl/Cmd+D)")}${inspectorAction("delete", "trash-2", "DEL", "Delete selection")}</div>`;
  const kindLabel = interfaceNode ? `${isInputType(instance.name) ? "interface input" : "interface output"} node` : desc.kind === "custom" ? "custom chip" : "built-in component";
  root.innerHTML = `<div class="selected-card"><div class="selected-title"><span class="chip-swatch" style="background:${desc.colour}"></span><div><strong>${desc.name}</strong><div class="selected-kind">${kindLabel}</div></div></div><div class="inspector-row"><span>label</span><input class="inspector-input" data-field="label" value="${escapeHtml(instance.label || "")}" placeholder="optional" /></div><div class="inspector-row"><span>position</span><span class="inspector-value">${Math.round(instance.position.x)}, ${Math.round(instance.position.y)}</span></div><div class="inspector-row"><span>rotation</span><span class="inspector-value">${instance.rotation * 90}°</span></div><div class="inspector-row"><span>pins</span><span class="inspector-value">${desc.inputPins.length} in / ${desc.outputPins.length} out</span></div>${interfaceNode ? `<div class="inspector-row"><span>public port</span><span class="inspector-value">${escapeHtml(interfaceDirectionForInstance(instance) === "input" ? "input" : "output")}</span></div>` : ""}${specialEditor}${inputToggle}${busEditor}${customEditor}${selectionActions}</div>`;
}

function openInstanceInspector(instance) {
  const description = instance && descriptorForInstance(project, instance);
  if (!instance || !description) return;
  cancelCanvasInteractionBeforeEdit();
  state.selectedIds.clear();
  state.selectedIds.add(String(instance.id));
  state.selectedAnnotationIds.clear();
  state.selectedWirePointKeys.clear();
  state.selectedWireId = null;
  $("#app").classList.add("inspector-open");
  setStatus(`Editing ${description.name} in the inspector.`);
  render();
  requestAnimationFrame(() => focusInstanceEditor(description));
}

function updateCanvasInspectButton() {
  const button = $("#canvas-inspect-button");
  if (!button) return;
  const instance = state.selectedIds.size === 1 && !state.selectedAnnotationIds.size && !state.selectedWireId && !state.selectedWirePointKeys.size
    ? project.root.instances.find((item) => state.selectedIds.has(String(item.id)))
    : null;
  const description = instance && descriptorForInstance(project, instance);
  const blocked = state.annotationPlacement || state.placement || state.drag || state.annotationDrag || state.annotationResize || state.wireStart || state.wireEdit || state.selectionBox;
  if (!instance || !description || blocked) {
    button.classList.add("hidden");
    return;
  }
  const box = chipBoundingBox(project, instance);
  const topLeft = renderer.toScreen({ x: box.x, y: box.y });
  const bottomRight = renderer.toScreen({ x: box.x + box.w, y: box.y + box.h });
  const width = Math.max(1, canvas.parentElement.clientWidth);
  const height = Math.max(1, canvas.parentElement.clientHeight);
  const buttonRadius = 12;
  if (bottomRight.x < -buttonRadius || topLeft.x > width + buttonRadius || bottomRight.y < -buttonRadius || topLeft.y > height + buttonRadius) {
    button.classList.add("hidden");
    return;
  }
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  button.style.left = `${clamp(bottomRight.x + 3, buttonRadius + 4, width - buttonRadius - 4)}px`;
  button.style.top = `${clamp(topLeft.y - 3, buttonRadius + 4, height - buttonRadius - 4)}px`;
  button.title = `Inspect ${description.name}`;
  button.setAttribute("aria-label", `Inspect ${description.name}`);
  button.classList.remove("hidden");
}

function renderHelpMetadata() {
  const customChipCount = Object.keys(project.customChips ?? {}).length;
  const fields = {
    "#help-app-name": APP_METADATA.name,
    "#help-app-version": `v${APP_METADATA.version}`,
    "#help-project-name": project.name,
    "#help-current-view": state.viewStack.length ? project.name : "Main circuit",
    "#help-project-schema": APP_METADATA.projectSchema,
    "#help-chip-schema": APP_METADATA.chipSchema,
    "#help-project-stats": `${project.root.instances?.length ?? 0} chips / ${project.root.wires?.length ?? 0} wires / ${customChipCount} custom chips`,
    "#help-storage": APP_METADATA.storage
  };
  for (const [selector, value] of Object.entries(fields)) {
    const element = $(selector);
    if (element) element.textContent = value;
  }
}

function renderSimulationControls() {
  const speedInput = $("#sim-speed");
  if (speedInput && document.activeElement !== speedInput) speedInput.value = String(state.speed);
  const stepInput = $("#step-sim");
  const bakeButton = $("#bake-sim");
  const clearBakeButton = $("#clear-bake");
  const previousButton = $("#macro-prev-sim");
  const nextButton = $("#macro-next-sim");
  const scrubber = $("#step-scrubber");
  const scrubberWrap = $("#step-scrubber-wrap");
  if (!scrubber || !scrubberWrap) return;
  simulationController.syncStepCount();
  const hasBake = state.bake.hasBake;
  const maxIndex = Math.max(0, state.bake.length - 1);
  const currentIndex = Math.max(0, Math.min(maxIndex, state.bake.currentIndex));
  const firstStep = state.bake.frameAt(0)?.step ?? 0;
  const executionStep = state.bake.executionFrame?.step ?? firstStep;
  const latestStep = state.bake.latestCheckpoint?.step ?? firstStep;
  const atStart = currentIndex <= 0 && executionStep <= firstStep;
  const atEnd = currentIndex >= maxIndex && executionStep >= latestStep;
  if (stepInput) {
    stepInput.disabled = state.simRunning || !hasBake || maxIndex <= 0;
    stepInput.max = String(Math.max(firstStep, executionStep));
    if (document.activeElement !== stepInput) stepInput.value = String(state.stepCount);
  }
  if (previousButton) previousButton.disabled = state.simRunning || !hasBake || (simulationController.previousVisibleHistoryIndex() < 0 && atStart);
  if (nextButton) nextButton.disabled = state.simRunning || !hasBake || maxIndex <= 0 || atEnd;
  if (bakeButton) {
    const ready = state.bake.isReady;
    const baking = state.bake.isBaking;
    const bakeVisualState = baking ? "baking" : ready ? "ready" : "idle";
    bakeButton.disabled = ready;
    bakeButton.classList.toggle("active", baking);
    if (bakeButton.dataset.visualState !== bakeVisualState) {
      bakeButton.innerHTML = `${icon(baking ? "square" : "layers-2")}<span id="bake-sim-label">${baking ? "STOP" : ready ? "BAKED" : "RECORD"}</span>`;
      bakeButton.dataset.visualState = bakeVisualState;
      refreshIcons();
    }
    bakeButton.setAttribute("aria-pressed", String(baking));
    bakeButton.dataset.interactions = String(state.bake.interactions.length);
    bakeButton.dataset.traceEvents = String(state.bake.traceEvents.length);
    bakeButton.setAttribute("aria-label", baking
      ? "Stop recording and keep the current bake"
      : ready
        ? `Recorded bake complete${state.bake.reason ? ` (${state.bake.reason})` : ""}`
        : "Start recording the simulation");
    bakeButton.title = ready
      ? `Bake is complete${state.bake.reason ? ` (${state.bake.reason})` : ""}; clear or change the flow before baking again`
      : baking
        ? "Stop recording and keep the current bake"
        : "Start recording the current circuit";
  }
  if (clearBakeButton) {
    clearBakeButton.disabled = !hasBake;
    clearBakeButton.title = hasBake
      ? "Discard the current recorded bake and return to step zero"
      : "No recorded bake to clear";
  }
  scrubber.max = String(maxIndex);
  scrubber.value = String(currentIndex);
  const scrubberProgress = maxIndex > 0 ? (currentIndex / maxIndex) * 100 : 0;
  scrubber.style.setProperty("--scrubber-progress", `${Math.max(0, Math.min(100, scrubberProgress))}%`);
  const scrubberReady = state.bake.isReady && maxIndex > 0;
  scrubber.disabled = state.simRunning || !scrubberReady;
  scrubberWrap.title = scrubberReady
    ? "Browse the visible checkpoints recorded by this bake"
    : "The scrubber becomes available when a bake records multiple visible checkpoints";
  scrubberWrap.classList.toggle("ready", scrubberReady);
  scrubberWrap.classList.toggle("disabled", scrubber.disabled);
}

function renderCanvasFrame({ simulation = false, coordinates = true } = {}) {
  project._simSnapshot = simulator.snapshot;
  canvas.parentElement.classList.toggle("resizing", Boolean(state.annotationResize || state.hover?.kind === "annotation-resize"));
  canvas.parentElement.classList.toggle("causal-preview", Boolean(state.preview));
  const visibleSimulator = state.preview?.simulator ?? simulator;
  performanceDiagnostics.measure("renderer.draw", () => renderer.draw(project, visibleSimulator, state));
  updateCanvasInspectButton();
  if (coordinates) {
    $("#zoom-readout").textContent = formatZoomReadout(renderer.camera.zoom);
    updateCoordinateReadout();
  }
  if (simulation) {
    renderSimulationControls();
  }
}

function renderScheduled(lanes = {}) {
  if (lanes.full) {
    render();
    return;
  }
  renderCanvasFrame({ simulation: lanes.simulation, coordinates: lanes.coordinates !== false });
}

function scheduleCanvasRender({ simulation = false, coordinates = true } = {}) {
  renderScheduler.request({ canvas: true, simulation, coordinates });
}

function render() {
  renderScheduler.cancel();
  cachedCanvasRect = null;
  performanceDiagnostics.measure("render.total", () => {
    renderCanvasFrame({ simulation: true, coordinates: true });
    if (document.activeElement !== $("#project-name")) $("#project-name").value = project.name;
    const viewed = state.viewStack.length > 0;
    $("#app").classList.toggle("viewed-open", viewed);
    const viewedBack = $("#viewed-back");
    if (viewedBack) {
      const parentName = state.viewStack.at(-1)?.name || "the parent chip";
      viewedBack.classList.toggle("hidden", !viewed);
      viewedBack.title = viewed ? "Back to " + parentName : "Return to the parent chip";
      viewedBack.setAttribute("aria-label", viewed ? "Back to " + parentName : "Return to the parent chip");
    }
    const xrayToggle = $("#xray-toggle");
    if (xrayToggle) {
      xrayToggle.classList.toggle("active", state.xray);
      xrayToggle.setAttribute("aria-pressed", String(state.xray));
      xrayToggle.title = state.xray ? "Hide composite-chip internals (X)" : "Show composite-chip internals (X)";
    }
    const bottomXray = $("#bottom-xray");
    if (bottomXray) {
      bottomXray.classList.toggle("active", state.xray);
      bottomXray.setAttribute("aria-pressed", String(state.xray));
    }
    const dirty = project._revision !== state.savedRevision;
    $("#save-state").textContent = state.savePending ? "SAVING" : dirty ? "UNSAVED" : "SAVED";
    $("#save-state").classList.toggle("dirty", dirty || state.savePending);
    performanceDiagnostics.measure("ui.help", () => renderHelpMetadata());
    performanceDiagnostics.measure("ui.inspector", () => renderInspector());
    performanceDiagnostics.measure("ui.icons", () => refreshIcons());
  });
}

if (performanceDiagnostics.enabled) {
  globalThis.__DLS_PERF_REPORT__ = () => performanceDiagnostics.snapshot({
    renderScheduler: renderScheduler.stats,
    renderer: renderer.performanceStats,
    simulation: simulator.diagnostics,
    bake: {
      frames: state.bake.length,
      bytes: state.bake.memoryBytes,
      maxBytes: state.bake.maxBytes,
      interactions: state.bake.interactions.length,
      traceEvents: state.bake.traceEvents.length,
      traceBytes: state.bake.traceMemoryBytes
    }
  });
}

function hideContextMenu() { $("#context-menu").classList.add("hidden"); }

function toggleDrawer(name) {
  const app = $("#app");
  const className = `${name}-open`;
  const opening = !app.classList.contains(className);
  app.classList.remove("library-open", "inspector-open");
  if (opening) app.classList.add(className);
}

function closeBottomMenu() {
  $("#bottom-menu-popup").classList.add("hidden");
  $("#bottom-menu").classList.remove("active");
}

function closeHelp() {
  $("#help-modal").classList.add("hidden");
}

function openHelp() {
  closeBottomMenu();
  $("#help-modal").classList.remove("hidden");
  requestAnimationFrame(() => $("#close-help").focus());
}

function toggleBottomMenu() {
  const popup = $("#bottom-menu-popup");
  const open = popup.classList.toggle("hidden");
  $("#bottom-menu").classList.toggle("active", !open);
}

function showContextMenu(event) {
  event.preventDefault();
  if (state.suppressContextMenu) {
    state.suppressContextMenu = false;
    hideContextMenu();
    return;
  }
  if (state.zoomDrag) {
    hideContextMenu();
    return;
  }
  const screen = canvasPoint(event); const world = renderer.toWorld(screen.x, screen.y);
  const pin = renderer.findPin(project, world);
  const pinInstance = pin?.instance ? project.root.instances.find((item) => String(item.id) === String(pin.instance.id)) : null;
  const pinDescription = pinInstance && descriptorForInstance(project, pinInstance);
  const pinColourTarget = pinInstance && pin.pinDescription?.direction === "output" && pinDescription?.kind !== "input" && pinDescription?.kind !== "output"
    ? { instanceId: String(pinInstance.id), pinId: String(pin.pin) }
    : null;
  const annotation = !pinColourTarget && !pin ? renderer.findAnnotation(project, world) : null;
  const instance = pinColourTarget || annotation ? null : renderer.findInstance(project, world);
  const wire = instance || pin || pinColourTarget || annotation ? null : renderer.findWire(project, world);
  if (!instance && !wire && !pinColourTarget && !annotation) { hideContextMenu(); return; }
  if (instance) selectInstance(instance);
  if (annotation) selectAnnotation(annotation);
  if (wire) selectWire(wire);
  const menu = $("#context-menu");
  const description = instance && descriptorForInstance(project, instance);
  const colourTarget = pinColourTarget || (instance && description?.special === "led" ? { instanceId: String(instance.id), pinId: "display" } : null);
  const actions = colourTarget ? PIN_COLOURS.map(([value, label]) => ({ action: "set-pin-colour", label, colour: value, instanceId: colourTarget.instanceId, pinId: colourTarget.pinId })) : annotation ? [
    { action: "edit-annotation", label: "Edit annotation" },
    { action: "delete-annotation", label: "Delete annotation" }
  ] : instance ? [
    ...(description?.kind === "custom" ? [{ action: "open-custom", label: "Open internals" }] : []),
    ...(isInputType(instance.name) && !isCompositeInterfaceInstance(instance) ? [{ action: "toggle-input", label: "Toggle input" }] : []),
    ...((isBusOrigin(instance.name) || isBusTerminus(instance.name)) ? [{ action: "flip-bus", label: "Flip bus" }] : []),
    ...(description?.special === "key" ? [{ action: "edit-key", label: "Rebind key" }] : []),
    ...(description?.special === "rom" ? [{ action: "edit-rom", label: "Edit ROM" }] : []),
    ...(description?.special === "pulse" ? [{ action: "edit-pulse", label: "Edit pulse" }] : []),
    { action: "edit-label", label: "Label" },
    { action: "rotate-cw", label: "Rotate clockwise" }, { action: "rotate-ccw", label: "Rotate counter-clockwise" },
    { action: "duplicate", label: "Duplicate" }, { action: "delete", label: "Delete" }
  ] : [{ action: "edit-wire", label: "Edit route" }, { action: "delete-wire", label: "Delete wire" }];
  const header = pinColourTarget ? `Pin: ${pin.pinDescription?.name || pin.pin}` : colourTarget ? "LED colour" : annotation ? (annotation.type === "label" ? "Label" : "Note") : instance ? description?.name : `Wire: ${wire?.source?.pin ?? "signal"}`;
  menu.innerHTML = `<div class="context-menu-header">${escapeHtml(header || "Context")}</div>${actions.map((item) => `<button data-context-action="${item.action}"${item.colour ? ` data-context-colour="${item.colour}" data-context-instance="${item.instanceId}" data-context-pin="${item.pinId}"` : ""}>${icon(contextIcon(item.action))}<span>${escapeHtml(item.label)}</span></button>`).join("")}`;
  positionContextMenu(menu, { left: event.clientX, top: event.clientY });
  refreshIcons();
}

function getCanvasRect() {
  if (!cachedCanvasRect) {
    const rect = canvas.getBoundingClientRect();
    cachedCanvasRect = {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  }
  return cachedCanvasRect;
}

function canvasPoint(event) {
  const rect = getCanvasRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function canvasHitTarget(world) {
  return performanceDiagnostics.measure("hit-test", () => {
    const selectedAnnotation = state.selectedAnnotationIds.size === 1
    ? project.root.annotations?.find((item) => String(item.id) === [...state.selectedAnnotationIds][0])
    : null;
    if (selectedAnnotation?.type === "text" && renderer.findAnnotationResizeHandle(project, world) === selectedAnnotation) {
      return { kind: "annotation-resize", value: selectedAnnotation };
    }
    if (state.wireEdit) {
      const point = renderer.findWirePoint(project, world, 12, state.wireEdit.wireId);
      if (point) return { kind: "wire-point", value: point };
    }
    const pin = renderer.findPin(project, world);
    if (pin) return { kind: "pin", value: pin };
    const junction = renderer.findJunction(project, world);
    if (junction) return { kind: "junction", value: junction };
    const annotation = renderer.findAnnotation(project, world);
    if (annotation) return { kind: "annotation", value: annotation };
    const instance = renderer.findInstance(project, world);
    if (instance) return { kind: "instance", value: instance };
    const wire = renderer.findWire(project, world);
    if (wire) return { kind: "wire", value: wire };
    return { kind: "empty", value: null };
  });
}

function hoverFromHit(hit) {
  if (hit.kind === "annotation-resize") return { kind: "annotation-resize", id: String(hit.value.id) };
  if (hit.kind === "wire-point") return { kind: "wire-point", wireId: String(hit.value.wire.id), index: hit.value.index };
  if (hit.kind === "pin") return { kind: "pin", owner: String(hit.value.owner), pin: String(hit.value.pin) };
  if (hit.kind === "junction") return { kind: "junction", id: String(hit.value.pin) };
  if (hit.kind === "annotation") return { kind: "annotation", id: String(hit.value.id) };
  if (hit.kind === "instance") return { kind: "instance", id: String(hit.value.id) };
  if (hit.kind === "wire") return { kind: "wire", id: hit.value.id };
  return null;
}

function sameHoverTarget(left, right) {
  return left?.kind === right?.kind
    && left?.id === right?.id
    && left?.owner === right?.owner
    && left?.pin === right?.pin
    && left?.wireId === right?.wireId
    && left?.index === right?.index;
}

function sameHoverTooltip(left, right) {
  return left?.kind === right?.kind && left?.id === right?.id && left?.name === right?.name;
}

function updateCoordinateReadout(world = state.mouseWorld) {
  const readout = $("#coordinate-readout");
  if (!readout) return;
  const value = `${Math.round(world.x)}, ${Math.round(world.y)}`;
  if (readout.textContent !== value) readout.textContent = value;
}

function cancelPendingHoverResolution() {
  if (hoverResolveFrame !== null) cancelAnimationFrame(hoverResolveFrame);
  hoverResolveFrame = null;
  pendingHoverResolution = null;
}

function updateCanvasHover(world, screen = state.mouseScreen) {
  const previousHover = state.hover;
  const previousTooltip = state.hoverTooltip;
  const hit = canvasHitTarget(world);
  state.hover = hoverFromHit(hit);
  const deepTarget = state.xray ? renderer.findXrayHoverTarget(project, world) : null;
  if (deepTarget) state.hoverTooltip = deepTarget;
  else if (hit.kind === "instance") {
    const description = descriptorForInstance(project, hit.value);
    state.hoverTooltip = { kind: "chip", id: String(hit.value.id), name: String(hit.value.label || description?.name || hit.value.name || "CHIP") };
  } else state.hoverTooltip = null;
  hoverTooltipLayer.setName(state.hoverTooltip?.name, screen);
  return !sameHoverTarget(previousHover, state.hover) || !sameHoverTooltip(previousTooltip, state.hoverTooltip);
}

function requestCanvasHover(world, screen) {
  state.hoverPointerActive = true;
  state.mouseScreen = { ...screen };
  // Hide immediately on raw movement. Name resolution remains coalesced
  // because X-ray hit testing can traverse many nested descriptions; once it
  // settles, the tooltip controller waits 500 ms before revealing the name.
  hoverTooltipLayer.move(screen);
  pendingHoverResolution = { world: { ...world }, screen: { ...screen } };
  if (hoverResolveFrame !== null) return;
  hoverResolveFrame = requestAnimationFrame(() => {
    hoverResolveFrame = null;
    const pending = pendingHoverResolution;
    pendingHoverResolution = null;
    if (!pending || !state.hoverPointerActive) return;
    if (updateCanvasHover(pending.world, pending.screen)) scheduleCanvasRender();
  });
}

function handlePointerDown(event) {
  if (state.pointerSession) return;
  updatePointerModifiers(event);
  const screen = canvasPoint(event); const world = renderer.toWorld(screen.x, screen.y); state.mouseWorld = world;
  state.mouseScreen = { ...screen };
  state.hoverPointerActive = true;
  if (isCanvasInteractionBlocked()) {
    event.preventDefault();
    closeBottomMenu();
    closeCollectionPopup();
    hideContextMenu();
    return;
  }
  closeBottomMenu();
  closeCollectionPopup();
  hideContextMenu();
  if (event.button === 2) {
    event.preventDefault();
    const hit = canvasHitTarget(world);
    if (hit.kind === "wire-point") {
      state.suppressContextMenu = true;
      deleteWireEditPoint(hit.value.index);
      return;
    }
    if (event.altKey) {
      state.zoomDrag = { screen };
      state.suppressContextMenu = true;
      beginCanvasPointer(event, "zoom", { originWorld: world });
      return;
    }
    if (state.annotationPlacement || state.placement || state.drag || state.annotationDrag || state.annotationResize || state.wireStart || state.wireEdit || state.selectionBox) {
      cancelTransientInteraction();
      state.suppressContextMenu = true;
      return;
    }
    return;
  }
  if (event.button === 1 || event.button === 0 && event.altKey) {
    event.preventDefault();
    state.pan = { x: screen.x, y: screen.y, camera: { ...renderer.camera } };
    canvas.parentElement.classList.add("panning");
    beginCanvasPointer(event, "pan", { originWorld: world });
    return;
  }
  if (event.button !== 0) return;
  if (state.annotationPlacement) {
    event.preventDefault();
    beginCanvasPointer(event, "annotation-placement", { originWorld: world });
    placeAnnotationAt(world);
    releaseCanvasPointer(event.pointerId);
    return;
  }
  if (state.placement) {
    event.preventDefault();
    beginCanvasPointer(event, "placement", { originWorld: world });
    updatePlacementPreview(world);
    placeAt(world);
    releaseCanvasPointer(event.pointerId);
    return;
  }
  const hit = canvasHitTarget(world);
  if (hit.kind === "annotation-resize") {
    beginCanvasPointer(event, "annotation-resize-press", { originWorld: world, target: hit.value });
    startAnnotationResize(hit.value, world);
    render();
    return;
  }
  if (state.wireStart) {
    beginCanvasPointer(event, hit.kind === "empty" ? "wire-route-press" : "wire-target-press", { originWorld: world, target: hit.value });
    return;
  }
  if (hit.kind === "wire-point") {
    const point = hit.value;
    const key = wirePointKey(point.wire.id, point.index);
    if (isMultiMode(event) && state.selectedWirePointKeys.has(key)) {
      state.selectedWirePointKeys.delete(key);
      state.wireEdit.index = -1;
      render();
      return;
    }
    if (!state.selectedWirePointKeys.has(key)) {
      state.selectedWirePointKeys.clear();
      state.selectedWirePointKeys.add(key);
    }
    beginCanvasPointer(event, "wire-point-press", { originWorld: world, target: point, additive: isMultiMode(event) });
    render();
    return;
  }
  if (state.wireEdit && hit.kind === "wire" && hit.value.id === state.wireEdit.wireId) {
    beginCanvasPointer(event, "wire-point-drag", { originWorld: world, target: { wire: hit.value, index: -1 } });
    insertWirePoint(hit.value, world);
    return;
  }
  if (hit.kind === "pin" || hit.kind === "junction") {
    beginCanvasPointer(event, "wire-start-press", { originWorld: world, target: hit.value });
    startWire(hit.value);
    return;
  }
  if (state.tool === "wire") {
    if (hit.kind === "wire") {
      const endpoint = wireEndpointAt(hit.value, world);
      if (endpoint) {
        beginCanvasPointer(event, "wire-start-press", { originWorld: world, target: endpoint });
        startWire(endpoint);
      }
      return;
    }
    setStatus("Wire tool active.");
    return;
  }
  if (hit.kind === "annotation") {
    const annotation = hit.value;
    const additive = isMultiMode(event);
    const alreadySelected = state.selectedAnnotationIds.has(String(annotation.id));
    if (additive || !alreadySelected) selectAnnotation(annotation, additive);
    if (state.selectedAnnotationIds.has(String(annotation.id))) {
      beginCanvasPointer(event, "annotation-press", { originWorld: world, target: annotation, additive });
    }
    return;
  }
  if (hit.kind === "instance") {
    const instance = hit.value;
    const additive = isMultiMode(event);
    const id = String(instance.id);
    if (state.pendingInputToggle?.id === id) cancelPendingInputToggle();
    const alreadySelected = state.selectedIds.has(String(instance.id));
    if (additive || !alreadySelected) selectInstance(instance, additive);
    if (state.selectedIds.has(String(instance.id))) {
      beginCanvasPointer(event, "instance-press", { originWorld: world, target: instance, additive });
    }
    return;
  }
  if (hit.kind === "wire") {
    const wire = hit.value;
    if (state.tool === "wire") {
      const endpoint = wireEndpointAt(wire, world);
      if (endpoint) {
        beginCanvasPointer(event, "wire-start-press", { originWorld: world, target: endpoint });
        startWire(endpoint);
      }
    } else {
      selectWire(wire);
    }
    return;
  }
  const routeSelection = Boolean(state.wireEdit);
  if (routeSelection) {
    if (!isMultiMode(event)) state.selectedWirePointKeys.clear();
  } else if (!isMultiMode(event)) {
    state.selectedIds.clear();
    state.selectedAnnotationIds.clear();
    state.selectedWireId = null;
    state.selectedWirePointKeys.clear();
  }
  event.preventDefault();
  beginCanvasPointer(event, "empty-press", { originWorld: world, additive: isMultiMode(event) });
}

function handlePointerMove(event) {
  if (!ownsCanvasPointer(event)) return;
  updatePointerModifiers(event);
  if (state.drag || state.annotationDrag || state.annotationResize || state.wirePointDrag) renderer.invalidateGeometry?.();
  const screen = canvasPoint(event); const world = renderer.toWorld(screen.x, screen.y); state.mouseWorld = world;
  state.mouseScreen = { ...screen };
  const session = state.pointerSession;
  if (session && !session.moved && hasPointerMoved(session, screen)) {
    session.moved = true;
    if (session.kind === "instance-press") {
      startDragging(session.target, session.originWorld);
      session.kind = "instance-drag";
    } else if (session.kind === "annotation-press") {
      startDraggingAnnotation(session.target, session.originWorld);
      session.kind = "annotation-drag";
    } else if (session.kind === "wire-point-press") {
      startWirePointDrag(session.target, session.originWorld);
      session.kind = "wire-point-drag";
    } else if (session.kind === "annotation-resize-press") {
      session.kind = "annotation-resize";
    } else if (session.kind === "empty-press") {
      const routeSelection = Boolean(state.wireEdit);
      state.selectionBox = {
        start: { ...session.originWorld },
        current: { ...world },
        additive: session.additive,
        mode: routeSelection ? "wire-points" : "instances",
        wireId: routeSelection ? String(state.wireEdit.wireId) : null
      };
      session.kind = "selection-box";
      canvas.parentElement.classList.add("selecting");
    }
  }
  requestCanvasHover(world, screen);
  if (state.zoomDrag) {
    const deltaY = screen.y - state.zoomDrag.screen.y;
    renderer.zoomAt(screen.x, screen.y, Math.exp(-deltaY * 0.006));
    state.zoomDrag.screen = screen;
    state.viewCameras[viewKey()] = { ...renderer.camera };
    scheduleCanvasRender(); return;
  }
  if (state.pan) {
    renderer.camera.x = state.pan.camera.x - (screen.x - state.pan.x) / renderer.camera.zoom;
    renderer.camera.y = state.pan.camera.y - (screen.y - state.pan.y) / renderer.camera.zoom;
    requestCanvasHover(renderer.toWorld(screen.x, screen.y), screen);
    state.viewCameras[viewKey()] = { ...renderer.camera };
    scheduleCanvasRender(); return;
  }
  if (state.annotationPlacement) {
    updateAnnotationPlacementPreview(world);
    scheduleCanvasRender(); return;
  }
  if (state.annotationResize && (!session || session.kind === "annotation-resize")) {
    applyAnnotationResize(world, event);
    scheduleCanvasRender(); return;
  }
  if (state.placement) {
    updatePlacementPreview(world);
    scheduleCanvasRender(); return;
  }
  if (state.annotationDrag) {
    applyAnnotationDrag(world, event);
    scheduleCanvasRender(); return;
  }
  if (state.wirePointDrag && (!session || session.moved)) {
    applyWirePointDrag(world, event);
    scheduleCanvasRender(); return;
  }
  if (state.selectionBox) {
    state.selectionBox.current = { ...world };
    scheduleCanvasRender(); return;
  }
  if (state.wireStart) {
    state.wireTarget = wireTargetAt(world).endpoint;
    if (state.wireTarget) {
      const result = canConnect(state.wireStart, state.wireTarget);
      state.wireTargetValid = result.ok;
      setStatus(result.ok ? "Pin target ready." : result.message);
    } else state.wireTargetValid = null;
    scheduleCanvasRender();
    return;
  }
  if (state.drag) {
    applyDrag(world, event);
    scheduleCanvasRender();
    return;
  }
  updateCoordinateReadout(world);
}

function handlePointerUp(event) {
  if (!ownsCanvasPointer(event)) return;
  updatePointerModifiers(event);
  const session = state.pointerSession;
  if (!session) return;
  const screen = canvasPoint(event);
  const world = renderer.toWorld(screen.x, screen.y);
  state.mouseWorld = world;
  state.mouseScreen = { ...screen };
  const finishPointer = () => releaseCanvasPointer(event.pointerId);
  if (state.zoomDrag) { state.zoomDrag = null; finishPointer(); return; }
  if (state.pan) { state.pan = null; canvas.parentElement.classList.remove("panning"); finishPointer(); return; }
  if (state.annotationResize) {
    if (state.annotationResize.moved) {
      state.undo.push(state.annotationResize.before);
      state.redo.length = 0;
      touch("Note resized.");
    }
    state.annotationResize = null;
    finishPointer();
    render();
    return;
  }
  if (state.wireStart && ["wire-start-press", "wire-target-press", "wire-route-press"].includes(session.kind)) {
    const target = wireTargetAt(world);
    state.wireTarget = target.endpoint;
    if (target.endpoint) {
      if (target.wire) completeWireToWire(target.wire, world);
      else completeWire(target.endpoint);
    } else if (session.kind === "wire-route-press") {
      const start = state.wirePoints.at(-1) ?? renderer.endpointPosition(project, state.wireStart);
      state.wirePoints.push(snap(forceStraight(world, start, event), event));
      state.wireTarget = null;
      state.wireTargetValid = null;
      setStatus("Wire route point added.");
    } else {
      state.wireTarget = null;
      state.wireTargetValid = null;
      setStatus("Wire remains active.");
    }
    finishPointer();
    render();
    return;
  }
  if (state.wirePointDrag) {
    if (state.wirePointDrag.moved) {
      state.undo.push(state.wirePointDrag.before);
      state.redo.length = 0;
      touch("Wire route points moved.");
    }
    state.wirePointDrag = null;
    if (state.wireEdit) {
      state.wireEdit.index = -1;
      state.wireEdit.before = null;
      state.wireEdit.moved = false;
    }
    finishPointer();
    render();
    return;
  }
  if (state.selectionBox) {
    const box = {
      x: Math.min(state.selectionBox.start.x, state.selectionBox.current.x),
      y: Math.min(state.selectionBox.start.y, state.selectionBox.current.y),
      w: Math.abs(state.selectionBox.current.x - state.selectionBox.start.x),
      h: Math.abs(state.selectionBox.current.y - state.selectionBox.start.y)
    };
    if (state.selectionBox.mode === "wire-points") {
      const wire = project.root.wires.find((item) => String(item.id) === String(state.selectionBox.wireId));
      if (!state.selectionBox.additive) state.selectedWirePointKeys.clear();
      if (wire && (box.w > 1 || box.h > 1)) {
        const handleSize = 8 / renderer.camera.zoom;
        for (const [index, point] of (wire.points ?? []).entries()) {
          const pointBox = { x: point.x - handleSize / 2, y: point.y - handleSize / 2, w: handleSize, h: handleSize };
          if (boxesOverlap(box, pointBox)) state.selectedWirePointKeys.add(wirePointKey(wire.id, index));
        }
      }
      if (wire) state.selectedWireId = wire.id;
    } else if (box.w > 1 || box.h > 1) {
      for (const item of project.root.instances) {
        if (boxesOverlap(box, chipBoundingBox(project, item))) state.selectedIds.add(String(item.id));
      }
      for (const annotation of project.root.annotations ?? []) {
        if (boxesOverlap(box, annotationBoundingBox(annotation))) state.selectedAnnotationIds.add(String(annotation.id));
      }
      state.selectedWireId = null;
    }
    state.selectionBox = null;
    canvas.parentElement.classList.remove("selecting");
    finishPointer();
    render();
    return;
  }
  if (state.annotationDrag) {
    if (state.annotationDrag.moved) {
      state.undo.push(state.annotationDrag.before);
      state.redo.length = 0;
      touch("Annotations moved.");
    }
    state.annotationDrag = null;
    finishPointer();
    render();
    return;
  }
  if (state.drag) {
    let rolledBack = false;
    if (state.drag.invalid) {
      restoreDrag();
      rolledBack = true;
      setStatus("Move cancelled: an element overlaps another element.");
      notify("Move cancelled: overlap.", true);
    } else if (state.drag.moved) {
      state.undo.push(state.drag.before);
      state.redo.length = 0;
      touch("Elements moved.");
    }
    state.drag = null;
    // The pointer is still over the rejected drop location. Resolve hover
    // against the restored geometry so the node is not left looking/clicking
    // as if it still lived at the blocked position.
    if (rolledBack) updateCanvasHover(world, screen);
    finishPointer();
    render();
    return;
  }
  if (session.kind === "instance-press") {
    const clicked = project.root.instances.find((item) => String(item.id) === String(session.target?.id));
    if (clicked && isInputType(clicked.name) && !isCompositeInterfaceInstance(clicked)) scheduleInputToggle(clicked);
    finishPointer();
    render();
    return;
  }
  finishPointer();
}

function handleKeyDown(event) {
  const isTextEntry = event.target.matches("input, textarea, select");
  if (event.key === "Escape") {
    event.preventDefault();
    if (event.target === $("#project-name")) { cancelProjectNameEdit(); return; }
    if (isTextEntry) { event.target.blur(); return; }
    if (state.pendingInputToggle) cancelPendingInputToggle();
    if (!$("#help-modal").classList.contains("hidden")) { closeHelp(); return; }
    if (!$("#context-menu").classList.contains("hidden")) { hideContextMenu(); return; }
    if (state.annotationPlacement || state.placement || state.drag || state.annotationDrag || state.annotationResize || state.wirePointDrag || state.wireStart || state.wireEdit || state.selectionBox || state.chipDrag || state.annotationToolDrag || state.pan || state.zoomDrag || state.pointerSession) {
      cancelTransientInteraction();
      return;
    }
    if (isKeyboardInteractionBlocked()) {
      closeBottomMenu();
      closeCollectionPopup();
      $("#app").classList.remove("library-open", "inspector-open");
      render();
      return;
    }
    if (state.selectedIds.size || state.selectedAnnotationIds.size || state.selectedWireId) {
      clearSelection("Selection cleared.");
      return;
    }
    if (state.viewStack.length) { exitCustomView(); return; }
    return;
  }
  if (isTextEntry) return;
  updatePointerModifiers(event);
  const key = event.key.toLowerCase();
  if (event.key === "Enter" && state.wireEdit) { exitWireEdit(true); setStatus("Wire edit mode ended."); return; }
  if ((event.ctrlKey || event.metaKey) && key === "s") { event.preventDefault(); saveCurrentProject(); return; }
  if ((event.ctrlKey || event.metaKey) && key === "n") { event.preventDefault(); resetProject(); return; }
  if ((event.ctrlKey || event.metaKey) && key === "g") { event.preventDefault(); toggleGrid(); return; }
  if ((event.ctrlKey || event.metaKey) && key === "l") { event.preventDefault(); $("#app").classList.add("library-open"); $("#chip-search").focus(); return; }
  if ((event.ctrlKey || event.metaKey) && key === "f") { event.preventDefault(); $("#app").classList.add("library-open"); $("#chip-search").focus(); return; }
  if (isKeyboardInteractionBlocked()) return;
  if (key === "x" && !event.ctrlKey && !event.metaKey && !event.altKey && !state.wireEdit && !state.drag && !state.placement && !state.annotationPlacement) { toggleXray(); return; }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    if (state.annotationPlacement) {
      cancelTransientInteraction();
    } else if (state.placement) {
      cancelPlacement();
    } else if (state.wireStart) {
      if (state.wirePoints.length) { state.wirePoints.pop(); setStatus("Last wire route point removed."); render(); }
      else cancelTransientInteraction();
    } else deleteSelection();
    return;
  }
  if (key === "n" && !event.ctrlKey && !event.metaKey && !event.altKey) { beginAnnotationPlacement("text"); return; }
  if (key === "l" && !event.ctrlKey && !event.metaKey && !event.altKey) { beginAnnotationPlacement("label"); return; }
  if (key === "w") {
    if (state.annotationPlacement) cancelTransientInteraction();
    if (state.placement || state.drag || state.annotationDrag || state.wireEdit) return;
    setTool(state.tool === "wire" ? "select" : "wire", state.tool === "wire" ? "Select tool active." : "Wire tool active."); render(); return;
  }
  if (key === "v") {
    if (state.annotationPlacement) cancelTransientInteraction();
    if (state.placement || state.drag || state.annotationDrag || state.wireEdit) return;
    setTool("select", "Select tool active."); render(); return;
  }
  if (key === "r" && !event.ctrlKey && !event.metaKey && !event.altKey) { rotateSelection(event.shiftKey ? -1 : 1); return; }
  if (key === "d" && (isMultiMode(event) || event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!state.placement && !state.drag && !state.annotationDrag && !state.wireStart && !state.wireEdit) duplicateSelection(); return; }
  if ((event.ctrlKey || event.metaKey) && key === "r") { event.preventDefault(); resetCamera(); return; }
  if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
  if ((event.ctrlKey || event.metaKey) && key === "y") { event.preventDefault(); redo(); return; }
  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      if (state.simRunning || state.bake.isBaking) simulationController.finishBake("manual");
      else simulationController.startBake(true);
    }
    else if (!state.simRunning) simulationController.step();
  }
}

function keyDeviceMatchesEvent(instance, event) {
  if (instance?.name !== TYPE.KEY) return false;
  const binding = String(instance.internalData?.key || "Space").trim().toLowerCase();
  if (!binding) return false;
  const key = String(event.key || "").toLowerCase();
  const code = String(event.code || "").toLowerCase();
  return binding === key
    || binding === code
    || binding === `key${key}`
    || (binding === "space" && (key === " " || key === "spacebar" || code === "space"));
}

function previewKeyInteraction(event, phase, source) {
  if (event.repeat || isKeyboardInteractionBlocked()) return;
  if (event.key === " " || event.key === "Spacebar") return;
  if (!(project.root.instances ?? []).some((instance) => keyDeviceMatchesEvent(instance, event))) return;
  const keyLabel = event.key === " " ? "Space" : event.key || event.code;
  simulationController.startCausalPreview(
    `key ${keyLabel} ${phase}`,
    source,
    { kind: "key-change", source: "keyboard", target: keyLabel, phase, after: phase === "pressed" }
  );
}

function simulationInteractionSource() {
  const sourceSimulator = state.preview?.simulator ?? simulator;
  return { snapshot: sourceSimulator.snapshot, step: sourceSimulator.stepCount };
}

libraryController = createLibraryController({
  $,
  escapeHtml,
  refreshIcons,
  getProject: () => project,
  getState: () => state,
  collectionGroupsFor,
  canvas,
  renderer,
  beginPlacement,
  updatePlacementPreview,
  placeAt,
  cancelPlacement,
  closeBottomMenu,
  render,
  scheduleCanvasRender,
  getCanvasRect,
  touch,
  saveCurrentProject
});
libraryController.bind();
$("#save-chip").addEventListener("click", createCustomChip);
$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  if (!confirmDiscardChanges("Import this project?")) { event.target.value = ""; return; }
  try { project = await readProjectFile(file); project._revision = 0; state.projectSaved = false; simulator = new Simulator(project); resetEditorStateForProject(); renderer.fit(project); renderLibrary(); render(); notify("Project imported."); setStatus("Project imported successfully."); }
  catch (error) { notify(`Import failed: ${error.message}`, true); }
  event.target.value = "";
});
$("#project-name").addEventListener("focus", beginProjectNameEdit);
$("#project-name").addEventListener("blur", () => {
  state.projectNameBeforeEdit = null;
  state.projectNameRevisionBeforeEdit = null;
  state.projectNameUpdatedAtBeforeEdit = null;
});
$("#project-name").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    commitProjectNameEdit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelProjectNameEdit();
  }
});
$("#project-name").addEventListener("input", (event) => updateName(event.target.value));
$("#project-name").addEventListener("change", (event) => updateName(event.target.value));
$("#bottom-menu").addEventListener("click", toggleBottomMenu);
$("#bottom-library").addEventListener("click", () => { closeBottomMenu(); toggleDrawer("library"); });
$("#viewed-back").addEventListener("click", exitCustomView);
$("#close-library").addEventListener("click", () => $("#app").classList.remove("library-open"));
$("#close-inspector").addEventListener("click", () => $("#app").classList.remove("inspector-open"));
$("#bottom-new").addEventListener("click", () => { closeBottomMenu(); resetProject(); });
$("#bottom-save").addEventListener("click", () => { closeBottomMenu(); saveCurrentProject(); });
$("#bottom-save-as-project").addEventListener("click", () => { closeBottomMenu(); saveAsProject(); });
$("#bottom-help").addEventListener("click", openHelp);
$("#bottom-save-chip").addEventListener("click", () => { closeBottomMenu(); createCustomChip(); });
$("#bottom-xray").addEventListener("click", () => { closeBottomMenu(); toggleXray(); });
$("#bottom-export").addEventListener("click", () => { closeBottomMenu(); downloadProject(project); notify("Project JSON exported."); });
$("#bottom-import").addEventListener("click", () => { closeBottomMenu(); $("#import-file").click(); });
$("#select-tool").addEventListener("click", () => { if (state.annotationPlacement || state.placement || state.drag || state.annotationDrag || state.annotationResize || state.wireStart || state.wireEdit) cancelTransientInteraction(); setTool("select", "Select tool active."); render(); });
$("#wire-tool").addEventListener("click", () => { if (state.annotationPlacement || state.placement || state.drag || state.annotationDrag || state.annotationResize || state.wireStart || state.wireEdit) cancelTransientInteraction(); setTool("wire", "Wire tool active."); render(); });
$("#xray-toggle").addEventListener("click", toggleXray);
document.querySelectorAll("[data-annotation-tool]").forEach((button) => {
  button.addEventListener("pointerdown", beginAnnotationToolDrag);
  button.addEventListener("click", handleAnnotationToolClick);
});
$("#canvas-inspect-button").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  if (state.selectedIds.size !== 1 || state.selectedAnnotationIds.size || state.selectedWireId || state.selectedWirePointKeys.size || state.wireEdit) return;
  const instance = project.root.instances.find((item) => state.selectedIds.has(String(item.id)));
  if (instance) openInstanceInspector(instance);
});
$("#fit-view").addEventListener("click", () => { renderer.fit(project); state.viewCameras[viewKey()] = { ...renderer.camera }; render(); });
$("#bake-sim").addEventListener("click", () => {
  audioContext ||= new AudioContext();
  audioContext.resume();
  if (state.simRunning || state.bake.isBaking) simulationController.finishBake("manual");
  else simulationController.startBake(true);
});
$("#clear-bake").addEventListener("click", () => simulationController.clearBake());
$("#step-sim").addEventListener("change", (event) => {
  event.target.blur();
  simulationController.jumpToStep(event.target.value);
});
$("#step-sim").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    event.target.blur();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.target.value = String(state.stepCount);
    event.target.blur();
  }
});
$("#macro-prev-sim").addEventListener("click", () => simulationController.macroStep(-1));
$("#macro-next-sim").addEventListener("click", () => simulationController.macroStep(1));
$("#sim-speed").addEventListener("change", (event) => updateSimulationSpeed(event.target.value));
$("#step-scrubber").addEventListener("input", (event) => {
  if (state.simRunning) return;
  simulationController.restoreFrame(event.target.value);
});
$("#close-help").addEventListener("click", closeHelp);
$("#help-modal").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeHelp(); });
$("#inspector").addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "open-custom") {
    const instance = project.root.instances.find((item) => state.selectedIds.has(String(item.id)));
    if (instance) enterCustomView(instance);
  }
  if (action === "delete" || action === "delete-wire" || action === "delete-annotation") deleteSelection();
  if (action === "rotate" || action === "rotate-cw") rotateSelection(1);
  if (action === "rotate-ccw") rotateSelection(-1);
  if (action === "flip-bus") flipBusSelection();
  if (action === "duplicate") duplicateSelection();
  if (action === "toggle-input") { const instance = project.root.instances.find((item) => state.selectedIds.has(String(item.id))); if (instance) toggleInput(instance); }
  if (action === "reset-memory") {
    const instance = project.root.instances.find((item) => state.selectedIds.has(String(item.id)));
    const description = instance && descriptorForInstance(project, instance);
    if (instance) {
      mutate("Memory reset.", () => { instance.internalData.memory = Array.from({ length: Number(description?.memorySize) || 256 }, () => 0); });
      simulationController.recordInteraction({ kind: "memory-reset", source: "inspector", target: instance.id });
    }
  }
  if (action === "add-root-input") addRootPin("input");
  if (action === "add-root-output") addRootPin("output");
});

function addRootPin(direction) {
  if (!state.viewStack.length) return;
  const type = direction === "input" ? TYPE.IN_1 : TYPE.OUT_1;
  const description = BUILTINS[type];
  const terminalPin = direction === "input" ? description.outputPins[0] : description.inputPins[0];
  const existing = project.root.instances.filter((item) => interfaceDirectionForInstance(item) === direction);
  const prefix = direction === "input" ? "in" : "out";
  let index = existing.length;
  let interfaceId = `${prefix}-${index}`;
  const used = new Set((direction === "input" ? project.root.interfaceBindings?.inputs : project.root.interfaceBindings?.outputs)?.map((item) => String(item.publicId)) ?? []);
  while (used.has(interfaceId)) interfaceId = `${prefix}-${++index}`;
  const endpointX = direction === "input" ? -project.root.size.x / 2 : project.root.size.x / 2;
  const instance = instanceFor(type, {
    x: endpointX - Number(terminalPin.x || 0),
    y: (existing.length - 1) * 18 - 18
  });
  instance.label = direction === "input" ? `IN ${existing.length + 1}` : `OUT ${existing.length + 1}`;
  instance.interfaceId = interfaceId;
  mutate(`${direction === "input" ? "Input" : "Output"} node added.`, () => { project.root.instances.push(instance); });
  state.selectedIds = new Set([String(instance.id)]);
  state.selectedAnnotationIds.clear();
  renderer.fit(project); render();
}
$("#inspector").addEventListener("change", (event) => {
  const field = event.target.dataset.field;
  const annotation = state.selectedAnnotationIds.size === 1
    ? project.root.annotations?.find((item) => String(item.id) === [...state.selectedAnnotationIds][0])
    : null;
  if (annotation) {
    if (field === "annotation-text") mutate("Annotation text updated.", () => { annotation.text = event.target.value.slice(0, 4000); });
    if (field === "annotation-colour") mutate("Annotation colour updated.", () => {
      const palette = annotationPalette(event.target.value);
      annotation.colour = palette.colour;
      annotation.background = palette.background;
    });
    if (field === "annotation-type") mutate("Annotation type updated.", () => {
      annotation.type = event.target.value === "label" ? "label" : "text";
      const palette = annotationPalette(annotation.colour || (annotation.type === "label" ? "#f3d36b" : "#d7eaff"));
      annotation.colour = palette.colour;
      annotation.background = palette.background;
      if (annotation.type === "label") annotation.height = 22;
      else annotation.height = Math.max(80, annotation.height);
    });
    if (field === "annotation-width") mutate("Annotation width updated.", () => { annotation.width = Math.max(annotation.type === "label" ? 40 : 100, Math.min(1000, Number(event.target.value) || annotation.width)); });
    if (field === "annotation-height") mutate("Annotation height updated.", () => { annotation.height = Math.max(annotation.type === "label" ? 22 : 40, Math.min(600, Number(event.target.value) || annotation.height)); });
    if (field === "annotation-font-size") mutate("Annotation font size updated.", () => { annotation.fontSize = Math.max(8, Math.min(32, Number(event.target.value) || annotation.fontSize)); });
    return;
  }
  const instance = project.root.instances.find((item) => state.selectedIds.has(String(item.id))); if (!instance) return;
  const desc = descriptorForInstance(project, instance);
  if (field === "label") mutate("Label updated.", () => { instance.label = event.target.value.slice(0, 32); });
  if (field === "key") mutate("Key binding updated.", () => { instance.internalData.key = event.target.value || "Space"; });
  if (field === "duration") {
    mutate("Pulse duration updated.", () => { instance.internalData.duration = Math.max(1, Math.min(1000, Number(event.target.value) || 4)); });
    simulationController.recordInteraction({ kind: "pulse-configured", source: "inspector", target: instance.id, after: instance.internalData.duration });
  }
  if (field === "rom") {
    mutate("ROM contents updated.", () => { const values = event.target.value.trim().split(/[\s,]+/).filter(Boolean).map((item) => Number.parseInt(item, 0)); const length = Number(desc?.memorySize) || 256; instance.internalData.memory = Array.from({ length }, (_, index) => Number.isFinite(values[index]) ? values[index] & 0xffff : instance.internalData.memory?.[index] ?? 0); });
    simulationController.recordInteraction({ kind: "memory-programmed", source: "inspector", target: instance.id });
  }
});

canvas.addEventListener("contextmenu", showContextMenu);
canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", (event) => {
  if (state.pointerSession?.pointerId !== event.pointerId) return;
  cancelActiveCanvasPointerSession();
});
canvas.addEventListener("lostpointercapture", () => {
  if (state.pointerSession) cancelActiveCanvasPointerSession();
});
canvas.addEventListener("pointerleave", () => {
  if (state.drag || state.annotationDrag || state.annotationResize || state.wirePointDrag || state.selectionBox || state.wireStart) return;
  state.hoverPointerActive = false;
  cancelPendingHoverResolution();
  state.hover = null;
  state.hoverTooltip = null;
  hoverTooltipLayer.hide();
  render();
});
canvas.addEventListener("dblclick", (event) => {
  cancelPendingInputToggle();
  if (state.pointerSession) cancelActiveCanvasPointerSession({ renderState: false });
  const screen = canvasPoint(event); const world = renderer.toWorld(screen.x, screen.y); const annotation = renderer.findAnnotation(project, world);
  if (annotation) {
    selectAnnotation(annotation);
    $("#app").classList.add("inspector-open");
    requestAnimationFrame(() => document.querySelector('#inspector [data-field="annotation-text"]')?.focus());
    return;
  }
  const wire = renderer.findWire(project, world);
  if (wire) {
    enterWireEdit(wire);
    return;
  }
  const instance = renderer.findInstance(project, world);
  if (instance) enterInstanceEdit(instance);
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (state.placement && event.shiftKey) return;
  const point = canvasPoint(event);
  renderer.zoomAt(point.x, point.y, Math.exp(-event.deltaY * 0.0015));
  state.viewCameras[viewKey()] = { ...renderer.camera };
  render();
}, { passive: false });
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("pointermove", updateAnnotationToolDrag);
window.addEventListener("pointermove", updateChipDragPreview);
window.addEventListener("pointerup", (event) => {
  finishAnnotationToolDrag(event);
  finishChipDrag(event);
});
window.addEventListener("pointercancel", (event) => {
  finishAnnotationToolDrag(event, true);
  finishChipDrag(event, true);
});
window.addEventListener("blur", () => { if (state.pointerSession) cancelActiveCanvasPointerSession(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && state.pointerSession) cancelActiveCanvasPointerSession(); });
window.addEventListener("resize", () => requestAnimationFrame(() => {
  hoverTooltipLayer.refresh(state.mouseScreen);
  updateCanvasInspectButton();
}));
window.addEventListener("pointerdown", commitProjectNameEditIfOutside, true);
window.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("#context-menu")) hideContextMenu();
  if (!event.target.closest("#bottom-menu-popup") && !event.target.closest("#bottom-menu")) closeBottomMenu();
  if (!event.target.closest("#collection-popup") && !event.target.closest("#collection-tabs")) closeCollectionPopup();
});
window.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea, select")) return;
  const source = simulationInteractionSource();
  project.keyValues[event.code] = true;
  project.keyValues[event.key] = true;
  previewKeyInteraction(event, "pressed", source);
  if (state.simRunning && !event.ctrlKey && !event.metaKey && event.key !== " " && event.key !== "Spacebar") simulationController.runStep();
});
window.addEventListener("keyup", (event) => {
  if (event.target.matches("input, textarea, select")) return;
  const source = simulationInteractionSource();
  project.keyValues[event.code] = false;
  project.keyValues[event.key] = false;
  previewKeyInteraction(event, "released", source);
  if (state.simRunning && !event.ctrlKey && !event.metaKey && event.key !== " " && event.key !== "Spacebar") simulationController.runStep();
});

$("#context-menu").addEventListener("click", (event) => {
  const action = event.target.closest("[data-context-action]")?.dataset.contextAction;
  if (!action) return;
  hideContextMenu();
  if (action === "open-custom") { const instance = project.root.instances.find((item) => state.selectedIds.has(String(item.id))); if (instance) enterCustomView(instance); }
  if (action === "toggle-input") { const instance = project.root.instances.find((item) => state.selectedIds.has(String(item.id))); if (instance) toggleInput(instance); }
  if (action === "set-pin-colour") setPinColour(event.target.closest("[data-context-action]")?.dataset.contextInstance, event.target.closest("[data-context-action]")?.dataset.contextPin, event.target.closest("[data-context-action]")?.dataset.contextColour);
  if (action === "rotate" || action === "rotate-cw") rotateSelection(1);
  if (action === "rotate-ccw") rotateSelection(-1);
  if (action === "flip-bus") flipBusSelection();
  if (action === "duplicate") duplicateSelection();
  if (action === "delete" || action === "delete-wire") deleteSelection();
  if (action === "edit-wire") {
    const wire = project.root.wires.find((item) => item.id === state.selectedWireId);
    if (wire) enterWireEdit(wire);
  }
  if (action === "edit-key" || action === "edit-rom" || action === "edit-pulse") {
    const field = action === "edit-key" ? "key" : action === "edit-rom" ? "rom" : "duration";
    $("#app").classList.add("inspector-open");
    requestAnimationFrame(() => document.querySelector(`#inspector [data-field="${field}"]`)?.focus());
    setStatus("Inspector ready.");
  }
  if (action === "edit-label") {
    $("#app").classList.add("inspector-open");
    requestAnimationFrame(() => document.querySelector('#inspector [data-field="label"]')?.focus());
    setStatus("Label editor ready.");
  }
  if (action === "edit-annotation") {
    $("#app").classList.add("inspector-open");
    requestAnimationFrame(() => document.querySelector('#inspector [data-field="annotation-text"]')?.focus());
    setStatus("Annotation editor ready.");
  }
});

async function hydrateProjectFromServer() {
  if (STATIC_MODE) return;
  try {
    const remote = await loadFromServer({ storageId: cachedProject?.storageId, latest: !cachedProject });
    if (!remote || (cachedProject ? project._revision !== state.savedRevision : project._revision !== 0)) return;
    const remoteTime = Date.parse(remote.updatedAt || "") || 0;
    const localTime = Date.parse(project.updatedAt || "") || 0;
    if (cachedProject && remoteTime <= localTime) return;
    project = remote;
    project._revision = 0;
    state.projectSaved = true;
    simulator = new Simulator(project);
    resetEditorStateForProject();
    renderer.fit(project);
    renderLibrary();
    render();
    setStatus("Loaded the latest saved project from JSON storage.");
  } catch {
    // The browser cache remains the immediate-start fallback when the API is not running.
  }
}

simulationController.resetBake();
renderLibrary();
renderer.fit(project);
render();
setStatus(state.status);
void hydrateProjectFromServer();

// Small debug surface for local smoke tests and future E2E tests.
globalThis.digitalLogicSim = { get project() { return project; }, get state() { return state; }, step: () => simulationController.runStep(), place: beginPlacement };
