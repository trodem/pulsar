import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "../api";
import { connectSocket, disconnectSocket } from "../socket";

export type Role = "admin" | "user";

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string | null>(localStorage.getItem("token"));
  const username = ref<string | null>(localStorage.getItem("username"));
  const role = ref<Role>(
    localStorage.getItem("role") === "admin" ? "admin" : "user",
  );

  // Admins have full access; "user" accounts are read-only. Used across the UI
  // to hide mutating controls (the server also enforces this — see requireWrite).
  const isAdmin = computed(() => role.value === "admin");

  function setSession(t: string, u: string, r: Role) {
    token.value = t;
    username.value = u;
    role.value = r;
    localStorage.setItem("token", t);
    localStorage.setItem("username", u);
    localStorage.setItem("role", r);
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
    setSession(data.token, data.username, data.role ?? "admin");
  }

  async function login(u: string, p: string) {
    const { data } = await api.post("/auth/login", { username: u, password: p });
    setSession(data.token, data.username, data.role ?? "user");
  }

  function logout() {
    token.value = null;
    username.value = null;
    role.value = "user";
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("role");
    disconnectSocket();
  }

  // Re-establish the socket on a page reload if already logged in.
  if (token.value) connectSocket(token.value);

  return { token, username, role, isAdmin, checkSetup, setup, login, logout };
});

// Let Vite hot-swap this store's actions during dev; without it, edits to
// setSession/login keep running the old code until a full page reload.
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
}
