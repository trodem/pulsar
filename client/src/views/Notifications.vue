<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useNotificationStore } from "../stores/notifications";
import { useMonitorStore } from "../stores/monitors";
import { useGroupStore } from "../stores/groups";
import { useAuthStore } from "../stores/auth";
import type { Notification } from "../types";

const store = useNotificationStore();
const monitorStore = useMonitorStore();
const groupStore = useGroupStore();
const auth = useAuthStore();
// Read-only accounts can view notifications but not create/edit/delete them.
const isAdmin = computed(() => auth.isAdmin);

const showForm = ref(false);
const editingId = ref<number | null>(null);
const error = ref("");
const testMsg = ref("");

const form = reactive<{
  name: string;
  type: "webhook" | "telegram" | "teams";
  config: Record<string, any>;
  active: boolean;
  monitorIds: number[];
  groupIds: number[];
}>({
  name: "",
  type: "webhook",
  config: {},
  active: true,
  monitorIds: [],
  groupIds: [],
});

onMounted(() => {
  store.fetchAll();
  monitorStore.fetchAll();
  groupStore.fetchAll();
});

const monitors = computed(() => monitorStore.monitors);
const groups = computed(() => groupStore.items);
const monitorName = (id: number) =>
  monitorStore.monitors.find((m) => m.id === id)?.name ?? `#${id}`;
const groupName = (id: number) =>
  groupStore.items.find((g) => g.id === id)?.name ?? `#${id}`;

const TYPE_LABEL: Record<Notification["type"], string> = {
  webhook: "Webhook",
  telegram: "Telegram",
  teams: "Microsoft Teams",
};

// What each channel points at, shown as the card's destination line.
function destinationOf(n: Notification): string {
  if (n.type === "telegram") return `chat ${n.config.chatId ?? "?"}`;
  return n.config.url || "—";
}

function toggleIn(list: number[], value: number) {
  const i = list.indexOf(value);
  if (i === -1) list.push(value);
  else list.splice(i, 1);
}

function openNew() {
  editingId.value = null;
  form.name = "";
  form.type = "webhook";
  form.config = {};
  form.active = true;
  form.monitorIds = [];
  form.groupIds = [];
  error.value = "";
  testMsg.value = "";
  showForm.value = true;
}

function openEdit(n: Notification) {
  editingId.value = n.id;
  form.name = n.name;
  form.type = n.type;
  form.config = { ...n.config };
  form.active = n.active;
  form.monitorIds = [...(n.monitorIds ?? [])];
  form.groupIds = [...(n.groupIds ?? [])];
  error.value = "";
  testMsg.value = "";
  showForm.value = true;
}

async function save() {
  error.value = "";
  if (!form.name.trim()) {
    error.value = "Name is required.";
    return;
  }
  const payload = {
    name: form.name,
    type: form.type,
    config: form.config,
    active: form.active,
    monitorIds: form.monitorIds,
    groupIds: form.groupIds,
  };
  try {
    if (editingId.value) await store.update(editingId.value, payload);
    else await store.create(payload);
    showForm.value = false;
  } catch (e: any) {
    error.value = e.response?.data?.error ?? "Save failed";
  }
}

async function sendTest() {
  testMsg.value = "";
  try {
    await store.test(form.type, form.config);
    testMsg.value = "Test sent ✓";
  } catch (e: any) {
    testMsg.value = e.response?.data?.error ?? "Test failed";
  }
}

async function remove(n: Notification) {
  if (confirm(`Delete notification "${n.name}"?`)) await store.remove(n.id);
}
</script>

<template>
  <div class="page-head">
    <h1>Notifications</h1>
    <button v-if="isAdmin" class="btn btn-primary" @click="openNew">+ New notification</button>
  </div>

  <div v-if="store.items.length === 0" class="empty">
    No notification channels configured.
  </div>

  <div class="notif-grid">
    <div
      v-for="n in store.items"
      :key="n.id"
      class="notif-card"
      :class="['type-' + n.type, { disabled: !n.active }]"
    >
      <div class="notif-head">
        <div class="notif-title-wrap">
          <span class="notif-icon">
            <!-- webhook: link -->
            <svg v-if="n.type === 'webhook'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <!-- telegram: paper plane -->
            <svg v-else-if="n.type === 'telegram'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <!-- teams: chat bubble -->
            <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span class="notif-name">{{ n.name }}</span>
          <span class="notif-badge">{{ TYPE_LABEL[n.type] }}</span>
          <span v-if="!n.active" class="notif-badge notif-badge-off">Disabled</span>
        </div>
        <div v-if="isAdmin" class="notif-actions">
          <button class="btn btn-sm" @click="openEdit(n)">Edit</button>
          <button class="btn btn-sm btn-danger" @click="remove(n)">Delete</button>
        </div>
      </div>

      <div class="notif-dest">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
        <span class="notif-dest-text">{{ destinationOf(n) }}</span>
      </div>

      <div class="notif-coverage">
        <span class="notif-coverage-label">Fires for</span>
        <template v-if="n.groupIds.length || n.monitorIds.length">
          <span v-for="gid in n.groupIds" :key="'g' + gid" class="chip chip-group">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            {{ groupName(gid) }}
          </span>
          <span v-for="mid in n.monitorIds" :key="'m' + mid" class="chip">
            {{ monitorName(mid) }}
          </span>
        </template>
        <span v-else class="chip-empty">No targets — won't fire</span>
      </div>
    </div>
  </div>

  <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
    <div class="modal">
      <h2>{{ editingId ? "Edit notification" : "New notification" }}</h2>
      <div v-if="error" class="error-msg">{{ error }}</div>

      <div class="field">
        <label>Name</label>
        <input v-model="form.name" placeholder="My webhook" />
      </div>
      <div class="field">
        <label>Type</label>
        <select v-model="form.type">
          <option value="webhook">Webhook</option>
          <option value="telegram">Telegram</option>
          <option value="teams">Microsoft Teams</option>
        </select>
      </div>

      <template v-if="form.type === 'webhook'">
        <div class="field">
          <label>Webhook URL</label>
          <input v-model="form.config.url" placeholder="https://…" />
        </div>
      </template>

      <template v-else-if="form.type === 'teams'">
        <div class="field">
          <label>Teams webhook URL</label>
          <input
            v-model="form.config.url"
            placeholder="https://…webhook.office.com/…"
          />
          <p class="muted" style="font-size: 12px; margin: 6px 0 0">
            In the Teams channel → Connectors (or Workflows) → Incoming Webhook,
            create one and paste its URL here.
          </p>
        </div>
      </template>

      <template v-else>
        <div class="field">
          <label>Bot token</label>
          <input v-model="form.config.botToken" placeholder="123456:ABC…" />
        </div>
        <div class="field">
          <label>Chat ID</label>
          <input v-model="form.config.chatId" placeholder="123456789" />
        </div>
      </template>

      <!-- Applies to: fires for these groups' monitors and/or these monitors. -->
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
        <input type="checkbox" v-model="form.active" id="n-active" />
        <label for="n-active" style="margin: 0">Active</label>
      </div>

      <div v-if="testMsg" class="muted" style="margin-bottom: 10px">{{ testMsg }}</div>

      <div class="modal-actions">
        <button class="btn" @click="sendTest">Send test</button>
        <button class="btn" @click="showForm = false">Cancel</button>
        <button class="btn btn-primary" @click="save">Save</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* --- notification cards (mirrors the maintenance card language) --- */
.notif-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.notif-card {
  /* Per-type accent, consumed by the left border and the icon. */
  --notif-color: var(--accent);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-left: 3px solid var(--notif-color);
  border-radius: var(--radius);
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.15s;
}
.notif-card:hover {
  border-color: var(--accent);
  border-left-color: var(--notif-color);
}
.notif-card.type-telegram {
  --notif-color: #29a9eb;
}
.notif-card.type-teams {
  --notif-color: #6264a7;
}
.notif-card.disabled {
  border-left-color: var(--border);
  opacity: 0.62;
}
.notif-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.notif-title-wrap {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  flex-wrap: wrap;
}
.notif-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--notif-color);
  background: color-mix(in srgb, var(--notif-color) 15%, transparent);
  flex-shrink: 0;
}
.notif-name {
  font-weight: 600;
  font-size: 16px;
}
.notif-badge {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--notif-color);
  background: color-mix(in srgb, var(--notif-color) 15%, transparent);
  padding: 2px 8px;
  border-radius: 20px;
}
.notif-badge-off {
  color: var(--text-dim);
  background: transparent;
  border: 1px solid var(--border);
}
.notif-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.notif-dest {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-dim);
  min-width: 0;
}
.notif-dest svg {
  flex-shrink: 0;
}
.notif-dest-text {
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notif-coverage {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.notif-coverage-label {
  font-size: 12px;
  color: var(--text-dim);
  margin-right: 2px;
}
.chip {
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
.chip-group {
  color: var(--accent);
  border-color: var(--accent-border);
}
.chip-empty {
  font-size: 12px;
  color: var(--text-dim);
  font-style: italic;
}

/* Groups/monitors "Applies to" pickers (mirrors the maintenance form). */
.pick-list {
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px 12px;
}
.pick-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-weight: 400;
  cursor: pointer;
}
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
