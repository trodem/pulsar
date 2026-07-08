<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "./stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const showShell = computed(() => route.name !== "login");

function logout() {
  auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <div v-if="showShell" class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="dot"></span> Uptime Clone</div>
      <router-link
        class="nav-link"
        :class="{ active: route.name === 'dashboard' }"
        to="/"
        >Dashboard</router-link
      >
      <router-link
        class="nav-link"
        :class="{ active: route.name === 'notifications' }"
        to="/notifications"
        >Notifications</router-link
      >
      <div class="sidebar-footer">
        <div class="muted" style="margin-bottom: 8px">
          Signed in as <strong>{{ auth.username }}</strong>
        </div>
        <button class="btn btn-sm" @click="logout">Log out</button>
      </div>
    </aside>
    <main class="main">
      <router-view />
    </main>
  </div>
  <router-view v-else />
</template>
