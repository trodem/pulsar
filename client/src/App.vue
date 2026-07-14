<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "./stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const showShell = computed(() => route.name !== "login");

// Badge-Text/-Stil je Rolle: admin (Vollzugriff), editor (nur Projekte),
// sonst read-only.
const roleBadge = computed(() => {
  if (auth.role === "admin") return { label: "admin", cls: "role-admin" };
  if (auth.role === "editor") return { label: "editor", cls: "role-editor" };
  return { label: "read-only", cls: "role-user" };
});

const collapsed = ref(localStorage.getItem("sidebarCollapsed") === "1");
watch(collapsed, (v) => localStorage.setItem("sidebarCollapsed", v ? "1" : "0"));
function toggleSidebar() {
  collapsed.value = !collapsed.value;
}

function logout() {
  auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <div v-if="showShell" class="app-shell">
    <header class="app-header">
      <div class="brand">
        <img src="/assets/pulsar_logo.png" alt="Pulsar Logo" class="brand-logo" />
        Pulsar
      </div>
      <div class="header-right">
        <span class="muted">
          Signed in as <strong>{{ auth.username }}</strong>
          <span class="role-badge" :class="roleBadge.cls">
            {{ roleBadge.label }}
          </span>
        </span>
        <button class="btn btn-sm" @click="logout">Log out</button>
      </div>
    </header>

    <div class="app-body">
      <aside class="sidebar" :class="{ collapsed }">
        <button
          class="icon-btn sidebar-toggle"
          type="button"
          :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="toggleSidebar"
        >
          <svg v-if="collapsed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <router-link
          class="nav-link"
          :class="{ active: route.name === 'dashboard' }"
          to="/"
          title="Dashboard"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          <span class="nav-label">Dashboard</span>
        </router-link>
        <router-link
          class="nav-link"
          :class="{ active: route.name === 'monitors' }"
          to="/monitors"
          title="Monitors"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          <span class="nav-label">Monitors</span>
        </router-link>
        <router-link
          class="nav-link"
          :class="{ active: route.name === 'notifications' }"
          to="/notifications"
          title="Notifications"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span class="nav-label">Notifications</span>
        </router-link>
        <router-link
          class="nav-link"
          :class="{ active: route.name === 'maintenance' }"
          to="/maintenance"
          title="Maintenance"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
          <span class="nav-label">Maintenance</span>
        </router-link>
        <router-link
          class="nav-link"
          :class="{ active: route.name === 'projects' }"
          to="/projects"
          title="Projects"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span class="nav-label">Projects</span>
        </router-link>
        <router-link
          v-if="auth.isAdmin"
          class="nav-link"
          :class="{ active: route.name === 'settings' }"
          to="/settings"
          title="Settings"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span class="nav-label">Settings</span>
        </router-link>
      </aside>
      <main class="main">
        <router-view />
      </main>
    </div>
  </div>
  <router-view v-else />
</template>

<style scoped>
.role-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  vertical-align: middle;
}
.role-admin {
  background: rgba(79, 157, 255, 0.16);
  color: #4f9dff;
}
.role-editor {
  background: rgba(52, 199, 123, 0.16);
  color: #34c77b;
}
.role-user {
  background: rgba(148, 163, 184, 0.18);
  color: #94a3b8;
}
</style>
