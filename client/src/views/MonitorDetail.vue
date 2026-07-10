<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMonitorStore } from "../stores/monitors";
import { getSocket } from "../socket";
import type { Heartbeat, LogFileEntry, Monitor } from "../types";
import HeartbeatBar from "../components/HeartbeatBar.vue";
import MonitorForm from "../components/MonitorForm.vue";
import { fileSize, ms, relTime, statusLabel, uptimePct } from "../format";

const route = useRoute();
const router = useRouter();
const store = useMonitorStore();

const monitor = ref<Monitor | null>(null);
const beats = ref<Heartbeat[]>([]);
const id = Number(route.params.id);

// Adjustable heartbeat-bar scale: how many hours (1..24) the bar spans. The
// beats within that window are binned into one bar per fixed slice of time
// (BUCKET_MINUTES), so the number of bars grows with the window: a wide scale
// shows many thin bars, a narrow scale shows few wide ones — all filling the
// card's width.
const BUCKET_MINUTES = 10;
const rangeHours = ref(6);

// How many bars the current window is split into (one per BUCKET_MINUTES).
const slotCount = computed(() =>
  Math.round((rangeHours.value * 60) / BUCKET_MINUTES),
);

// Fetch the heartbeats for the currently selected window from the server.
async function loadBeats() {
  beats.value = await store.heartbeatsSince(id, rangeHours.value);
}

// Bin `beats` into `slotCount` equal time buckets spanning [now - range, now].
// Each bucket collapses to the worst status it saw (down > degraded >
// maintenance > up); empty buckets become null placeholders.
const severity: Record<number, number> = { 0: 3, 2: 2, 3: 1, 1: 0 };
const bucketedBeats = computed<(Heartbeat | null)[]>(() => {
  const slots = slotCount.value;
  const nowSec = Date.now() / 1000;
  const spanSec = rangeHours.value * 3600;
  const start = nowSec - spanSec;
  const width = spanSec / slots;
  const buckets: (Heartbeat | null)[] = Array.from({ length: slots }, () => null);
  for (const b of beats.value) {
    const idx = Math.floor((b.time - start) / width);
    if (idx < 0 || idx >= slots) continue;
    const cur = buckets[idx];
    // Keep the most severe beat; on a tie prefer the most recent one.
    if (
      !cur ||
      severity[b.status] > severity[cur.status] ||
      (severity[b.status] === severity[cur.status] && b.time > cur.time)
    ) {
      buckets[idx] = b;
    }
  }
  return buckets;
});

// Human label for the current scale (e.g. "6h", "1h").
const rangeLabel = computed(() => `${rangeHours.value}h`);

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

// "Online users" button state: whether a remote-log read is in flight. The
// result lives on the local `monitor` ref (this view holds its own copy fetched
// via store.get, not the store's list), so we update it directly.
const checkingUsers = ref(false);
async function checkUsers() {
  if (!monitor.value) return;
  checkingUsers.value = true;
  try {
    const { users, error } = await store.checkUsers(id);
    monitor.value.users = users;
    monitor.value.usersError = error;
  } catch (e: any) {
    monitor.value.usersError =
      e?.response?.data?.error ?? "Could not read the remote log.";
  } finally {
    checkingUsers.value = false;
  }
}

// Pause/resume this monitor, then refresh the local copy so the toolbox and
// header reflect the new active state.
async function toggleActive() {
  await store.toggle(id);
  monitor.value = await store.get(id);
}

function openWebPage(m: Monitor) {
  window.open(m.target, "_blank", "noopener");
}

// Edit modal state. On save we re-fetch the monitor to pick up the changes.
const showForm = ref(false);
async function onSaved(payload: Partial<Monitor>) {
  await store.update(id, payload);
  showForm.value = false;
  monitor.value = await store.get(id);
}

async function remove() {
  if (!monitor.value) return;
  if (confirm(`Delete monitor "${monitor.value.name}"?`)) {
    await store.remove(id);
    router.push("/");
  }
}

// Log-files modal (mirrors the monitors list). Kept alongside the hidden
// toolbox button so re-enabling it stays consistent across both views.
interface LogModal {
  name: string;
  folder: string;
  files: LogFileEntry[];
  loading: boolean;
  error: string;
}
const logModal = ref<LogModal | null>(null);
async function showLogFiles(m: Monitor) {
  logModal.value = { name: m.name, folder: "", files: [], loading: true, error: "" };
  try {
    const { folder, files } = await store.logFiles(m.id);
    logModal.value = { name: m.name, folder, files, loading: false, error: "" };
  } catch (e: any) {
    logModal.value = {
      name: m.name,
      folder: "",
      files: [],
      loading: false,
      error: e?.response?.data?.error ?? "Could not read the log folder.",
    };
  }
}

function onHeartbeat(p: { monitorId: number; heartbeat: Heartbeat }) {
  if (p.monitorId !== id) return;
  // Append and drop anything now older than the selected window so the bar
  // stays bounded even for wide (24h) scales with many beats.
  const cutoff = Date.now() / 1000 - rangeHours.value * 3600;
  beats.value = [...beats.value, p.heartbeat].filter((b) => b.time >= cutoff);
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
  await loadBeats();
  getSocket()?.on("heartbeat", onHeartbeat);
});

// Reload the window whenever the user changes the scale.
watch(rangeHours, loadBeats);

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
      <div class="detail-actions">
        <span
          v-if="restartMsg"
          class="muted"
          :style="{ color: restartMsg.ok ? 'var(--up)' : 'var(--down)' }"
          :title="restartMsg.text"
        >
          {{ restartMsg.ok ? "✓" : "⚠" }} {{ restartMsg.text }}
        </span>
        <div class="monitor-actions">
          <button
            class="btn btn-sm"
            title="Back to the monitors list"
            @click="router.push('/monitors')"
          >
            ← Back
          </button>
          <button
            v-if="monitor.type === 'http' || monitor.type === 'http-ping'"
            class="btn btn-sm"
            title="Open the monitored page in a new tab"
            @click="openWebPage(monitor)"
          >
            🌐 Open
          </button>
          <!-- Remote Desktop temporarily hidden (pending IT review of the
               launch mechanism): remove v-if="false" to re-enable. -->
          <button
            v-if="false"
            class="btn btn-sm"
            title="Open a Remote Desktop login to this host"
            @click="openRemoteDesktop(monitor)"
          >
            🖥️ Remote Desktop
          </button>
          <button
            v-if="monitor.type === 'http-ping'"
            class="btn btn-sm"
            title="Read the remote log and list the logged-in users"
            :disabled="checkingUsers"
            @click="checkUsers"
          >
            {{ checkingUsers ? "⏳ Checking…" : "👥 Online users" }}
          </button>
          <!-- Log files temporarily hidden: set v-if back to
               monitor.type === 'http-ping' to re-enable. -->
          <button
            v-if="false"
            class="btn btn-sm"
            title="List the files in the remote log folder"
            @click="showLogFiles(monitor)"
          >
            📁 Log files
          </button>
          <!-- Restart temporarily hidden: set v-if back to
               monitor.type === 'http-ping' to re-enable. -->
          <button
            v-if="false"
            class="btn btn-sm"
            title="Stop and restart the STAP backend on the host"
            :disabled="restarting"
            @click="restartProgram"
          >
            {{ restarting ? "⏳ Restarting…" : "🔄 Restart" }}
          </button>
          <button
            class="btn btn-sm"
            :title="monitor.active ? 'Pause monitoring' : 'Resume monitoring'"
            @click="toggleActive"
          >
            {{ monitor.active ? "⏸️ Pause" : "▶️ Resume" }}
          </button>
          <button class="btn btn-sm" title="Edit this monitor" @click="showForm = true">
            ✏️ Edit
          </button>
          <button class="btn btn-sm btn-danger" title="Delete this monitor" @click="remove">
            🗑️ Delete
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="monitor.type === 'http-ping' && (monitor.users || monitor.usersError)"
      class="stat-card"
      style="margin-bottom: 16px"
    >
      <div v-if="monitor.users?.length" class="monitor-users">
        <span class="label">Online Users:</span>
        <span v-for="u in monitor.users" :key="u" class="user-chip">{{ u }}</span>
      </div>
      <div v-else-if="monitor.users && !monitor.usersError" class="monitor-users">
        <span class="label">Online Users:</span>
        <span class="muted">No users</span>
      </div>
      <div v-if="monitor.usersError" class="monitor-users-error" :title="monitor.usersError">
        ⚠ Online Users: {{ monitor.usersError }}
      </div>
    </div>

    <div class="stat-cards">
      <div class="stat-card">
        <div class="label">Current status</div>
        <div class="big" :style="{ color: monitor.stats?.status === 1 ? 'var(--up)' : monitor.stats?.status === 2 ? 'var(--degraded)' : monitor.stats?.status === 3 ? 'var(--maintenance)' : monitor.stats?.status === 0 ? 'var(--down)' : 'var(--pending)' }">
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

    <div class="hb-head">
      <h3>Recent heartbeats</h3>
      <div class="hb-scale">
        <span class="hb-scale-label">Scale</span>
        <input
          v-model.number="rangeHours"
          type="range"
          min="1"
          max="24"
          step="1"
          class="hb-scale-range"
        />
        <span class="hb-scale-value">{{ rangeLabel }}</span>
      </div>
    </div>
    <div class="stat-card" style="margin-bottom: 24px">
      <HeartbeatBar :beats="bucketedBeats" :slots="slotCount" />
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

  <MonitorForm
    v-if="showForm && monitor"
    :monitor="monitor"
    @close="showForm = false"
    @saved="onSaved"
  />

  <div v-if="logModal" class="modal-backdrop" @click.self="logModal = null">
    <div class="modal">
      <h2>Log files — {{ logModal.name }}</h2>
      <div
        v-if="logModal.folder"
        class="muted"
        style="margin-bottom: 14px; word-break: break-all; font-size: 12px"
      >
        {{ logModal.folder }}
      </div>

      <div v-if="logModal.loading" class="muted">Loading…</div>
      <div v-else-if="logModal.error" class="error-msg">{{ logModal.error }}</div>
      <div v-else-if="logModal.files.length === 0" class="muted">
        The folder is empty.
      </div>
      <table v-else class="log-files-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Size</th>
            <th>Modified</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in logModal.files" :key="f.name">
            <td>{{ f.name }}</td>
            <td>{{ fileSize(f.size) }}</td>
            <td>{{ relTime(f.modified) }}</td>
          </tr>
        </tbody>
      </table>

      <div class="modal-actions">
        <button class="btn" @click="logModal = null">Close</button>
      </div>
    </div>
  </div>
</template>
