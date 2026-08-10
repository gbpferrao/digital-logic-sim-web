import { defineConfig } from "vite";

const apiPort = Number(process.env.DLS_API_PORT) || 5174;
const repositoryName = String(process.env.GITHUB_REPOSITORY || "").split("/").filter(Boolean).at(-1);
const pagesBase = repositoryName?.endsWith(".github.io") ? "/" : repositoryName ? `/${repositoryName}/` : "/";

export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE_PATH || (mode === "pages" ? pagesBase : "/"),
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  }
}));
