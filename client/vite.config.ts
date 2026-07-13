import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true, // Ti permette di esporre il server in rete locale automaticamente
    allowedHosts: ["star0002210001m"], // Risolve l'errore "This host is not allowed"
    port: 5173,
    proxy: {
      // Proxy API + websocket to the backend during development.
      "/api": { target: "http://localhost:3021", changeOrigin: true },
      "/socket.io": {
        target: "http://localhost:3021",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});