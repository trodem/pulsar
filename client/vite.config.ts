import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Flag "Online-Benutzer ausblenden": aktiv, wenn der Dev-Server mit
// `npm run dev --nousers` gestartet wird. npm legt für unbekannte Flags eine
// Config-Variable an, die als `npm_config_nousers` in der Umgebung landet.
const hideUsers = !!process.env.npm_config_nousers;

export default defineConfig({
  plugins: [vue()],
  // Wird zur Build-/Dev-Zeit als globale Konstante in den Code ersetzt.
  define: {
    __HIDE_USERS__: JSON.stringify(hideUsers),
  },
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