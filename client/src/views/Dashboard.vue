<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useMonitorStore } from "../stores/monitors";
import { useGroupStore } from "../stores/groups";
import { useTagStore } from "../stores/tags";
import { useUiStore } from "../stores/ui";
import type { LogFileEntry, Monitor } from "../types";
import HeartbeatBar from "../components/HeartbeatBar.vue";
import MonitorForm from "../components/MonitorForm.vue";
import { fileSize, ms, relTime, statusLabel, uptimePct } from "../format";

const store = useMonitorStore();
const groupStore = useGroupStore();
const tagStore = useTagStore();
const ui = useUiStore();
const router = useRouter();

// Section keys the user has collapsed. Persisted so the layout survives reloads.
// Key is the group id as a string, or "ungrouped" for the catch-all section.
const COLLAPSED_KEY = "dashboard.collapsedGroups";
const collapsed = ref<Set<string>>(
  new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]")),
);

function sectionKey(id: number | null): string {
  return id == null ? "ungrouped" : String(id);
}

function toggleSection(id: number | null) {
  const key = sectionKey(id);
  const next = new Set(collapsed.value);
  next.has(key) ? next.delete(key) : next.add(key);
  collapsed.value = next;
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
}

// Search text and tag filter both live in the global toolbar and are shared
// through the UI store. A monitor must match both. Empty filter = no filter.
const filteredMonitors = computed(() => {
  const q = ui.monitorSearch.trim().toLowerCase();
  const tagIds = ui.activeTagIds;
  return store.monitors.filter((m) => {
    const tagOk =
      tagIds.size === 0 ||
      (m.tags ?? []).some((t) => tagIds.has(t.id));
    const searchOk =
      q === "" ||
      m.name.toLowerCase().includes(q) ||
      m.target.toLowerCase().includes(q) ||
      (m.tags ?? []).some((t) => t.name.toLowerCase().includes(q));
    return tagOk && searchOk;
  });
});

// Aggregate up/degraded/down counts and 24h uptime / latency averages over an
// arbitrary set of monitors. Shared by the global summary and each group header.
function computeStats(monitors: Monitor[]) {
  const up = monitors.filter((m) => m.stats?.status === 1).length;
  const degraded = monitors.filter((m) => m.stats?.status === 2).length;
  const down = monitors.filter((m) => m.stats?.status === 0).length;

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

  return { up, degraded, down, total: monitors.length, avgUptime, avgPing };
}

// Monitors split into dashboard sections: one per group (in the group store's
// order), then an "Ungrouped" section. Empty sections are dropped. Each section
// carries its own aggregate stats, shown inline on the group header.
const sections = computed(() => {
  const list = filteredMonitors.value;
  const out: {
    id: number | null;
    name: string;
    monitors: Monitor[];
    stats: ReturnType<typeof computeStats>;
  }[] = [];
  for (const g of groupStore.items) {
    const monitors = list.filter((m) => m.groupId === g.id);
    if (monitors.length)
      out.push({ id: g.id, name: g.name, monitors, stats: computeStats(monitors) });
  }
  const ungrouped = list.filter((m) => m.groupId == null);
  if (ungrouped.length) {
    out.push({
      id: null,
      name: "Ungrouped",
      monitors: ungrouped,
      stats: computeStats(ungrouped),
    });
  }
  return out;
});

// The global toolbar's "+ New monitor" button opens this page's form.
watch(
  () => ui.newMonitorRequests,
  () => openNew(),
);

const showForm = ref(false);
const editing = ref<Monitor | null>(null);

interface LogModal {
  name: string;
  folder: string;
  files: LogFileEntry[];
  loading: boolean;
  error: string;
}
const logModal = ref<LogModal | null>(null);

// Monitor ids whose remote log is currently being read (button spinner state).
const checkingUsers = ref<Set<number>>(new Set());

async function checkUsers(m: Monitor) {
  checkingUsers.value = new Set(checkingUsers.value).add(m.id);
  try {
    await store.checkUsers(m.id);
  } catch (e: any) {
    const target = store.monitors.find((x) => x.id === m.id);
    if (target) {
      target.usersError =
        e?.response?.data?.error ?? "Could not read the remote log.";
    }
  } finally {
    const next = new Set(checkingUsers.value);
    next.delete(m.id);
    checkingUsers.value = next;
  }
}

onMounted(async () => {
  await Promise.all([
    store.fetchAll(),
    groupStore.fetchAll(),
    tagStore.fetchAll(),
  ]);
  store.bindSocket();
});

const summary = computed(() => computeStats(store.monitors));

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

function openWebPage(m: Monitor) {
  window.open(m.target, "_blank", "noopener");
}

async function showLogFiles(m: Monitor) {
  logModal.value = {
    name: m.name,
    folder: "",
    files: [],
    loading: true,
    error: "",
  };
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
</script>

<template>
  <div class="page-head">
    <div>
      <h1>Dashboard</h1>
      <div class="muted">
        {{ summary.total }} monitors · {{ summary.up }} up ·
        <template v-if="summary.degraded">{{ summary.degraded }} degraded · </template>{{ summary.down }} down
      </div>
    </div>
  </div>

  <div v-if="store.monitors.length > 0" class="stat-cards">
    <div class="stat-card">
      <div class="label">Monitors</div>
      <div class="big">{{ summary.total }}</div>
    </div>
    <div class="stat-card">
      <div class="label">Up</div>
      <div class="big" style="color: var(--up)">{{ summary.up }}</div>
    </div>
    <div v-if="summary.degraded" class="stat-card">
      <div class="label">Degraded</div>
      <div class="big" style="color: var(--degraded)">{{ summary.degraded }}</div>
    </div>
    <div class="stat-card">
      <div class="label">Down</div>
      <div class="big" style="color: var(--down)">{{ summary.down }}</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg 24h uptime</div>
      <div class="big">{{ uptimePct(summary.avgUptime) }}</div>
    </div>
    <div class="stat-card">
      <div class="label">Avg latency</div>
      <div class="big">{{ ms(summary.avgPing) }}</div>
    </div>
  </div>

  <div v-if="store.monitors.length === 0" class="empty">
    <p>No monitors yet.</p>
    <button class="btn btn-primary" @click="openNew">Add your first monitor</button>
  </div>

  <div v-else-if="sections.length === 0" class="empty">
    <p>No monitors match the current filters.</p>
  </div>

  <div v-for="section in sections" :key="section.id ?? 'ungrouped'" class="monitor-section">
    <div
      class="section-head"
      role="button"
      tabindex="0"
      @click="toggleSection(section.id)"
      @keydown.enter.prevent="toggleSection(section.id)"
      @keydown.space.prevent="toggleSection(section.id)"
    >
      <span class="section-caret" :class="{ collapsed: collapsed.has(sectionKey(section.id)) }">▾</span>
      <h2>{{ section.name }}</h2>
      <span class="muted">{{ section.monitors.length }}</span>
      <div class="section-stats">
        <span class="section-stat" style="color: var(--up)" title="Up">
          ● {{ section.stats.up }}
        </span>
        <span
          v-if="section.stats.degraded"
          class="section-stat"
          style="color: var(--degraded)"
          title="Degraded"
        >
          ● {{ section.stats.degraded }}
        </span>
        <span class="section-stat" style="color: var(--down)" title="Down">
          ● {{ section.stats.down }}
        </span>
        <span class="section-stat muted" title="Average 24h uptime">
          {{ uptimePct(section.stats.avgUptime) }} uptime
        </span>
        <span class="section-stat muted" title="Average latency">
          {{ ms(section.stats.avgPing) }}
        </span>
      </div>
    </div>
    <div v-if="!collapsed.has(sectionKey(section.id))" class="monitor-grid">
      <div v-for="m in section.monitors" :key="m.id" class="monitor-card">
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
        <div v-if="m.tags?.length" class="monitor-tags">
          <span
            v-for="t in m.tags"
            :key="t.id"
            class="tag-chip readonly"
            :style="{ background: t.color, borderColor: t.color }"
          >
            {{ t.name }}
          </span>
        </div>
        <div v-if="m.users?.length" class="monitor-users">
          <span class="label">Users:</span>
          <span v-for="u in m.users" :key="u" class="user-chip">{{ u }}</span>
        </div>
        <div
          v-else-if="m.users && !m.usersError"
          class="monitor-users"
        >
          <span class="label">Users:</span>
          <span class="muted">No users</span>
        </div>
        <div v-if="m.usersError" class="monitor-users-error" :title="m.usersError">
          ⚠ Users: {{ m.usersError }}
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
          <button
            v-if="m.type === 'http' || m.type === 'http-ping'"
            class="btn btn-sm"
            title="Open the monitored URL in a new tab"
            @click="openWebPage(m)"
          >
            🌐 Open
          </button>
          <button
            v-if="m.type === 'http-ping'"
            class="btn btn-sm"
            title="Read the full remote log now and refresh the logged-in users"
            :disabled="checkingUsers.has(m.id)"
            @click="checkUsers(m)"
          >
            {{ checkingUsers.has(m.id) ? "⏳ Checking…" : "👥 Check users" }}
          </button>
          <button
            v-if="m.type === 'http-ping'"
            class="btn btn-sm"
            title="Show the files in the remote log folder"
            @click="showLogFiles(m)"
          >
            📁 Log files
          </button>
          <button class="btn btn-sm" @click="store.toggle(m.id)">
            {{ m.active ? "Pause" : "Resume" }}
          </button>
          <button class="btn btn-sm" @click="openEdit(m)">Edit</button>
          <button class="btn btn-sm btn-danger" @click="remove(m)">Delete</button>
        </div>
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
