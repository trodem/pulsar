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

// "Restart" button state: whether a restart is in flight, and the last outcome
// shown next to the button (empty = nothing to show yet).
const restarting = ref(false);
const restartMsg = ref<{ ok: boolean; text: string } | null>(null);

// Stops and restarts the remote STAP backend for this monitor (or starts it if
// it was not running).
async function restartProgram() {
  restarting.value = true;
  restartMsg.value = null;
  try {
    const { message } = await store.restartProgram(id);
    restartMsg.value = { ok: true, text: message || "Restarted" };
  } catch (e: any) {
    restartMsg.value = {
      ok: false,
      text: e?.response?.data?.error ?? "Could not restart the program.",
    };
  } finally {
    restarting.value = false;
  }
}

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

// Hostname of the monitor's target: the URL host for http(-ping), else the bare
// "host" / "host:port" target with any port/path stripped.
function hostOf(m: Monitor): string {
  try {
    return new URL(m.target).hostname || m.target;
  } catch {
    return m.target.split("/")[0].split(":")[0].trim();
  }
}

// Opens Windows Remote Desktop (mstsc) straight to the host via the custom
// pulsar-rdp: URL protocol, which each PC registers once (see public/
// pulsar-rdp.reg). A browser can't launch mstsc itself, so the protocol handler
// runs it locally on the user's machine and the login dialog appears there.
function openRemoteDesktop(m: Monitor) {
  const host = hostOf(m);
  if (!host) return;
  window.location.href = `pulsar-rdp:${host}`;
}

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
      <div style="display: flex; align-items: center; gap: 12px">
        <span
          v-if="restartMsg"
          class="muted"
          :style="{ color: restartMsg.ok ? 'var(--up)' : 'var(--down)' }"
          :title="restartMsg.text"
        >
          {{ restartMsg.ok ? "✓" : "⚠" }} {{ restartMsg.text }}
        </span>
        <button
          class="btn"
          title="Open a Remote Desktop login to this host (needs the one-time pulsar-rdp setup)"
          @click="openRemoteDesktop(monitor)"
        >
          🖥️ Remote Desktop
        </button>
        <!-- Restart temporarily hidden: set v-if back to monitor.type === 'http-ping' to re-enable. -->
        <button
          v-if="false"
          class="btn"
          title="Stop and restart the STAP backend on the host (starts it if not running)"
          :disabled="restarting"
          @click="restartProgram"
        >
          {{ restarting ? "⏳ Restarting…" : "🔄 Restart" }}
        </button>
        <button class="btn" @click="router.push('/')">← Back</button>
      </div>
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
