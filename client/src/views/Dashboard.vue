<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useMonitorStore } from "../stores/monitors";
import type { Monitor } from "../types";
import { ms, uptimePct } from "../format";

const store = useMonitorStore();

// Aggregate up/degraded/down/paused counts and 24h uptime / latency averages
// over the given monitors.
function computeStats(monitors: Monitor[]) {
  const up = monitors.filter((m) => m.stats?.status === 1).length;
  const degraded = monitors.filter((m) => m.stats?.status === 2).length;
  const maintenance = monitors.filter((m) => m.stats?.status === 3).length;
  const down = monitors.filter((m) => m.stats?.status === 0).length;
  const paused = monitors.filter((m) => !m.active).length;

  const uptimes = monitors
    .map((m) => m.stats?.uptime24h)
    .filter((v): v is number => v != null);
  const avgUptime = uptimes.length
    ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length
    : null;

  const pings = monitors
    .map((m) => m.stats?.avgPing)
    .filter((v): v is number => v != null);
  const avgPing = pings.length
    ? pings.reduce((a, b) => a + b, 0) / pings.length
    : null;

  return { up, degraded, maintenance, down, paused, total: monitors.length, avgUptime, avgPing };
}

const summary = computed(() => computeStats(store.monitors));

onMounted(async () => {
  await store.fetchAll();
  store.bindSocket();
});
</script>

<template>
  <div class="page-head">
    <h1>Dashboard</h1>
  </div>

  <div v-if="store.monitors.length > 0" class="stat-cards">
    <div class="stat-card">
      <span class="label">Monitors</span>
      <span class="big">{{ summary.total }}</span>
    </div>
    <div class="stat-card">
      <span class="label">Up</span>
      <span class="big" style="color: var(--up)">{{ summary.up }}</span>
    </div>
    <div v-if="summary.degraded" class="stat-card">
      <span class="label">Degraded</span>
      <span class="big" style="color: var(--degraded)">{{ summary.degraded }}</span>
    </div>
    <div v-if="summary.maintenance" class="stat-card">
      <span class="label">Maintenance</span>
      <span class="big" style="color: var(--maintenance)">{{ summary.maintenance }}</span>
    </div>
    <div class="stat-card">
      <span class="label">Down</span>
      <span class="big" style="color: var(--down)">{{ summary.down }}</span>
    </div>
    <div v-if="summary.paused" class="stat-card">
      <span class="label">Paused</span>
      <span class="big" style="color: var(--text-dim)">{{ summary.paused }}</span>
    </div>
    <div class="stat-card">
      <span class="label">Avg 24h uptime</span>
      <span class="big">{{ uptimePct(summary.avgUptime) }}</span>
    </div>
    <div class="stat-card">
      <span class="label">Avg latency</span>
      <span class="big">{{ ms(summary.avgPing) }}</span>
    </div>
  </div>

  <div v-else class="empty">
    <p>No monitors yet.</p>
  </div>
</template>
