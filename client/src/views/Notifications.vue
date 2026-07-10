<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useNotificationStore } from "../stores/notifications";
import { useAuthStore } from "../stores/auth";
import type { Notification } from "../types";

const store = useNotificationStore();
const auth = useAuthStore();
// Read-only accounts can view notifications but not create/edit/delete them.
const isAdmin = computed(() => auth.isAdmin);

const showForm = ref(false);
const editingId = ref<number | null>(null);
const error = ref("");
const testMsg = ref("");

const form = reactive<{
  name: string;
  type: "webhook" | "telegram";
  config: Record<string, any>;
  active: boolean;
}>({
  name: "",
  type: "webhook",
  config: {},
  active: true,
});

onMounted(() => store.fetchAll());

function openNew() {
  editingId.value = null;
  form.name = "";
  form.type = "webhook";
  form.config = {};
  form.active = true;
  error.value = "";
  testMsg.value = "";
  showForm.value = true;
}

function openEdit(n: Notification) {
  editingId.value = n.id;
  form.name = n.name;
  form.type = n.type;
  form.config = { ...n.config };
  form.active = n.active;
  error.value = "";
  testMsg.value = "";
  showForm.value = true;
}

async function save() {
  error.value = "";
  if (!form.name.trim()) {
    error.value = "Name is required.";
    return;
  }
  const payload = {
    name: form.name,
    type: form.type,
    config: form.config,
    active: form.active,
  };
  try {
    if (editingId.value) await store.update(editingId.value, payload);
    else await store.create(payload);
    showForm.value = false;
  } catch (e: any) {
    error.value = e.response?.data?.error ?? "Save failed";
  }
}

async function sendTest() {
  testMsg.value = "";
  try {
    await store.test(form.type, form.config);
    testMsg.value = "Test sent ✓";
  } catch (e: any) {
    testMsg.value = e.response?.data?.error ?? "Test failed";
  }
}

async function remove(n: Notification) {
  if (confirm(`Delete notification "${n.name}"?`)) await store.remove(n.id);
}
</script>

<template>
  <div class="page-head">
    <h1>Notifications</h1>
    <button v-if="isAdmin" class="btn btn-primary" @click="openNew">+ New notification</button>
  </div>

  <div v-if="store.items.length === 0" class="empty">
    No notification channels configured.
  </div>

  <div class="monitor-grid">
    <div v-for="n in store.items" :key="n.id" class="monitor-card">
      <div>
        <div class="monitor-top">
          <span class="monitor-name">{{ n.name }}</span>
          <span class="type-tag">{{ n.type }}</span>
          <span v-if="!n.active" class="muted">(disabled)</span>
        </div>
        <div class="monitor-target">
          {{ n.type === "webhook" ? n.config.url : `chat ${n.config.chatId ?? "?"}` }}
        </div>
      </div>
      <div class="monitor-actions">
        <button v-if="isAdmin" class="btn btn-sm" @click="openEdit(n)">Edit</button>
        <button v-if="isAdmin" class="btn btn-sm btn-danger" @click="remove(n)">Delete</button>
      </div>
    </div>
  </div>

  <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
    <div class="modal">
      <h2>{{ editingId ? "Edit notification" : "New notification" }}</h2>
      <div v-if="error" class="error-msg">{{ error }}</div>

      <div class="field">
        <label>Name</label>
        <input v-model="form.name" placeholder="My webhook" />
      </div>
      <div class="field">
        <label>Type</label>
        <select v-model="form.type">
          <option value="webhook">Webhook</option>
          <option value="telegram">Telegram</option>
        </select>
      </div>

      <template v-if="form.type === 'webhook'">
        <div class="field">
          <label>Webhook URL</label>
          <input v-model="form.config.url" placeholder="https://…" />
        </div>
      </template>

      <template v-else>
        <div class="field">
          <label>Bot token</label>
          <input v-model="form.config.botToken" placeholder="123456:ABC…" />
        </div>
        <div class="field">
          <label>Chat ID</label>
          <input v-model="form.config.chatId" placeholder="123456789" />
        </div>
      </template>

      <div class="checkbox-row field">
        <input type="checkbox" v-model="form.active" id="n-active" />
        <label for="n-active" style="margin: 0">Active</label>
      </div>

      <div v-if="testMsg" class="muted" style="margin-bottom: 10px">{{ testMsg }}</div>

      <div class="modal-actions">
        <button class="btn" @click="sendTest">Send test</button>
        <button class="btn" @click="showForm = false">Cancel</button>
        <button class="btn btn-primary" @click="save">Save</button>
      </div>
    </div>
  </div>
</template>
