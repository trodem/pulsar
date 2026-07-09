<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "./stores/auth";
import { useMonitorStore } from "./stores/monitors";
import { useUiStore } from "./stores/ui";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const monitors = useMonitorStore();
const ui = useUiStore();

const showShell = computed(() => route.name !== "login");

async function newMonitor() {
  if (route.name !== "dashboard") await router.push("/");
  ui.requestNewMonitor();
}

async function refreshAll() {
  await monitors.fetchAll();
}

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
      <div class="brand"><span class="dot"></span> Pulsar</div>
      <div class="header-right">
        <span class="muted">Signed in as <strong>{{ auth.username }}</strong></span>
        <button class="btn btn-sm" @click="logout">Log out</button>
      </div>
    </header>

    <div class="app-toolbar">
      <button class="btn btn-primary btn-sm" @click="newMonitor">+ New monitor</button>
      <button
        class="btn btn-sm"
        :disabled="monitors.loading"
        @click="refreshAll"
      >
        {{ monitors.loading ? "⏳ Refreshing…" : "↻ Refresh" }}
      </button>
    </div>

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
          :class="{ active: route.name === 'settings' }"
          to="/settings"
          title="Groups & Tags"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
          <span class="nav-label">Groups &amp; Tags</span>
        </router-link>
      </aside>
      <main class="main">
        <router-view />
      </main>
    </div>
  </div>
  <router-view v-else />
</template>
