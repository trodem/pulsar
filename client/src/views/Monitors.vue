<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useMonitorStore } from "../stores/monitors";
import { useGroupStore } from "../stores/groups";
import { useTagStore } from "../stores/tags";
import { useUiStore } from "../stores/ui";
import type { LogFileEntry, Monitor } from "../types";
import MonitorForm from "../components/MonitorForm.vue";
import { fileSize, ms, relTime, statusLabel, uptimePct } from "../format";

const store = useMonitorStore();
const groupStore = useGroupStore();
const tagStore = useTagStore();
const ui = useUiStore();

// Section keys the user has collapsed. Persisted so the layout survives reloads.
// Key is the group id as a string, or "ungrouped" for the catch-all section.
// Kept separate from the Dashboard so the two pages collapse independently.
const COLLAPSED_KEY = "monitors.collapsedGroups";
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

// The status filter chips shown in the toolbar, in display order. Codes match
// the heartbeat status values (1 up, 2 degraded, 3 maintenance, 0 down).
const statusFilters = [
  { value: 1, label: "Up", color: "var(--up)" },
  { value: 2, label: "Degraded", color: "var(--degraded)" },
  { value: 3, label: "Maintenance", color: "var(--maintenance)" },
  { value: 0, label: "Down", color: "var(--down)" },
] as const;

// Search text, tag filter and status filter all live in the UI store so they
// survive navigation. A monitor must match all three. Empty filter = no filter.
const filteredMonitors = computed(() => {
  const q = ui.monitorSearch.trim().toLowerCase();
  const tagIds = ui.activeTagIds;
  const statuses = ui.activeStatuses;
  return store.monitors.filter((m) => {
    const tagOk =
      tagIds.size === 0 ||
      (m.tags ?? []).some((t) => tagIds.has(t.id));
    const statusOk =
      statuses.size === 0 || statuses.has(m.stats?.status ?? -1);
    const searchOk =
      q === "" ||
      m.name.toLowerCase().includes(q) ||
      m.target.toLowerCase().includes(q) ||
      (m.tags ?? []).some((t) => t.name.toLowerCase().includes(q));
    return tagOk && statusOk && searchOk;
  });
});

// Aggregate up/degraded/down counts and 24h uptime / latency averages over an
// arbitrary set of monitors. Shown inline on each group header.
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

// Monitors split into sections: one per group (in the group store's order),
// then an "Ungrouped" section. Empty sections are dropped. Each section carries
// its own aggregate stats, shown inline on the group header.
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

const showForm = ref(false);
const editing = ref<Monitor | null>(null);

// Whether the toolbar's status-filter dropdown is open.
const statusMenuOpen = ref(false);

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

// Monitor ids whose remote program is currently being restarted (spinner state).
const restarting = ref<Set<number>>(new Set());

// Stops and restarts the remote STAP backend for a monitor (or starts it if it
// was not running). Surfaces the outcome on the card's user-error line.
async function restartProgram(m: Monitor) {
  restarting.value = new Set(restarting.value).add(m.id);
  try {
    await store.restartProgram(m.id);
    const target = store.monitors.find((x) => x.id === m.id);
    if (target) target.usersError = null;
  } catch (e: any) {
    const target = store.monitors.find((x) => x.id === m.id);
    if (target) {
      target.usersError =
        e?.response?.data?.error ?? "Could not restart the program.";
    }
  } finally {
    const next = new Set(restarting.value);
    next.delete(m.id);
    restarting.value = next;
  }
}

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

// Reads the remote log for every http-ping monitor in a group at once. Non
// http-ping monitors have no remote users, so they are skipped. Each check
// reuses checkUsers, so per-monitor spinner state and errors still apply.
async function checkGroupUsers(monitors: Monitor[]) {
  const targets = monitors.filter((m) => m.type === "http-ping");
  await Promise.all(targets.map((m) => checkUsers(m)));
}

onMounted(async () => {
  await Promise.all([
    store.fetchAll(),
    groupStore.fetchAll(),
    tagStore.fetchAll(),
  ]);
  store.bindSocket();
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

function openWebPage(m: Monitor) {
  window.open(m.target, "_blank", "noopener");
}

// Hostname of a monitor's target: the URL host for http(-ping), else the bare
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
    <h1>Monitors</h1>
    <div class="page-actions">
      <div class="status-filter-dd">
        <button
          type="button"
          class="btn btn-sm"
          :class="{ active: ui.activeStatuses.size }"
          title="Filter monitors by status"
          @click="statusMenuOpen = !statusMenuOpen"
        >
          Status
          <span v-if="ui.activeStatuses.size" class="filter-badge">
            {{ ui.activeStatuses.size }}
          </span>
          <span class="caret">▾</span>
        </button>
        <template v-if="statusMenuOpen">
          <div class="status-menu-backdrop" @click="statusMenuOpen = false"></div>
          <div class="status-menu">
            <button
              v-for="s in statusFilters"
              :key="s.value"
              type="button"
              class="status-option"
              :class="{ active: ui.activeStatuses.has(s.value) }"
              @click="ui.toggleStatusFilter(s.value)"
            >
              <span class="status-chip-dot" :style="{ background: s.color }"></span>
              <span class="status-option-label">{{ s.label }}</span>
              <span class="status-option-check">
                {{ ui.activeStatuses.has(s.value) ? "✓" : "" }}
              </span>
            </button>
            <button
              v-if="ui.activeStatuses.size"
              type="button"
              class="btn btn-sm status-menu-clear"
              @click="ui.clearStatusFilter()"
            >
              Clear filter
            </button>
          </div>
        </template>
      </div>
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input
          v-model="ui.monitorSearch"
          type="text"
          class="search-input"
          placeholder="Search monitors by name, URL or tag…"
        />
        <button
          v-if="ui.monitorSearch"
          type="button"
          class="search-clear"
          title="Clear search"
          @click="ui.monitorSearch = ''"
        >
          ✕
        </button>
      </div>
      <button class="btn btn-primary btn-sm" @click="openNew">+ New monitor</button>
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
      <button
        v-if="section.monitors.some((m) => m.type === 'http-ping')"
        class="btn btn-sm section-check-users"
        title="Read the remote log for every http-ping monitor in this group"
        :disabled="section.monitors.some((m) => m.type === 'http-ping' && checkingUsers.has(m.id))"
        @click.stop="checkGroupUsers(section.monitors)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        {{
          section.monitors.some((m) => m.type === 'http-ping' && checkingUsers.has(m.id))
            ? "⏳ Checking…"
            : "👥 Online users"
        }}
      </button>
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
        <span
          v-if="section.stats.maintenance"
          class="section-stat"
          style="color: var(--maintenance)"
          title="Maintenance"
        >
          ● {{ section.stats.maintenance }}
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
    <div
      class="section-collapsible"
      :class="{ collapsed: collapsed.has(sectionKey(section.id)) }"
    >
    <div class="section-collapsible-inner">
    <div class="monitor-grid">
      <div v-for="m in section.monitors" :key="m.id" class="monitor-card">
        <div class="monitor-card-header">
          <div class="header-left">
            <span
              class="led led-header"
              :class="m.active ? statusLabel(m.stats?.status).cls : 'led-paused'"
              :title="m.active ? statusLabel(m.stats?.status).text : 'Paused'"
            ></span>
            <router-link :to="`/monitor/${m.id}`" class="monitor-name">
              {{ m.name }}
            </router-link>
            <span class="type-tag">{{ m.type }}</span>
            <span v-if="!m.active" class="paused-badge">paused</span>
            <span
              v-for="t in m.tags ?? []"
              :key="t.id"
              class="tag-badge"
              :style="{ background: t.color, borderColor: t.color }"
            >
              {{ t.name }}
            </span>
            <div class="header-target monitor-target">
              {{ m.target }}<span v-if="m.port">:{{ m.port }}</span>
            </div>
          </div>
          <div class="header-right monitor-actions">
            <button
              v-if="m.type === 'http' || m.type === 'http-ping'"
              class="btn btn-sm btn-icon"
              title="Open"
              aria-label="Open"
              @click="openWebPage(m)"
            >
              🌐
            </button>
            <!-- Remote Desktop temporarily hidden (pending IT review of the
                 launch mechanism): remove v-if="false" to re-enable. -->
            <button
              v-if="false"
              class="btn btn-sm btn-icon"
              title="Remote Desktop"
              aria-label="Remote Desktop"
              @click="openRemoteDesktop(m)"
            >
              🖥️
            </button>
            <button
              v-if="m.type === 'http-ping'"
              class="btn btn-sm btn-icon"
              :title="checkingUsers.has(m.id) ? 'Checking…' : 'Online users'"
              :aria-label="checkingUsers.has(m.id) ? 'Checking…' : 'Online users'"
              :disabled="checkingUsers.has(m.id)"
              @click="checkUsers(m)"
            >
              {{ checkingUsers.has(m.id) ? "⏳" : "👥" }}
            </button>
            <!-- Log files temporarily hidden: flip v-if back to
                 m.type === 'http-ping' to re-enable. -->
            <button
              v-if="false && m.type === 'http-ping'"
              class="btn btn-sm btn-icon"
              title="Log files"
              aria-label="Log files"
              @click="showLogFiles(m)"
            >
              📁
            </button>
            <!-- Restart temporarily hidden: flip v-if back to m.type === 'http-ping' to re-enable. -->
            <button
              v-if="false && m.type === 'http-ping'"
              class="btn btn-sm btn-icon"
              :title="restarting.has(m.id) ? 'Restarting…' : 'Restart'"
              :aria-label="restarting.has(m.id) ? 'Restarting…' : 'Restart'"
              :disabled="restarting.has(m.id)"
              @click="restartProgram(m)"
            >
              {{ restarting.has(m.id) ? "⏳" : "🔄" }}
            </button>
            <button
              class="btn btn-sm btn-icon"
              :title="m.active ? 'Pause' : 'Resume'"
              :aria-label="m.active ? 'Pause' : 'Resume'"
              @click="store.toggle(m.id)"
            >
              {{ m.active ? "⏸️" : "▶️" }}
            </button>
            <button
              class="btn btn-sm btn-icon"
              title="Edit"
              aria-label="Edit"
              @click="openEdit(m)"
            >
              ✏️
            </button>
            <button
              class="btn btn-sm btn-icon btn-danger"
              title="Delete"
              aria-label="Delete"
              @click="remove(m)"
            >
              🗑️
            </button>
          </div>
        </div>
        <div class="monitor-card-body">
        <div class="monitor-details">
        <div v-if="m.users?.length" class="monitor-users">
          <span class="label">Online Users:</span>
          <span v-for="u in m.users" :key="u" class="user-chip">{{ u }}</span>
        </div>
        <div
          v-else-if="m.users && !m.usersError"
          class="monitor-users"
        >
          <span class="label">Online Users:</span>
          <span class="muted">No users</span>
        </div>
        <div v-if="m.usersError" class="monitor-users-error" :title="m.usersError">
          ⚠ Online Users: {{ m.usersError }}
        </div>
      </div>

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
      </div>
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
