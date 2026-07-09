<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useMaintenanceStore } from "../stores/maintenances";
import { useMonitorStore } from "../stores/monitors";
import { useGroupStore } from "../stores/groups";
import type { Maintenance, MaintenanceStrategy } from "../types";

const store = useMaintenanceStore();
const monitorStore = useMonitorStore();
const groupStore = useGroupStore();

const showForm = ref(false);
const editingId = ref<number | null>(null);
const error = ref("");

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The form keeps date/time as the native input string formats; conversion to
// the unix/minutes representation the API expects happens on save.
const form = reactive({
  title: "",
  description: "",
  strategy: "single" as MaintenanceStrategy,
  active: true,
  // single: full datetime-local strings.
  singleStart: "",
  singleEnd: "",
  // recurring: optional validity date range (date-only) + daily time window.
  rangeStart: "",
  rangeEnd: "",
  startTime: "",
  endTime: "",
  daysOfWeek: [] as number[],
  daysOfMonth: [] as number[],
  monitorIds: [] as number[],
  groupIds: [] as number[],
});

onMounted(() => {
  store.fetchAll();
  monitorStore.fetchAll();
  groupStore.fetchAll();
});

// --- date/time helpers -----------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");

function dtLocalToUnix(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : Math.floor(t / 1000);
}
function unixToDtLocal(unix: number | null): string {
  if (unix == null) return "";
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dateToUnix(v: string, endOfDay = false): number | null {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59)
    : new Date(y, m - 1, d, 0, 0, 0);
  return Math.floor(dt.getTime() / 1000);
}
function unixToDate(unix: number | null): string {
  if (unix == null) return "";
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function timeToMin(v: string): number | null {
  if (!v) return null;
  const [h, m] = v.split(":").map(Number);
  return h * 60 + (m || 0);
}
function minToTime(min: number | null): string {
  if (min == null) return "";
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

// --- list summaries --------------------------------------------------------
function scheduleSummary(m: Maintenance): string {
  if (m.strategy === "single") {
    const s = m.startDate ? new Date(m.startDate * 1000).toLocaleString() : "?";
    const e = m.endDate ? new Date(m.endDate * 1000).toLocaleString() : "?";
    return `Once · ${s} → ${e}`;
  }
  const window = `${minToTime(m.startTime)}–${minToTime(m.endTime)}`;
  if (m.strategy === "daily") return `Daily · ${window}`;
  if (m.strategy === "weekly") {
    const days = m.daysOfWeek.map((d) => WEEKDAYS[d]).join(", ") || "—";
    return `Weekly · ${days} · ${window}`;
  }
  const days = m.daysOfMonth.slice().sort((a, b) => a - b).join(", ") || "—";
  return `Monthly · day ${days} · ${window}`;
}

const STRATEGY_LABEL: Record<MaintenanceStrategy, string> = {
  single: "One-off",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

// Name lookups so a window's covered targets render as readable chips.
const monitorName = (id: number) =>
  monitorStore.monitors.find((m) => m.id === id)?.name ?? `#${id}`;
const groupName = (id: number) =>
  groupStore.items.find((g) => g.id === id)?.name ?? `#${id}`;

// --- form open/save --------------------------------------------------------
function resetForm() {
  form.title = "";
  form.description = "";
  form.strategy = "single";
  form.active = true;
  form.singleStart = "";
  form.singleEnd = "";
  form.rangeStart = "";
  form.rangeEnd = "";
  form.startTime = "";
  form.endTime = "";
  form.daysOfWeek = [];
  form.daysOfMonth = [];
  form.monitorIds = [];
  form.groupIds = [];
  error.value = "";
}

function openNew() {
  editingId.value = null;
  resetForm();
  showForm.value = true;
}

function openEdit(m: Maintenance) {
  editingId.value = m.id;
  resetForm();
  form.title = m.title;
  form.description = m.description;
  form.strategy = m.strategy;
  form.active = m.active;
  if (m.strategy === "single") {
    form.singleStart = unixToDtLocal(m.startDate);
    form.singleEnd = unixToDtLocal(m.endDate);
  } else {
    form.rangeStart = unixToDate(m.startDate);
    form.rangeEnd = unixToDate(m.endDate);
    form.startTime = minToTime(m.startTime);
    form.endTime = minToTime(m.endTime);
    form.daysOfWeek = [...m.daysOfWeek];
    form.daysOfMonth = [...m.daysOfMonth];
  }
  form.monitorIds = [...m.monitorIds];
  form.groupIds = [...m.groupIds];
  showForm.value = true;
}

function toggleIn(list: number[], value: number) {
  const i = list.indexOf(value);
  if (i === -1) list.push(value);
  else list.splice(i, 1);
}

const daysOfMonthGrid = Array.from({ length: 31 }, (_, i) => i + 1);

async function save() {
  error.value = "";
  if (!form.title.trim()) {
    error.value = "Title is required.";
    return;
  }

  const payload: Partial<Maintenance> = {
    title: form.title.trim(),
    description: form.description.trim(),
    strategy: form.strategy,
    active: form.active,
    monitorIds: form.monitorIds,
    groupIds: form.groupIds,
    daysOfWeek: [],
    daysOfMonth: [],
    startDate: null,
    endDate: null,
    startTime: null,
    endTime: null,
  };

  if (form.strategy === "single") {
    const s = dtLocalToUnix(form.singleStart);
    const e = dtLocalToUnix(form.singleEnd);
    if (s == null || e == null) {
      error.value = "Start and end date/time are required.";
      return;
    }
    if (e <= s) {
      error.value = "End must be after start.";
      return;
    }
    payload.startDate = s;
    payload.endDate = e;
  } else {
    const s = timeToMin(form.startTime);
    const e = timeToMin(form.endTime);
    if (s == null || e == null) {
      error.value = "Start and end time are required.";
      return;
    }
    if (s === e) {
      error.value = "Start and end time must differ.";
      return;
    }
    if (form.strategy === "weekly" && form.daysOfWeek.length === 0) {
      error.value = "Pick at least one weekday.";
      return;
    }
    if (form.strategy === "monthly" && form.daysOfMonth.length === 0) {
      error.value = "Pick at least one day of the month.";
      return;
    }
    payload.startTime = s;
    payload.endTime = e;
    payload.startDate = dateToUnix(form.rangeStart, false);
    payload.endDate = dateToUnix(form.rangeEnd, true);
    payload.daysOfWeek = form.strategy === "weekly" ? form.daysOfWeek : [];
    payload.daysOfMonth = form.strategy === "monthly" ? form.daysOfMonth : [];
  }

  try {
    if (editingId.value) await store.update(editingId.value, payload);
    else await store.create(payload);
    showForm.value = false;
  } catch (e: any) {
    error.value = e.response?.data?.error ?? "Save failed";
  }
}

async function remove(m: Maintenance) {
  if (confirm(`Delete maintenance "${m.title}"?`)) await store.remove(m.id);
}

const monitors = computed(() => monitorStore.monitors);
const groups = computed(() => groupStore.items);
</script>

<template>
  <div class="page-head">
    <h1>Maintenance</h1>
    <button class="btn btn-primary" @click="openNew">+ New window</button>
  </div>

  <div v-if="store.items.length === 0" class="empty">
    No maintenance windows configured.
  </div>

  <div class="mw-grid">
    <div v-for="m in store.items" :key="m.id" class="mw-card" :class="{ disabled: !m.active }">
      <div class="mw-head">
        <div class="mw-title-wrap">
          <span class="mw-dot" :class="{ off: !m.active }"></span>
          <span class="mw-title">{{ m.title }}</span>
          <span class="mw-badge">{{ STRATEGY_LABEL[m.strategy] }}</span>
          <span v-if="!m.active" class="mw-badge mw-badge-off">Disabled</span>
        </div>
        <div class="mw-actions">
          <button class="btn btn-sm" @click="store.toggle(m.id)">
            {{ m.active ? "Disable" : "Enable" }}
          </button>
          <button class="btn btn-sm" @click="openEdit(m)">Edit</button>
          <button class="btn btn-sm btn-danger" @click="remove(m)">Delete</button>
        </div>
      </div>

      <div class="mw-schedule">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 14" />
        </svg>
        <span>{{ scheduleSummary(m) }}</span>
      </div>

      <div v-if="m.description" class="mw-desc">{{ m.description }}</div>

      <div class="mw-coverage">
        <template v-if="m.groupIds.length || m.monitorIds.length">
          <span v-for="gid in m.groupIds" :key="'g' + gid" class="mw-chip mw-chip-group">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            {{ groupName(gid) }}
          </span>
          <span v-for="mid in m.monitorIds" :key="'m' + mid" class="mw-chip">
            {{ monitorName(mid) }}
          </span>
        </template>
        <span v-else class="mw-empty">No targets selected</span>
      </div>
    </div>
  </div>

  <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
    <div class="modal">
      <h2>{{ editingId ? "Edit maintenance" : "New maintenance" }}</h2>
      <div v-if="error" class="error-msg">{{ error }}</div>

      <div class="field">
        <label>Title</label>
        <input v-model="form.title" placeholder="Nightly reboot" />
      </div>
      <div class="field">
        <label>Description</label>
        <input v-model="form.description" placeholder="Optional notes" />
      </div>
      <div class="field">
        <label>Strategy</label>
        <select v-model="form.strategy">
          <option value="single">One-off</option>
          <option value="daily">Recurring · daily</option>
          <option value="weekly">Recurring · weekly</option>
          <option value="monthly">Recurring · monthly</option>
        </select>
      </div>

      <!-- One-off window -->
      <template v-if="form.strategy === 'single'">
        <div class="field">
          <label>Start</label>
          <input type="datetime-local" v-model="form.singleStart" />
        </div>
        <div class="field">
          <label>End</label>
          <input type="datetime-local" v-model="form.singleEnd" />
        </div>
      </template>

      <!-- Recurring strategies -->
      <template v-else>
        <div v-if="form.strategy === 'weekly'" class="field">
          <label>Weekdays</label>
          <div class="day-picker">
            <button
              v-for="(d, i) in WEEKDAYS"
              :key="i"
              type="button"
              class="day-chip"
              :class="{ selected: form.daysOfWeek.includes(i) }"
              @click="toggleIn(form.daysOfWeek, i)"
            >
              {{ d }}
            </button>
          </div>
        </div>

        <div v-if="form.strategy === 'monthly'" class="field">
          <label>Days of month</label>
          <div class="day-picker">
            <button
              v-for="d in daysOfMonthGrid"
              :key="d"
              type="button"
              class="day-chip day-chip-sm"
              :class="{ selected: form.daysOfMonth.includes(d) }"
              @click="toggleIn(form.daysOfMonth, d)"
            >
              {{ d }}
            </button>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Start time</label>
            <input type="time" v-model="form.startTime" />
          </div>
          <div class="field">
            <label>End time</label>
            <input type="time" v-model="form.endTime" />
          </div>
        </div>
        <p class="muted" style="font-size: 12px; margin: -4px 0 10px">
          An end time earlier than the start time spans past midnight.
        </p>

        <div class="field-row">
          <div class="field">
            <label>Effective from (optional)</label>
            <input type="date" v-model="form.rangeStart" />
          </div>
          <div class="field">
            <label>Effective until (optional)</label>
            <input type="date" v-model="form.rangeEnd" />
          </div>
        </div>
      </template>

      <!-- Coverage -->
      <div class="field">
        <label>Groups</label>
        <div v-if="groups.length === 0" class="muted">No groups.</div>
        <div v-else class="pick-list">
          <label v-for="g in groups" :key="g.id" class="pick-row">
            <input
              type="checkbox"
              :checked="form.groupIds.includes(g.id)"
              @change="toggleIn(form.groupIds, g.id)"
            />
            <span>{{ g.name }}</span>
          </label>
        </div>
      </div>

      <div class="field">
        <label>Monitors</label>
        <div v-if="monitors.length === 0" class="muted">No monitors.</div>
        <div v-else class="pick-list">
          <label v-for="mon in monitors" :key="mon.id" class="pick-row">
            <input
              type="checkbox"
              :checked="form.monitorIds.includes(mon.id)"
              @change="toggleIn(form.monitorIds, mon.id)"
            />
            <span>{{ mon.name }}</span>
          </label>
        </div>
      </div>

      <div class="checkbox-row field">
        <input type="checkbox" v-model="form.active" id="m-active" />
        <label for="m-active" style="margin: 0">Active</label>
      </div>

      <div class="modal-actions">
        <button class="btn" @click="showForm = false">Cancel</button>
        <button class="btn btn-primary" @click="save">Save</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* --- window cards --- */
.mw-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mw-card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-left: 3px solid var(--maintenance);
  border-radius: var(--radius);
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.15s;
}
.mw-card:hover {
  border-color: var(--accent);
  border-left-color: var(--maintenance);
}
.mw-card.disabled {
  border-left-color: var(--border);
  opacity: 0.62;
}
.mw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.mw-title-wrap {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  flex-wrap: wrap;
}
.mw-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--maintenance);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
  flex-shrink: 0;
}
.mw-dot.off {
  background: var(--text-dim);
  box-shadow: none;
}
.mw-title {
  font-weight: 600;
  font-size: 16px;
}
.mw-badge {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--maintenance);
  background: rgba(59, 130, 246, 0.14);
  padding: 2px 8px;
  border-radius: 20px;
}
.mw-badge-off {
  color: var(--text-dim);
  background: transparent;
  border: 1px solid var(--border);
}
.mw-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.mw-schedule {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  color: var(--text);
}
.mw-schedule svg {
  color: var(--text-dim);
  flex-shrink: 0;
}
.mw-desc {
  font-size: 13px;
  color: var(--text-dim);
}
.mw-coverage {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mw-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  padding: 2px 9px;
  border-radius: 6px;
}
.mw-chip-group {
  color: var(--accent);
  border-color: rgba(56, 189, 248, 0.35);
}
.mw-empty {
  font-size: 12px;
  color: var(--text-dim);
  font-style: italic;
}

.field-row {
  display: flex;
  gap: 12px;
}
.field-row .field {
  flex: 1;
}
.day-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.day-chip {
  border: 1px solid var(--border);
  background: var(--bg-elev-2);
  color: var(--text);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}
.day-chip-sm {
  padding: 4px 8px;
  min-width: 34px;
}
.day-chip.selected {
  border-color: var(--maintenance);
  background: rgba(59, 130, 246, 0.18);
  color: var(--maintenance);
}
.pick-list {
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pick-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-weight: 400;
  cursor: pointer;
}
/* The global `.field input { width: 100% }` stretches these checkboxes and
   pushes the labels around — pin them left and let the label fill the rest. */
.pick-row input {
  width: auto;
  flex-shrink: 0;
  margin: 0;
}
.pick-row span {
  flex: 1;
  min-width: 0;
}
</style>
