import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Prüft, ob eine Umgebungsvariable "gesetzt" ist (nicht leer, nicht "0"/"false").
function isEnvFlag(value: string | undefined): boolean {
  return (
    value !== undefined &&
    value !== "" &&
    value !== "0" &&
    value.toLowerCase() !== "false"
  );
}

// Flag "Online-Benutzer ausblenden". Zwei Wege, beide führen hierher:
//   1. PULSAR_NO_USERS=1 — der robuste Weg, von den Skripten gesetzt
//      (deploy.ps1 -NoUsers, dev.sh --nousers).
//   2. `npm run dev --nousers` — Komfort für den direkten Aufruf; npm legt
//      dafür die Config-Variable `npm_config_nousers` an. npm verwirft diesen
//      Weg in einer künftigen Major-Version (Warnung), daher nur als Fallback.
const hideUsers =
  isEnvFlag(process.env.PULSAR_NO_USERS) ||
  isEnvFlag(process.env.npm_config_nousers);

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