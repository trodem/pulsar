<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useMonitorStore } from "../stores/monitors";
import type { Monitor } from "../types";
import HeartbeatBar from "../components/HeartbeatBar.vue";
import MonitorForm from "../components/MonitorForm.vue";
import { ms, relTime, statusLabel, uptimePct } from "../format";

const store = useMonitorStore();
const router = useRouter();

const showForm = ref(false);
const editing = ref<Monitor | null>(null);

onMounted(async () => {
  await store.fetchAll();
  store.bindSocket();
});

const summary = computed(() => {
  const up = store.monitors.filter((m) => m.stats?.status === 1).length;
  const down = store.monitors.filter((m) => m.stats?.status === 0).length;
  return { up, down, total: store.monitors.length };
});

function openNew() {
  editing.value = null;
  showForm.value = true;
}

async function openEdit(m: Monitor) {
  editing.value = await store.get(m.id);
  showForm.value = true;
}

async function onSaved(payload: Partial<Monitor>) {
  if (editing.value) await store.update(editing.value.id, payload);
  else await store.create(payload);
  showForm.value = false;
}

async function remove(m: Monitor) {
  if (confirm(`Delete monitor "${m.name}"?`)) await store.remove(m.id);
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Dashboard</h1>
      <div class="muted">
        {{ summary.total }} monitors · {{ summary.up }} up · {{ summary.down }} down
      </div>
    </div>
    <button class="btn btn-primary" @click="openNew">+ New monitor</button>
  </div>

  <div v-if="store.monitors.length === 0" class="empty">
    <p>No monitors yet.</p>
    <button class="btn btn-primary" @click="openNew">Add your first monitor</button>
  </div>

  <div class="monitor-grid">
    <div v-for="m in store.monitors" :key="m.id" class="monitor-card">
      <div>
        <div class="monitor-top">
          <span class="status-pill" :class="statusLabel(m.stats?.status).cls">
            {{ statusLabel(m.stats?.status).text }}
          </span>
          <router-link :to="`/monitor/${m.id}`" class="monitor-name">
            {{ m.name }}
          </router-link>
          <span class="type-tag">{{ m.type }}</span>
          <span v-if="!m.active" class="muted">(paused)</span>
        </div>
        <div class="monitor-target">
          {{ m.target }}<span v-if="m.port">:{{ m.port }}</span>
        </div>
        <div style="margin-top: 12px">
          <HeartbeatBar :beats="m.heartbeats ?? []" />
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 12px; align-items: flex-end">
        <div class="monitor-meta">
          <div class="meta-block">
            <div class="label">24h uptime</div>
            <div class="value">{{ uptimePct(m.stats?.uptime24h) }}</div>
          </div>
          <div class="meta-block">
            <div class="label">Latency</div>
            <div class="value">{{ ms(m.stats?.avgPing) }}</div>
          </div>
          <div class="meta-block">
            <div class="label">Last check</div>
            <div class="value" style="font-size: 14px">
              {{ relTime(m.stats?.lastCheck) }}
            </div>
          </div>
        </div>
        <div class="monitor-actions">
          <button class="btn btn-sm" @click="store.toggle(m.id)">
            {{ m.active ? "Pause" : "Resume" }}
          </button>
          <button class="btn btn-sm" @click="openEdit(m)">Edit</button>
          <button class="btn btn-sm btn-danger" @click="remove(m)">Delete</button>
        </div>
      </div>
    </div>
  </div>

  <MonitorForm
    v-if="showForm"
    :monitor="editing"
    @close="showForm = false"
    @saved="onSaved"
  />
</template>
