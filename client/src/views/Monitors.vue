<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useMonitorStore } from "../stores/monitors";
import { useGroupStore } from "../stores/groups";
import { useTagStore } from "../stores/tags";
import { useUiStore } from "../stores/ui";
import { useAuthStore } from "../stores/auth";
import type { LogFileEntry, Monitor } from "../types";
import MonitorForm from "../components/MonitorForm.vue";
import { fileSize, ms, relTime, statusLabel, uptimePct } from "../format";
import { HIDE_USERS } from "../config";

const store = useMonitorStore();
const groupStore = useGroupStore();
const tagStore = useTagStore();
const ui = useUiStore();
const auth = useAuthStore();
// Read-only ("user") accounts can view everything but not mutate; hide the
// create/edit/delete/reorder controls for them (the server enforces this too).
const isAdmin = computed(() => auth.isAdmin);

// Action-button glyphs forced to text (monochrome) presentation with the
// U+FE0E variation selector so they inherit the button's CSS `color` instead of
// the emoji's own fixed colours. Lets us tint play/pause/delete icons.
const ICON_PAUSE = "⏸︎";
const ICON_PLAY = "▶︎";
const ICON_DELETE = "\u{1F5D1}︎";

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

// Set once per fresh login by the auth store. When present on mount, collapse
// every section, then clear the flag so subsequent toggles persist as usual.
const COLLAPSE_ALL_KEY = "monitors.collapseAllOnLogin";

function collapseAllSections() {
  const keys = [...groupStore.items.map((g) => sectionKey(g.id)), "ungrouped"];
  const next = new Set(keys);
  collapsed.value = next;
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
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
  const status = ui.activeStatus;
  return store.monitors.filter((m) => {
    const tagOk =
      tagIds.size === 0 ||
      (m.tags ?? []).some((t) => tagIds.has(t.id));
    const statusOk = status == null || (m.stats?.status ?? -1) === status;
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
// then an "Ungrouped" section. Groups without monitors are shown too (e.g. as a
// drop target), but only when no filter is active — during filtering we keep the
// view to matching monitors. Each section carries its own aggregate stats.
const sections = computed(() => {
  const list = filteredMonitors.value;
  const noFilter =
    ui.monitorSearch.trim() === "" &&
    ui.activeTagIds.size === 0 &&
    ui.activeStatus == null;
  const out: {
    id: number | null;
    name: string;
    monitors: Monitor[];
    stats: ReturnType<typeof computeStats>;
  }[] = [];
  for (const g of groupStore.items) {
    const monitors = list.filter((m) => m.groupId === g.id);
    if (monitors.length || noFilter)
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

// Status-filter dropdown: a plain single-select. Empty option ("") clears the
// filter (null); any other option filters to that single status code.
function onStatusChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value;
  ui.activeStatus = v === "" ? null : Number(v);
}

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
  // On the first Monitors visit after logging in, start with every group
  // collapsed; from then on the user's own toggles are what persist.
  if (localStorage.getItem(COLLAPSE_ALL_KEY)) {
    collapseAllSections();
    localStorage.removeItem(COLLAPSE_ALL_KEY);
  }
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

// --- Drag-and-drop reordering (card + list views) ---------------------
// Both views use the same ⠿ grip as the drag handle and share these handlers,
// keyed by monitor id; the card/row itself is the drop target.
// The card being dragged and the card currently hovered as a drop target (both
// monitor ids), plus the section header hovered as a drop target (group id, or
// "ungrouped"). All null when no drag is in progress. A drop onto another
// group's card — or onto a group header — moves the monitor into that group.
const dragId = ref<number | null>(null);
const dragOverId = ref<number | null>(null);
const dragOverSection = ref<string | null>(null);
// Whether the drop would land *after* the hovered target (cursor past its
// midpoint) rather than before it. Drives the insertion-line indicator.
const dropAfter = ref(false);

// Builds the reorder payload from a flat, already-ordered monitor array,
// overriding the dragged monitor's group so the move is persisted.
function reorderPayload(arr: Monitor[], draggedId: number, groupId: number | null) {
  return arr.map((m) => ({
    id: m.id,
    groupId: m.id === draggedId ? groupId : m.groupId,
  }));
}

function onDragStart(m: Monitor, e: DragEvent) {
  dragId.value = m.id;
  // Firefox only starts a drag when some data is set on the transfer.
  e.dataTransfer?.setData("text/plain", String(m.id));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

// Mark the hovered target and which side the drop line shows on. List view
// stacks vertically (split by cursor Y); the card grid flows horizontally
// (split by cursor X), so the insertion line points the right way in each.
function onDragOver(target: Monitor, e: DragEvent) {
  if (dragId.value == null || dragId.value === target.id) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropAfter.value =
    ui.monitorView === "list"
      ? e.clientY > rect.top + rect.height / 2
      : e.clientX > rect.left + rect.width / 2;
  dragOverId.value = target.id;
  dragOverSection.value = null;
}

function onDragLeave(target: Monitor) {
  if (dragOverId.value === target.id) dragOverId.value = null;
}

// Drop the dragged card before or after the target (matching the drop line).
// If the target is in another group the monitor moves into it. Persists the
// new order + group membership.
function onDrop(target: Monitor) {
  const id = dragId.value;
  const after = dropAfter.value;
  dragOverId.value = null;
  dragId.value = null;
  if (id == null || id === target.id) return;
  const dragged = store.monitors.find((m) => m.id === id);
  if (!dragged) return;

  const arr = store.monitors.filter((m) => m.id !== id);
  const targetIdx = arr.findIndex((m) => m.id === target.id);
  if (targetIdx < 0) return;
  arr.splice(after ? targetIdx + 1 : targetIdx, 0, dragged);
  store.reorder(reorderPayload(arr, id, target.groupId));
}

// A group header is a drop target too, so a monitor can be moved into a group
// that has no visible cards (or dropped at the end of a group). Appends the
// dragged monitor after the last monitor already in that group.
function onSectionDragOver(sectionId: number | null, e: DragEvent) {
  if (dragId.value == null) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dragOverSection.value = sectionKey(sectionId);
  dragOverId.value = null;
}

function onSectionDragLeave(sectionId: number | null) {
  if (dragOverSection.value === sectionKey(sectionId)) dragOverSection.value = null;
}

function onSectionDrop(sectionId: number | null) {
  const id = dragId.value;
  dragOverSection.value = null;
  dragId.value = null;
  if (id == null) return;
  const dragged = store.monitors.find((m) => m.id === id);
  if (!dragged) return;

  const arr = store.monitors.filter((m) => m.id !== id);
  // Insert after the last monitor already in the target group; if the group is
  // empty, fall back to the end of the list.
  let lastIdx = -1;
  arr.forEach((m, i) => {
    if (m.groupId === sectionId) lastIdx = i;
  });
  arr.splice(lastIdx + 1, 0, dragged);
  store.reorder(reorderPayload(arr, id, sectionId));
}

function onDragEnd() {
  dragId.value = null;
  dragOverId.value = null;
  dragOverSection.value = null;
}

// While dragging, groups (and "Ungrouped") that currently have no visible cards
// aren't rendered as sections, so there'd be no way to drop a monitor into them.
// Surface them as slim drop zones for the duration of the drag.
const emptyDragGroups = computed(() => {
  if (dragId.value == null) return [];
  const shown = new Set<number | null>(sections.value.map((s) => s.id));
  const out: { id: number | null; name: string }[] = groupStore.items
    .filter((g) => !shown.has(g.id))
    .map((g) => ({ id: g.id, name: g.name }));
  if (!shown.has(null)) out.push({ id: null, name: "Ungrouped" });
  return out;
});

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

// --- CSV export / import (heartbeat sessions) --------------------------

// Hidden <input type="file"> driven by the "Import CSV" button.
const csvInput = ref<HTMLInputElement | null>(null);
const exporting = ref(false);
const importing = ref(false);
// Transient banner shown under the toolbar after an export/import.
const csvNotice = ref<{ kind: "ok" | "error"; text: string } | null>(null);

function flashNotice(kind: "ok" | "error", text: string) {
  csvNotice.value = { kind, text };
  // Auto-dismiss success after a few seconds; leave errors up to read.
  if (kind === "ok") setTimeout(() => (csvNotice.value = null), 4000);
}

async function exportCsv() {
  exporting.value = true;
  csvNotice.value = null;
  try {
    await store.exportMonitorsCsv();
    flashNotice("ok", "Monitors exported to CSV.");
  } catch (e: any) {
    flashNotice("error", e?.response?.data?.error ?? "Export failed.");
  } finally {
    exporting.value = false;
  }
}

function pickCsv() {
  csvNotice.value = null;
  csvInput.value?.click();
}

// Turns the selected file into CSV text. A .xlsx/.xls workbook is parsed in the
// browser (SheetJS, lazy-loaded) and its first sheet is converted to CSV, so the
// server only ever receives the same CSV format. Anything else is read as text.
async function fileToCsv(file: File): Promise<string> {
  const isExcel =
    /\.(xlsx|xls)$/i.test(file.name) ||
    file.type.includes("spreadsheet") ||
    file.type.includes("ms-excel");
  if (!isExcel) return file.text();

  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("The Excel file has no sheets.");
  return XLSX.utils.sheet_to_csv(sheet);
}

async function onCsvSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  // Reset so selecting the same file again still fires @change.
  input.value = "";
  if (!file) return;

  importing.value = true;
  try {
    const text = await fileToCsv(file);
    const { imported, skipped } = await store.importMonitorsCsv(text);
    const skippedNote = skipped ? ` (${skipped} skipped — name already exists)` : "";
    flashNotice(
      "ok",
      `Imported ${imported} monitor${imported === 1 ? "" : "s"}${skippedNote}.`,
    );
  } catch (e: any) {
    flashNotice(
      "error",
      e?.response?.data?.error ?? e?.message ?? "Import failed. Check the file format.",
    );
  } finally {
    importing.value = false;
  }
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
      <select
        class="status-select"
        title="Filter monitors by status"
        :value="ui.activeStatus ?? ''"
        @change="onStatusChange"
      >
        <option value="">All statuses</option>
        <option v-for="s in statusFilters" :key="s.value" :value="s.value">
          {{ s.label }}
        </option>
      </select>
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
      <button
        class="btn btn-sm"
        title="Export monitors (with groups and tags) to a CSV file"
        :disabled="exporting"
        @click="exportCsv"
      >
        {{ exporting ? "⏳ Exporting…" : "⬇ Export CSV" }}
      </button>
      <button
        v-if="isAdmin"
        class="btn btn-sm"
        title="Import monitors from a CSV or Excel file"
        :disabled="importing"
        @click="pickCsv"
      >
        {{ importing ? "⏳ Importing…" : "⬆ Import CSV" }}
      </button>
      <input
        ref="csvInput"
        type="file"
        accept=".csv,text/csv,.txt,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        style="display: none"
        @change="onCsvSelected"
      />
      <button v-if="isAdmin" class="btn btn-primary btn-sm" @click="openNew">+ New monitor</button>
    </div>
  </div>

  <div v-if="csvNotice" class="csv-notice" :class="csvNotice.kind">
    <span>{{ csvNotice.text }}</span>
    <button type="button" class="csv-notice-close" title="Dismiss" @click="csvNotice = null">
      ✕
    </button>
  </div>

  <div v-if="store.monitors.length === 0" class="empty">
    <p>No monitors yet.</p>
    <button v-if="isAdmin" class="btn btn-primary" @click="openNew">Add your first monitor</button>
  </div>

  <div v-else-if="sections.length === 0" class="empty">
    <p>No monitors match the current filters.</p>
  </div>

  <div v-for="section in sections" :key="section.id ?? 'ungrouped'" class="monitor-section">
    <div
      class="section-head"
      :class="{ 'section-drop': dragOverSection === sectionKey(section.id) }"
      role="button"
      tabindex="0"
      @click="toggleSection(section.id)"
      @keydown.enter.prevent="toggleSection(section.id)"
      @keydown.space.prevent="toggleSection(section.id)"
      @dragover="onSectionDragOver(section.id, $event)"
      @dragleave="onSectionDragLeave(section.id)"
      @drop.prevent="onSectionDrop(section.id)"
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
      <button
        v-if="!HIDE_USERS && isAdmin && section.monitors.some((m) => m.type === 'http-ping')"
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
    </div>
    <div
      class="section-collapsible"
      :class="{ collapsed: collapsed.has(sectionKey(section.id)) }"
    >
    <div class="section-collapsible-inner">
    <div v-if="ui.monitorView === 'list'" class="monitor-list">
      <div
        v-for="m in section.monitors"
        :key="m.id"
        class="monitor-row"
        :class="[
          'border-' + (m.active ? statusLabel(m.stats?.status).cls : 'status-paused'),
          {
            dragging: dragId === m.id,
            'drop-before': dragOverId === m.id && !dropAfter,
            'drop-after': dragOverId === m.id && dropAfter,
          },
        ]"
        @dragover="onDragOver(m, $event)"
        @dragleave="onDragLeave(m)"
        @drop.prevent="onDrop(m)"
      >
        <span
          v-if="isAdmin"
          class="drag-handle"
          draggable="true"
          title="Drag to reorder"
          aria-label="Drag to reorder"
          @dragstart="onDragStart(m, $event)"
          @dragend="onDragEnd"
          >⠿</span
        >
        <span
          class="led"
          :class="m.active ? statusLabel(m.stats?.status).cls : 'led-paused'"
          :title="m.active ? statusLabel(m.stats?.status).text : 'Paused'"
        ></span>
        <router-link :to="`/monitor/${m.id}`" class="monitor-name row-name">
          {{ m.name }}
        </router-link>
        <span class="row-target monitor-target" :title="m.target">
          {{ m.target }}<span v-if="m.port">:{{ m.port }}</span>
        </span>
        <div
          v-if="!HIDE_USERS && m.type === 'http-ping'"
          class="row-users"
          :title="m.usersError ?? undefined"
        >
          <span v-if="m.usersError" class="row-users-error">⚠ {{ m.usersError }}</span>
          <template v-else-if="m.users?.length">
            <span v-for="u in m.users" :key="u" class="user-chip">{{ u }}</span>
          </template>
          <span v-else class="muted">No users</span>
        </div>
        <div
          v-if="!m.active || m.stats?.status === 3 || (m.tags?.length ?? 0)"
          class="row-meta"
        >
          <!-- Reihenfolge (links -> rechts): Tags, dann Service-Badge
               (maintenance/paused); die Aktions-Buttons folgen in .row-actions. -->
          <span
            v-for="t in m.tags ?? []"
            :key="t.id"
            class="tag-badge"
            :style="{ background: t.color, borderColor: t.color }"
          >
            {{ t.name }}
          </span>
          <span v-if="!m.active" class="paused-badge">paused</span>
          <span v-else-if="m.stats?.status === 3" class="maintenance-badge">
            maintenance
          </span>
        </div>
        <div class="row-actions monitor-actions">
          <router-link
            :to="`/monitor/${m.id}`"
            class="btn btn-sm btn-icon"
            title="Details"
            aria-label="Details"
          >
            📊
          </router-link>
          <button
            v-if="m.type === 'http' || m.type === 'http-ping'"
            class="btn btn-sm btn-icon"
            title="Open"
            aria-label="Open"
            @click="openWebPage(m)"
          >
            🌐
          </button>
          <button
            v-if="!HIDE_USERS && isAdmin && m.type === 'http-ping'"
            class="btn btn-sm btn-icon"
            :title="checkingUsers.has(m.id) ? 'Checking…' : 'Online users'"
            :aria-label="checkingUsers.has(m.id) ? 'Checking…' : 'Online users'"
            :disabled="checkingUsers.has(m.id)"
            @click="checkUsers(m)"
          >
            {{ checkingUsers.has(m.id) ? "⏳" : "👥" }}
          </button>
          <button
            v-if="isAdmin"
            class="btn btn-sm btn-icon"
            :class="m.active ? 'btn-pause' : 'btn-play'"
            :title="m.active ? 'Pause' : 'Resume'"
            :aria-label="m.active ? 'Pause' : 'Resume'"
            @click="store.toggle(m.id)"
          >
            {{ m.active ? ICON_PAUSE : ICON_PLAY }}
          </button>
          <button
            v-if="isAdmin"
            class="btn btn-sm btn-icon"
            title="Edit"
            aria-label="Edit"
            @click="openEdit(m)"
          >
            ✏️
          </button>
          <button
            v-if="isAdmin"
            class="btn btn-sm btn-icon btn-icon-danger"
            title="Delete"
            aria-label="Delete"
            @click="remove(m)"
          >
            {{ ICON_DELETE }}
          </button>
        </div>
      </div>
    </div>
    <div v-else class="monitor-grid">
      <div
        v-for="m in section.monitors"
        :key="m.id"
        class="monitor-card"
        :class="[
          'border-' + (m.active ? statusLabel(m.stats?.status).cls : 'status-paused'),
          {
            dragging: dragId === m.id,
            'drop-before': dragOverId === m.id && !dropAfter,
            'drop-after': dragOverId === m.id && dropAfter,
          },
        ]"
        @dragover="onDragOver(m, $event)"
        @dragleave="onDragLeave(m)"
        @drop.prevent="onDrop(m)"
      >
        <div class="monitor-card-header">
          <div class="header-left">
            <span
              v-if="isAdmin"
              class="drag-handle"
              draggable="true"
              title="Drag to reorder"
              aria-label="Drag to reorder"
              @dragstart="onDragStart(m, $event)"
              @dragend="onDragEnd"
              >⠿</span
            >
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
            <span v-else-if="m.stats?.status === 3" class="maintenance-badge">
              maintenance
            </span>
            <div v-if="m.tags?.length" class="header-tags">
              <span
                v-for="t in m.tags"
                :key="t.id"
                class="tag-badge"
                :style="{ background: t.color, borderColor: t.color }"
              >
                {{ t.name }}
              </span>
            </div>
            <div class="header-target monitor-target">
              {{ m.target }}<span v-if="m.port">:{{ m.port }}</span>
            </div>
          </div>
          <div class="header-right monitor-actions">
            <router-link
              :to="`/monitor/${m.id}`"
              class="btn btn-sm btn-icon"
              title="Details"
              aria-label="Details"
            >
              📊
            </router-link>
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
              v-if="!HIDE_USERS && isAdmin && m.type === 'http-ping'"
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
              v-if="isAdmin"
              class="btn btn-sm btn-icon"
              :class="m.active ? 'btn-pause' : 'btn-play'"
              :title="m.active ? 'Pause' : 'Resume'"
              :aria-label="m.active ? 'Pause' : 'Resume'"
              @click="store.toggle(m.id)"
            >
              {{ m.active ? ICON_PAUSE : ICON_PLAY }}
            </button>
            <button
              v-if="isAdmin"
              class="btn btn-sm btn-icon"
              title="Edit"
              aria-label="Edit"
              @click="openEdit(m)"
            >
              ✏️
            </button>
            <button
              v-if="isAdmin"
              class="btn btn-sm btn-icon btn-icon-danger"
              title="Delete"
              aria-label="Delete"
              @click="remove(m)"
            >
              {{ ICON_DELETE }}
            </button>
          </div>
        </div>
        <div class="monitor-card-body">
        <div class="monitor-details">
        <div v-if="!HIDE_USERS && m.users?.length" class="monitor-users">
          <span class="label">Online Users:</span>
          <span v-for="u in m.users" :key="u" class="user-chip">{{ u }}</span>
        </div>
        <div
          v-else-if="!HIDE_USERS && m.type === 'http-ping' && !m.usersError"
          class="monitor-users"
        >
          <span class="label">Online Users:</span>
          <span class="muted">No users</span>
        </div>
        <div v-if="!HIDE_USERS && m.usersError" class="monitor-users-error" :title="m.usersError">
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

  <!-- Drop targets for groups with no visible cards, shown only while dragging
       so a monitor can be moved into an (otherwise hidden) empty group. -->
  <div
    v-for="g in emptyDragGroups"
    :key="'empty-' + (g.id ?? 'ungrouped')"
    class="section-drop-zone"
    :class="{ 'section-drop': dragOverSection === sectionKey(g.id) }"
    @dragover="onSectionDragOver(g.id, $event)"
    @dragleave="onSectionDragLeave(g.id)"
    @drop.prevent="onSectionDrop(g.id)"
  >
    Drop here to move into “{{ g.name }}”
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
