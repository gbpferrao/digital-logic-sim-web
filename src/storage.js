import { clone, normalizeProject } from "./model.js";
import { readProjectFile } from "./io/project-import.js";
import { LAST_SERVER_PROJECT_KEY, loadProjectFromServer, saveProjectToServer } from "./io/storage-client.js";

export { readProjectFile };

const STORAGE_KEY = "digital-logic-sim-web:project";

function cleanProject(project) {
  const saved = clone(project);
  deleteRuntimeFields(saved);
  return saved;
}

function cacheProject(project) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanProject(project)));
}

export async function saveToServer(project) {
  const saved = await saveProjectToServer(project);
  cacheProject(saved);
  return saved;
}

export async function loadFromServer(options = {}) {
  const project = await loadProjectFromServer(options);
  if (project) cacheProject(project);
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

function deleteRuntimeFields(project) {
  delete project._revision;
  delete project._simSnapshot;
}
