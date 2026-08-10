import http from "node:http";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SERVER_DIR, "..");
const STORAGE_DIR = path.join(PROJECT_DIR, "storage");
const PROJECTS_DIR = path.join(STORAGE_DIR, "projects");
const CHIPS_DIR = path.join(STORAGE_DIR, "chips");
const MAX_BODY_BYTES = 24 * 1024 * 1024;

function jsonHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { ...jsonHeaders(), "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

function safeId(value) {
  const id = String(value || "");
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id) ? id : null;
}

function decodeSegment(value) {
  try { return decodeURIComponent(value); } catch { return null; }
}

function projectFile(id) { return path.join(PROJECTS_DIR, `${id}.json`); }
function chipFile(id) { return path.join(CHIPS_DIR, `${id}.json`); }

async function ensureStorage() {
  await mkdir(PROJECTS_DIR, { recursive: true });
  await mkdir(CHIPS_DIR, { recursive: true });
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

function cleanProject(value) {
  const project = JSON.parse(JSON.stringify(value || {}));
  delete project._revision;
  delete project._simSnapshot;
  return project;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function listJsonFiles(directory) {
  const names = await readdir(directory);
  return names.filter((name) => name.endsWith(".json"));
}

async function listProjects() {
  const files = await listJsonFiles(PROJECTS_DIR);
  const records = await Promise.all(files.map(async (file) => {
    const id = file.slice(0, -5);
    const project = await readJson(path.join(PROJECTS_DIR, file));
    if (!project) return null;
    return { id, name: project.name || id, updatedAt: project.updatedAt || null, customChipCount: Object.keys(project.customChips || {}).length };
  }));
  return records.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function listChips() {
  const files = await listJsonFiles(CHIPS_DIR);
  const records = await Promise.all(files.map(async (file) => {
    const id = file.slice(0, -5);
    const record = await readJson(path.join(CHIPS_DIR, file));
    if (!record) return null;
    return { id, name: record.name || id, updatedAt: record.updatedAt || null };
  }));
  return records.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

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

export async function startStorageServer({ host = "127.0.0.1", port = 5174, quiet = false } = {}) {
  await ensureStorage();
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, jsonHeaders());
      response.end();
      return;
    }
    try {
      const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "api") { sendJson(response, 404, { error: "Not found" }); return; }
      if (parts[1] === "health" && request.method === "GET") { sendJson(response, 200, { ok: true, storage: "json", directory: STORAGE_DIR }); return; }

      if (parts[1] === "projects") {
        if (request.method === "GET" && parts.length === 2) { sendJson(response, 200, await listProjects()); return; }
        if (request.method === "GET" && parts[2] === "latest") {
          const latest = (await listProjects())[0];
          if (!latest) { sendJson(response, 404, { error: "No saved projects." }); return; }
          sendJson(response, 200, await readJson(projectFile(latest.id)));
          return;
        }
        const id = safeId(decodeSegment(parts[2]));
        if (!id) { sendJson(response, 400, { error: "Invalid project id." }); return; }
        if (request.method === "GET") {
          const project = await readJson(projectFile(id));
          if (!project) { sendJson(response, 404, { error: "Project not found." }); return; }
          sendJson(response, 200, project);
          return;
        }
        if (request.method === "PUT" || request.method === "POST") { sendJson(response, 200, await saveProject(id, await readBody(request))); return; }
      }

      if (parts[1] === "chips") {
        if (request.method === "GET" && parts.length === 2) { sendJson(response, 200, await listChips()); return; }
        const id = safeId(decodeSegment(parts[2]));
        if (!id) { sendJson(response, 400, { error: "Invalid chip id." }); return; }
        if (request.method === "GET") {
          const chip = await readJson(chipFile(id));
          if (!chip) { sendJson(response, 404, { error: "Chip not found." }); return; }
          sendJson(response, 200, chip);
          return;
        }
        if (request.method === "PUT" || request.method === "POST") { sendJson(response, 200, await saveChip(id, await readBody(request))); return; }
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, Number(error.status) || 500, { error: error.message || "Storage server error." });
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  if (!quiet) console.log(`JSON storage API listening at http://${host}:${port}`);
  return { server, host, port, directory: STORAGE_DIR };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DLS_API_PORT) || 5174;
  const running = await startStorageServer({ port });
  const close = () => running.server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
