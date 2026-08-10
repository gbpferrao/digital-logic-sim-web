import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonRepository } from "./json-repository.mjs";

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

export async function startStorageServer({ host = "127.0.0.1", port = 5174, quiet = false } = {}) {
  const repository = createJsonRepository();
  await repository.ensure();
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
      if (parts[1] === "health" && request.method === "GET") { sendJson(response, 200, { ok: true, storage: "json", directory: repository.storageDir }); return; }

      if (parts[1] === "projects") {
        if (request.method === "GET" && parts.length === 2) { sendJson(response, 200, await repository.listProjects()); return; }
        if (request.method === "GET" && parts[2] === "latest") {
          const latest = (await repository.listProjects())[0];
          if (!latest) { sendJson(response, 404, { error: "No saved projects." }); return; }
          sendJson(response, 200, await repository.getProject(latest.id));
          return;
        }
        const id = safeId(decodeSegment(parts[2]));
        if (!id) { sendJson(response, 400, { error: "Invalid project id." }); return; }
        if (request.method === "GET") {
          const project = await repository.getProject(id);
          if (!project) { sendJson(response, 404, { error: "Project not found." }); return; }
          sendJson(response, 200, project);
          return;
        }
        if (request.method === "PUT" || request.method === "POST") { sendJson(response, 200, await repository.saveProject(id, await readBody(request))); return; }
      }

      if (parts[1] === "chips") {
        if (request.method === "GET" && parts.length === 2) { sendJson(response, 200, await repository.listChips()); return; }
        const id = safeId(decodeSegment(parts[2]));
        if (!id) { sendJson(response, 400, { error: "Invalid chip id." }); return; }
        if (request.method === "GET") {
          const chip = await repository.getChip(id);
          if (!chip) { sendJson(response, 404, { error: "Chip not found." }); return; }
          sendJson(response, 200, chip);
          return;
        }
        if (request.method === "PUT" || request.method === "POST") { sendJson(response, 200, await repository.saveChip(id, await readBody(request))); return; }
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, Number(error.status) || 500, { error: error.message || "Storage server error." });
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  if (!quiet) console.log(`JSON storage API listening at http://${host}:${port}`);
  return { server, host, port, directory: repository.storageDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DLS_API_PORT) || 5174;
  const running = await startStorageServer({ port });
  const close = () => running.server.close(() => process.exit(0));
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
