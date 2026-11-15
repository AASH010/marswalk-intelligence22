import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend always calls relative paths (/api/v1/..., /tiles/..., /science/...,
// /health) so it never needs to know the backend's host. Both the dev server and
// the production preview forward them to FastAPI on port 8000.
const backendProxy = {
  "/tiles": {
    target: "http://localhost:8000",
    changeOrigin: true,
  },
  "/api": {
    target: "http://localhost:8000",
    changeOrigin: true,
  },
  "/science": {
    target: "http://localhost:8000",
    changeOrigin: true,
  },
  "/health": {
    target: "http://localhost:8000",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],

  server: {
    host: true,
    allowedHosts: true,
    proxy: backendProxy,
  },

  preview: {
    host: true,
    allowedHosts: true,
    proxy: backendProxy,
  },
});
