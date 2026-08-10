import { BUILTINS, GRID, TYPE, getDescription, uid } from "./model.js";

const SCALE = 20;

function point(value, fallback = { x: 0, y: 0 }) {
  return { x: Number(value?.x ?? fallback.x) * SCALE, y: Number(value?.y ?? fallback.y) * SCALE };
}

function colour(value, fallback = "#202b3a") {
  if (!value || typeof value !== "object") return fallback;
  const r = Math.round(Math.max(0, Math.min(1, Number(value.r ?? 0))) * 255).toString(16).padStart(2, "0");
  const g = Math.round(Math.max(0, Math.min(1, Number(value.g ?? 0))) * 255).toString(16).padStart(2, "0");
  const b = Math.round(Math.max(0, Math.min(1, Number(value.b ?? 0))) * 255).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function pin(raw, direction) {
  return {
    id: String(raw.ID), name: raw.Name || direction.toUpperCase(), bits: Number(raw.BitCount) || 1, direction,
    x: Number(raw.Position?.x ?? 0) * SCALE, y: Number(raw.Position?.y ?? 0) * SCALE,
    valueDisplay: Number(raw.ValueDisplayMode) === 3 ? "hex" : Number(raw.ValueDisplayMode) === 1 ? "unsigned" : Number(raw.ValueDisplayMode) === 2 ? "signed" : "off",
    colour: "red"
  };
}

function internalData(raw) {
  const values = Array.isArray(raw.InternalData) ? raw.InternalData.map(Number) : [];
  const name = raw.Name || "";
  if (name === TYPE.ROM) return { memory: Array.from({ length: 256 }, (_, i) => values[i] ?? 0) };
  if (name === TYPE.KEY) return { key: values.length ? String.fromCharCode(values[0]) : "Space" };
  if (name === TYPE.PULSE) return { duration: values[0] ?? 4, remaining: values[1] ?? 0, previous: values[2] ?? 0 };
  if (name === TYPE.RAM) return { memory: Array.from({ length: 256 }, (_, i) => values[i] ?? 0), lastClock: 0 };
  return {};
}

function convertWire(raw, rootPinIds) {
  const endpoint = (value) => {
    const owner = String(value?.PinOwnerID ?? "root");
    return rootPinIds.has(owner)
      ? { owner: "root", pin: owner }
      : { owner, pin: String(value?.PinID ?? 0) };
  };
  return {
    id: uid("wire"), source: endpoint(raw.SourcePinAddress), target: endpoint(raw.TargetPinAddress),
    points: (raw.Points ?? []).slice(1, -1).map((value) => point(value))
  };
}

export function convertUnityChip(raw, fallbackName = "Imported chip") {
  const inputPins = (raw.InputPins ?? []).map((item) => pin(item, "input"));
  const outputPins = (raw.OutputPins ?? []).map((item) => pin(item, "output"));
  const rootPinIds = new Set([...inputPins, ...outputPins].map((item) => String(item.id)));
  const instances = (raw.SubChips ?? []).map((item) => ({
    id: String(item.ID), name: item.Name, position: point(item.Position), rotation: Number(item.Rotation ?? 0), label: item.Label ?? "",
    internalData: internalData(item), linkedBusPairId: null, outputPinColours: {}
  }));
  const sourceSize = raw.Size ?? { x: 12, y: 8 };
  const width = Math.max(GRID * 12, Math.abs(Number(sourceSize.x) || 12) * SCALE);
  const height = Math.max(GRID * 8, Math.abs(Number(sourceSize.y) || 8) * SCALE);
  const description = {
    id: uid("chip"), name: raw.Name || fallbackName, type: TYPE.CUSTOM, kind: "custom", size: { x: width, y: height }, colour: colour(raw.Colour),
    nameLocation: Number(raw.NameLocation) === 2 ? "hidden" : Number(raw.NameLocation) === 1 ? "top" : "centre",
    inputPins, outputPins, instances, wires: (raw.Wires ?? []).map((item) => convertWire(item, rootPinIds)), displays: raw.Displays ?? []
  };
  return description;
}

export function convertUnityChipFile(raw) {
  if (raw?.schema === "digital-logic-sim-web/1" || raw?.root) return null;
  if (raw?.Name && Array.isArray(raw?.SubChips) && Array.isArray(raw?.Wires)) return convertUnityChip(raw, raw.Name);
  return null;
}

export function convertUnityProject(raw, name = "Imported Unity project") {
  const project = {
    name: raw.ProjectName || name,
    schema: "digital-logic-sim-web/1",
    createdAt: raw.CreationTime || new Date().toISOString(),
    updatedAt: raw.LastSaveTime || new Date().toISOString(),
    root: { id: "root", name: "Main", type: TYPE.CUSTOM, kind: "custom", size: { x: GRID * 32, y: GRID * 22 }, colour: "#202b3a", nameLocation: "top", inputPins: [], outputPins: [], instances: [], wires: [], displays: [] },
    customChips: {},
    collections: (raw.ChipCollections ?? []).map((collection) => ({ name: collection.Name, chips: collection.Chips ?? [] })),
    starred: (raw.StarredList ?? []).filter((item) => !item.IsCollection).map((item) => item.Name),
    settings: { snapping: Number(raw.Prefs_Snapping ?? 1) !== 0, straightWires: Number(raw.Prefs_StraightWires ?? 0) !== 0, grid: Number(raw.Prefs_GridDisplayMode ?? 1) !== 0, simulationPaused: Boolean(raw.Prefs_SimPaused ?? true), stepsPerSecond: Number(raw.Prefs_SimTargetStepsPerSecond ?? 8), stepsPerClock: Number(raw.Prefs_SimStepsPerClockTick ?? 8) },
    inputValues: {}, keyValues: {}
  };
  return project;
}
