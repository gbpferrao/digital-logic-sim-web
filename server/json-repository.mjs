import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SERVER_DIR, "..");
export const STORAGE_DIR = path.join(PROJECT_DIR, "storage");

function cleanProject(value) {
  const project = JSON.parse(JSON.stringify(value || {}));
  delete project._revision;
  delete project._simSnapshot;
  return project;
}

export function createJsonRepository({ storageDir = STORAGE_DIR } = {}) {
  const projectsDir = path.join(storageDir, "projects");
  const chipsDir = path.join(storageDir, "chips");
  const projectFile = (id) => path.join(projectsDir, `${id}.json`);
  const chipFile = (id) => path.join(chipsDir, `${id}.json`);

  async function ensure() {
    await mkdir(projectsDir, { recursive: true });
    await mkdir(chipsDir, { recursive: true });
  }

  async function readJson(file) {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async function writeJson(file, value) {
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  }

  async function listJsonFiles(directory) {
    const names = await readdir(directory);
    return names.filter((name) => name.endsWith(".json"));
  }

  async function listProjects() {
    const files = await listJsonFiles(projectsDir);
    const records = await Promise.all(files.map(async (file) => {
      const id = file.slice(0, -5);
      const project = await readJson(path.join(projectsDir, file));
      if (!project) return null;
      return { id, name: project.name || id, updatedAt: project.updatedAt || null, customChipCount: Object.keys(project.customChips || {}).length };
    }));
    return records.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function listChips() {
    const files = await listJsonFiles(chipsDir);
    const records = await Promise.all(files.map(async (file) => {
      const id = file.slice(0, -5);
      const record = await readJson(path.join(chipsDir, file));
      if (!record) return null;
      return { id, name: record.name || id, updatedAt: record.updatedAt || null };
    }));
    return records.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function getProject(id) { return readJson(projectFile(id)); }
  async function getChip(id) { return readJson(chipFile(id)); }

  async function saveProject(id, value) {
    const project = cleanProject(value);
    project.schema ||= "digital-logic-sim-web/1";
    project.storageId = id;
    project.updatedAt = new Date().toISOString();
    await writeJson(projectFile(id), project);
    for (const [name, description] of Object.entries(project.customChips || {})) {
      const chipId = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chip";
      await writeJson(chipFile(chipId), { schema: "digital-logic-sim-web/chip/1", name, updatedAt: project.updatedAt, description });
    }
    return project;
  }

  async function saveChip(id, value) {
    const description = value?.description ?? value;
    const record = { schema: "digital-logic-sim-web/chip/1", name: value?.name || description?.name || id, updatedAt: new Date().toISOString(), description };
    await writeJson(chipFile(id), record);
    return record;
  }

  return { storageDir, projectsDir, chipsDir, ensure, listProjects, listChips, getProject, getChip, saveProject, saveChip };
}
