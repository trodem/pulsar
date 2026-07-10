import { acceptHMRUpdate, defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api";
import { connectSocket, disconnectSocket } from "../socket";

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem("token"));
  const username = ref<string | null>(localStorage.getItem("username"));

  function setSession(t: string, u: string) {
    token.value = t;
    username.value = u;
    localStorage.setItem("token", t);
    localStorage.setItem("username", u);
    // Fresh login: signal the Monitors page to start with every group
    // collapsed. It clears this flag on mount, so the user's later
    // expand/collapse choices persist normally until the next login.
    localStorage.setItem("monitors.collapseAllOnLogin", "1");
    connectSocket(t);
  }

  async function checkSetup(): Promise<boolean> {
    const { data } = await api.get("/auth/status");
    return data.needsSetup;
  }

  async function setup(u: string, p: string) {
    const { data } = await api.post("/auth/setup", { username: u, password: p });
    setSession(data.token, data.username);
  }

  async function login(u: string, p: string) {
    const { data } = await api.post("/auth/login", { username: u, password: p });
    setSession(data.token, data.username);
  }

  function logout() {
    token.value = null;
    username.value = null;
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    disconnectSocket();
  }

  // Re-establish the socket on a page reload if already logged in.
  if (token.value) connectSocket(token.value);

  return { token, username, checkSetup, setup, login, logout };
});

// Let Vite hot-swap this store's actions during dev; without it, edits to
// setSession/login keep running the old code until a full page reload.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
}
