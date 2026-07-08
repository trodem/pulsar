<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMonitorStore } from "../stores/monitors";
import { getSocket } from "../socket";
import type { Heartbeat, Monitor } from "../types";
import HeartbeatBar from "../components/HeartbeatBar.vue";
import { ms, relTime, statusLabel, uptimePct } from "../format";

const route = useRoute();
const router = useRouter();
const store = useMonitorStore();

const monitor = ref<Monitor | null>(null);
const beats = ref<Heartbeat[]>([]);
const id = Number(route.params.id);

function onHeartbeat(p: { monitorId: number; heartbeat: Heartbeat }) {
  if (p.monitorId !== id) return;
  beats.value = [...beats.value, p.heartbeat].slice(-100);
  if (monitor.value) {
    monitor.value.stats = {
      ...(monitor.value.stats as any),
      status: p.heartbeat.status,
      lastMessage: p.heartbeat.message,
      lastCheck: p.heartbeat.time,
    };
  }
}

onMounted(async () => {
  monitor.value = await store.get(id);
  beats.value = monitor.value.heartbeats ?? [];
  getSocket()?.on("heartbeat", onHeartbeat);
});

onUnmounted(() => {
  getSocket()?.off("heartbeat", onHeartbeat);
});

// Important beats = state transitions, shown as an event log.
const events = computed(() =>
  [...beats.value].reverse().filter((b) => b.important).slice(0, 30),
);
</script>

<template>
  <div v-if="monitor">
    <div class="page-head">
      <div>
        <h1 style="display: flex; align-items: center; gap: 12px">
          <span class="status-pill" :class="statusLabel(monitor.stats?.status).cls">
            {{ statusLabel(monitor.stats?.status).text }}
          </span>
          {{ monitor.name }}
        </h1>
        <div class="muted">
          {{ monitor.type.toUpperCase() }} · {{ monitor.target
          }}<span v-if="monitor.port">:{{ monitor.port }}</span> · every
          {{ monitor.interval }}s
        </div>
      </div>
      <button class="btn" @click="router.push('/')">← Back</button>
    </div>

    <div class="stat-cards">
      <div class="stat-card">
        <div class="label">Current status</div>
        <div class="big" :style="{ color: monitor.stats?.status === 1 ? 'var(--up)' : monitor.stats?.status === 2 ? 'var(--degraded)' : monitor.stats?.status === 0 ? 'var(--down)' : 'var(--pending)' }">
          {{ statusLabel(monitor.stats?.status).text }}
        </div>
      </div>
      <div class="stat-card">
        <div class="label">24h uptime</div>
        <div class="big">{{ uptimePct(monitor.stats?.uptime24h) }}</div>
      </div>
      <div class="stat-card">
        <div class="label">Avg latency</div>
        <div class="big">{{ ms(monitor.stats?.avgPing) }}</div>
      </div>
      <div class="stat-card">
        <div class="label">Last check</div>
        <div class="big" style="font-size: 18px">
          {{ relTime(monitor.stats?.lastCheck) }}
        </div>
      </div>
    </div>

    <h3>Recent heartbeats</h3>
    <div class="stat-card" style="margin-bottom: 24px">
      <HeartbeatBar :beats="beats" :slots="100" />
      <div class="muted" style="margin-top: 10px">
        {{ monitor.stats?.lastMessage }}
      </div>
    </div>

    <h3>Events</h3>
    <div v-if="events.length === 0" class="muted">No status changes recorded yet.</div>
    <div v-else class="event-list">
      <div v-for="e in events" :key="e.id" class="event-row">
        <span class="status-pill" :class="statusLabel(e.status).cls">
          {{ statusLabel(e.status).text }}
        </span>
        <span>{{ e.message }}</span>
        <span class="event-time">{{ new Date(e.time * 1000).toLocaleString() }}</span>
      </div>
    </div>
  </div>
  <div v-else class="empty">Loading…</div>
</template>
