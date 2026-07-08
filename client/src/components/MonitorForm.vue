<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import type { Monitor } from "../types";
import { useNotificationStore } from "../stores/notifications";

const props = defineProps<{ monitor?: Monitor | null }>();
const emit = defineEmits<{ close: []; saved: [payload: Partial<Monitor>] }>();

const notificationStore = useNotificationStore();
const error = ref("");
const saving = ref(false);

const form = reactive<Partial<Monitor>>({
  name: props.monitor?.name ?? "",
  type: props.monitor?.type ?? "http",
  target: props.monitor?.target ?? "",
  port: props.monitor?.port ?? null,
  interval: props.monitor?.interval ?? 60,
  timeout: props.monitor?.timeout ?? 10,
  retries: props.monitor?.retries ?? 0,
  acceptedStatus: props.monitor?.acceptedStatus ?? "200-299",
  method: props.monitor?.method ?? "GET",
  active: props.monitor?.active ?? true,
  notificationIds: props.monitor?.notificationIds ?? [],
});

onMounted(() => notificationStore.fetchAll());

function toggleNotification(id: number) {
  const list = form.notificationIds ?? [];
  form.notificationIds = list.includes(id)
    ? list.filter((x) => x !== id)
    : [...list, id];
}

async function save() {
  error.value = "";
  if (!form.name?.trim() || !form.target?.trim()) {
    error.value = "Name and target are required.";
    return;
  }
  if (form.type === "tcp" && !form.port) {
    error.value = "TCP monitors need a port.";
    return;
  }
  saving.value = true;
  try {
    // Coerce numeric fields.
    const payload: Partial<Monitor> = {
      ...form,
      port: form.type === "tcp" ? Number(form.port) || null : null,
      interval: Number(form.interval),
      timeout: Number(form.timeout),
      retries: Number(form.retries),
    };
    emit("saved", payload);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <h2>{{ props.monitor ? "Edit monitor" : "New monitor" }}</h2>

      <div v-if="error" class="error-msg">{{ error }}</div>

      <div class="field">
        <label>Friendly name</label>
        <input v-model="form.name" placeholder="My website" />
      </div>

      <div class="field-row">
        <div class="field">
          <label>Type</label>
          <select v-model="form.type">
            <option value="http">HTTP(s)</option>
            <option value="tcp">TCP Port</option>
            <option value="ping">Ping</option>
          </select>
        </div>
        <div class="field" v-if="form.type === 'tcp'">
          <label>Port</label>
          <input v-model.number="form.port" type="number" placeholder="443" />
        </div>
      </div>

      <div class="field">
        <label>{{ form.type === "http" ? "URL" : "Hostname / IP" }}</label>
        <input
          v-model="form.target"
          :placeholder="form.type === 'http' ? 'https://example.com' : 'example.com'"
        />
      </div>

      <div class="field-row" v-if="form.type === 'http'">
        <div class="field">
          <label>Method</label>
          <select v-model="form.method">
            <option>GET</option>
            <option>HEAD</option>
            <option>POST</option>
          </select>
        </div>
        <div class="field">
          <label>Accepted status codes</label>
          <input v-model="form.acceptedStatus" placeholder="200-299" />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label>Interval (s)</label>
          <input v-model.number="form.interval" type="number" min="5" />
        </div>
        <div class="field">
          <label>Timeout (s)</label>
          <input v-model.number="form.timeout" type="number" min="1" />
        </div>
        <div class="field">
          <label>Retries</label>
          <input v-model.number="form.retries" type="number" min="0" />
        </div>
      </div>

      <div class="field" v-if="notificationStore.items.length">
        <label>Notifications</label>
        <div
          v-for="n in notificationStore.items"
          :key="n.id"
          class="checkbox-row"
          style="margin-bottom: 6px"
        >
          <input
            type="checkbox"
            :checked="form.notificationIds?.includes(n.id)"
            @change="toggleNotification(n.id)"
          />
          <span>{{ n.name }} <span class="muted">({{ n.type }})</span></span>
        </div>
      </div>

      <div class="checkbox-row field">
        <input type="checkbox" v-model="form.active" id="active" />
        <label for="active" style="margin: 0">Active</label>
      </div>

      <div class="modal-actions">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? "Saving…" : "Save" }}
        </button>
      </div>
    </div>
  </div>
</template>
