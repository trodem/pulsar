<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();

const needsSetup = ref(false);
const username = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

onMounted(async () => {
  try {
    needsSetup.value = await auth.checkSetup();
  } catch {
    /* backend may be down; leave as login */
  }
});

async function submit() {
  error.value = "";
  busy.value = true;
  try {
    if (needsSetup.value) {
      await auth.setup(username.value, password.value);
    } else {
      await auth.login(username.value, password.value);
    }
    router.push({ name: "dashboard" });
  } catch (e: any) {
    error.value = e.response?.data?.error ?? "Something went wrong";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" @submit.prevent="submit">
      <h1><span class="dot" style="width:14px;height:14px;border-radius:50%;background:var(--up);display:inline-block"></span> Uptime Clone</h1>
      <p class="auth-sub">
        {{ needsSetup ? "Create your admin account to get started." : "Sign in to your dashboard." }}
      </p>

      <div v-if="error" class="error-msg">{{ error }}</div>

      <div class="field">
        <label>Username</label>
        <input v-model="username" autocomplete="username" required />
      </div>
      <div class="field">
        <label>Password</label>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </div>
      <button class="btn btn-primary" style="width: 100%" :disabled="busy">
        {{ busy ? "Please wait…" : needsSetup ? "Create account" : "Log in" }}
      </button>
    </form>
  </div>
</template>
