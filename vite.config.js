import { defineConfig } from "vite";

const apiPort = Number(process.env.DLS_API_PORT) || 5174;

export default defineConfig({
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  }
});
