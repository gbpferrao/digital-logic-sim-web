import { clone, normalizeProject, uid } from "../model.js";

const API_ROOT = "/api";
export const LAST_SERVER_PROJECT_KEY = "digital-logic-sim-web:last-server-project";

function cleanProject(project) {
  const saved = clone(project);
  delete saved._revision;
  delete saved._simSnapshot;
  return saved;
}

function projectStorageId(project) {
  const existing = String(project?.storageId || "").trim();
  if (existing) return existing;
  return `${String(project?.name || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"}-${uid("local").slice(-8)}`;
}

function encodeProject(project) {
  const exported = cleanProject(project);
  exported.updatedAt = new Date().toISOString();
  return JSON.stringify(exported, null, 2);
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

export async function saveProjectToServer(project) {
  const id = projectStorageId(project);
  const saved = await apiRequest(`/projects/${encodeURIComponent(id)}`, { method: "PUT", body: encodeProject(project) });
  localStorage.setItem(LAST_SERVER_PROJECT_KEY, id);
  return normalizeProject(saved);
}

export async function loadProjectFromServer({ storageId = null, latest = false } = {}) {
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
  return project;
}
