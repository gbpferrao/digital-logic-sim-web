import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStorageServer } from "./api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiPort = Number(process.env.DLS_API_PORT) || 5174;
const webPort = Number(process.env.DLS_WEB_PORT) || 5173;
const storage = await startStorageServer({ port: apiPort });
const vite = spawn(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(webPort)], {
  cwd: root,
  env: { ...process.env, DLS_API_PORT: String(apiPort) },
  stdio: "inherit"
});

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!vite.killed) vite.kill();
  await new Promise((resolve) => storage.server.close(resolve));
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
vite.on("exit", (code) => shutdown(code ?? 0));
