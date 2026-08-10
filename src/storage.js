import { TYPE, clone, instanceFor, normalizeProject, uid } from "./model.js";
import { convertUnityChipFile, convertUnityProject } from "./unity-compat.js";

const STORAGE_KEY = "digital-logic-sim-web:project";
const LAST_SERVER_PROJECT_KEY = "digital-logic-sim-web:last-server-project";
const API_ROOT = "/api";

function cleanProject(project) {
  const saved = clone(project);
  deleteRuntimeFields(saved);
  return saved;
}

function cacheProject(project) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanProject(project)));
}

function projectStorageId(project) {
  const existing = String(project?.storageId || "").trim();
  if (existing) return existing;
  return `${String(project?.name || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"}-${uid("local").slice(-8)}`;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers ?? {}) }
  });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const error = new Error(errorBody.error || `Storage request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

export async function saveToServer(project) {
  const id = projectStorageId(project);
  const saved = await apiRequest(`/projects/${encodeURIComponent(id)}`, { method: "PUT", body: encodeProject(project) });
  localStorage.setItem(LAST_SERVER_PROJECT_KEY, id);
  return normalizeProject(saved);
}

export async function loadFromServer({ storageId = null, latest = false } = {}) {
  const id = storageId || localStorage.getItem(LAST_SERVER_PROJECT_KEY);
  let raw = null;
  if (id && !latest) {
    try { raw = await apiRequest(`/projects/${encodeURIComponent(id)}`); }
    catch (error) { if (error.status !== 404) throw error; }
  }
  if (!raw && (latest || !id)) {
    try { raw = await apiRequest("/projects/latest"); }
    catch (error) { if (error.status !== 404) throw error; }
  }
  if (!raw) return null;
  const project = normalizeProject(raw);
  localStorage.setItem(LAST_SERVER_PROJECT_KEY, projectStorageId(project));
  cacheProject(project);
  return project;
}

export function saveToBrowser(project) {
  const saved = cleanProject(project);
  saved.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  if (saved.storageId) localStorage.setItem(LAST_SERVER_PROJECT_KEY, saved.storageId);
  return saved;
}

export function loadFromBrowser() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return normalizeProject(JSON.parse(raw)); } catch { return null; }
}

export function encodeProject(project) {
  const exported = cleanProject(project);
  exported.updatedAt = new Date().toISOString();
  return JSON.stringify(exported, null, 2);
}

export function downloadProject(project) {
  const blob = new Blob([encodeProject(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(project.name || "digital-logic-project").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readProjectFile(file) {
  const text = await file.text();
  const raw = JSON.parse(text);
  if (raw?.schema === "digital-logic-sim-web/1" || raw?.root) return normalizeProject(raw);
  const unityChip = convertUnityChipFile(raw);
  if (unityChip) {
    const project = normalizeProject({ name: unityChip.name, root: { ...unityChip, id: "root" }, customChips: {} });
    exposeImportedChipPins(project);
    return project;
  }
  if (raw?.ProjectName) return normalizeProject(convertUnityProject(raw));
  throw new Error("The file is not a recognized Digital Logic Sim project or chip description.");
}

export async function readProjectFiles(files) {
  const entries = await Promise.all([...files].filter((file) => file.name.toLowerCase().endsWith(".json")).map(async (file) => ({ file, raw: JSON.parse(await file.text()) })));
  const projectRaw = entries.find((entry) => entry.raw?.ProjectName)?.raw;
  const project = normalizeProject(projectRaw ? convertUnityProject(projectRaw) : { name: "Imported Unity project" });
  for (const entry of entries) {
    const chip = convertUnityChipFile(entry.raw);
    if (!chip) continue;
    if (chip.name === "#") project.root = { ...chip, id: "root" };
    else project.customChips[chip.name] = chip;
  }
  if (project.root.inputPins.length || project.root.outputPins.length) exposeImportedChipPins(project);
  return project;
}

function deleteRuntimeFields(project) {
  delete project._revision;
  delete project._simSnapshot;
}

function exposeImportedChipPins(project) {
  const root = project.root;
  const endpointMap = new Map();
  const terminal = (pin, input) => {
    const name = input ? (pin.bits === 8 ? TYPE.IN_8 : pin.bits === 4 ? TYPE.IN_4 : TYPE.IN_1) : (pin.bits === 8 ? TYPE.OUT_8 : pin.bits === 4 ? TYPE.OUT_4 : TYPE.OUT_1);
    const position = { x: (input ? -1 : 1) * (root.size.x / 2 + 35), y: pin.y ?? 0 };
    const instance = instanceFor(name, position);
    instance.id = uid(input ? "imported-in" : "imported-out");
    root.instances.push(instance);
    endpointMap.set(`${pin.id}:${input ? "source" : "target"}`, { owner: instance.id, pin: "0" });
    if (input) project.inputValues[instance.id] = 0;
  };
  for (const pin of root.inputPins) terminal(pin, true);
  for (const pin of root.outputPins) terminal(pin, false);
  root.wires = root.wires.map((wire) => ({
    ...wire,
    source: wire.source.owner === "root" ? endpointMap.get(`${wire.source.pin}:source`) ?? wire.source : wire.source,
    target: wire.target.owner === "root" ? endpointMap.get(`${wire.target.pin}:target`) ?? wire.target : wire.target
  }));
  root.inputPins = [];
  root.outputPins = [];
}
