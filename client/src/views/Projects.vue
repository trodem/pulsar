<script setup lang="ts">
// Projects-Seite: pro Projekt eine Karte mit seinen Fahrzeugen; an jedes
// Fahrzeug lassen sich Monitore zuweisen. Hierarchie: Projekt → Fahrzeug → Monitor.
import { computed, onMounted, reactive, ref } from "vue";
import { useProjectStore } from "../stores/projects";
import { useMonitorStore } from "../stores/monitors";
import { useAuthStore } from "../stores/auth";
import { statusLabel } from "../format";
import type { Project, Vehicle } from "../types";

const store = useProjectStore();
const monitorStore = useMonitorStore();
const auth = useAuthStore();
// Nur Admins dürfen anlegen/ändern/löschen (der Server erzwingt dies ebenfalls).
const isAdmin = computed(() => auth.isAdmin);

onMounted(() => {
  store.fetchAll();
  monitorStore.fetchAll();
});

// --- Projekt-Formular (neu/bearbeiten) ---
const showProjectForm = ref(false);
const editingProjectId = ref<number | null>(null);
const projectError = ref("");
const projectForm = reactive<{ name: string; description: string }>({
  name: "",
  description: "",
});

function openNewProject() {
  editingProjectId.value = null;
  projectForm.name = "";
  projectForm.description = "";
  projectError.value = "";
  showProjectForm.value = true;
}

function openEditProject(p: Project) {
  editingProjectId.value = p.id;
  projectForm.name = p.name;
  projectForm.description = p.description;
  projectError.value = "";
  showProjectForm.value = true;
}

async function saveProject() {
  projectError.value = "";
  if (!projectForm.name.trim()) {
    projectError.value = "Name ist erforderlich.";
    return;
  }
  const payload = {
    name: projectForm.name.trim(),
    description: projectForm.description.trim(),
  };
  try {
    if (editingProjectId.value)
      await store.update(editingProjectId.value, payload);
    else await store.create(payload);
    showProjectForm.value = false;
  } catch (e: any) {
    projectError.value = e.response?.data?.error ?? "Speichern fehlgeschlagen";
  }
}

async function removeProject(p: Project) {
  if (
    confirm(
      `Projekt „${p.name}“ löschen? Seine Fahrzeuge werden entfernt (die Monitore bleiben erhalten).`,
    )
  )
    await store.remove(p.id);
}

// --- Fahrzeug-Formular (neu/umbenennen) ---
const showVehicleForm = ref(false);
const editingVehicleId = ref<number | null>(null);
const vehicleProjectId = ref<number | null>(null);
const vehicleError = ref("");
const vehicleName = ref("");

function openNewVehicle(p: Project) {
  editingVehicleId.value = null;
  vehicleProjectId.value = p.id;
  vehicleName.value = "";
  vehicleError.value = "";
  showVehicleForm.value = true;
}

function openEditVehicle(v: Vehicle) {
  editingVehicleId.value = v.id;
  vehicleProjectId.value = v.projectId;
  vehicleName.value = v.name;
  vehicleError.value = "";
  showVehicleForm.value = true;
}

async function saveVehicle() {
  vehicleError.value = "";
  if (!vehicleName.value.trim()) {
    vehicleError.value = "Name ist erforderlich.";
    return;
  }
  try {
    if (editingVehicleId.value)
      await store.updateVehicle(editingVehicleId.value, vehicleName.value.trim());
    else if (vehicleProjectId.value)
      await store.addVehicle(vehicleProjectId.value, vehicleName.value.trim());
    showVehicleForm.value = false;
  } catch (e: any) {
    vehicleError.value = e.response?.data?.error ?? "Speichern fehlgeschlagen";
  }
}

async function removeVehicle(v: Vehicle) {
  if (confirm(`Fahrzeug „${v.name}“ löschen? Die zugewiesenen Monitore bleiben erhalten.`))
    await store.removeVehicle(v.id);
}

// --- Monitor-Zuweisung an ein Fahrzeug ---
const showAssign = ref(false);
const assignVehicle = ref<Vehicle | null>(null);
const assignError = ref("");
const selectedMonitorIds = ref<number[]>([]);

const monitors = computed(() => monitorStore.monitors);

// Status-LED-Klasse eines Monitors (aus dem Monitor-Store nachgeschlagen).
function monitorStatusCls(id: number): string {
  const m = monitorStore.monitors.find((x) => x.id === id);
  return statusLabel(m?.stats?.status).cls;
}

function openAssign(v: Vehicle) {
  assignVehicle.value = v;
  selectedMonitorIds.value = v.monitors.map((m) => m.id);
  assignError.value = "";
  showAssign.value = true;
}

function toggleMonitor(id: number) {
  const i = selectedMonitorIds.value.indexOf(id);
  if (i === -1) selectedMonitorIds.value.push(id);
  else selectedMonitorIds.value.splice(i, 1);
}

async function saveAssign() {
  if (!assignVehicle.value) return;
  assignError.value = "";
  try {
    await store.setVehicleMonitors(
      assignVehicle.value.id,
      selectedMonitorIds.value,
    );
    showAssign.value = false;
  } catch (e: any) {
    assignError.value = e.response?.data?.error ?? "Speichern fehlgeschlagen";
  }
}
</script>

<template>
  <div class="page-head">
    <h1>Projects</h1>
    <div class="page-actions">
      <button v-if="isAdmin" class="btn btn-primary" @click="openNewProject">
        + Neues Projekt
      </button>
    </div>
  </div>

  <div v-if="store.items.length === 0" class="empty">
    Noch keine Projekte konfiguriert.
  </div>

  <div class="project-grid">
    <div v-for="p in store.items" :key="p.id" class="project-card">
      <div class="project-head">
        <div class="project-title-wrap">
          <span class="project-name">{{ p.name }}</span>
          <span class="project-badge">
            {{ p.vehicles.length }}
            {{ p.vehicles.length === 1 ? "Fahrzeug" : "Fahrzeuge" }}
          </span>
        </div>
        <div v-if="isAdmin" class="project-actions">
          <button class="btn btn-sm" @click="openNewVehicle(p)">+ Fahrzeug</button>
          <button class="btn btn-sm" @click="openEditProject(p)">Bearbeiten</button>
          <button class="btn btn-sm btn-danger" @click="removeProject(p)">Löschen</button>
        </div>
      </div>

      <p v-if="p.description" class="project-desc">{{ p.description }}</p>

      <div v-if="p.vehicles.length === 0" class="project-empty">
        Noch keine Fahrzeuge.
      </div>

      <div v-else class="vehicle-list">
        <div v-for="v in p.vehicles" :key="v.id" class="vehicle">
          <div class="vehicle-head">
            <span class="vehicle-name">🚗 {{ v.name }}</span>
            <div v-if="isAdmin" class="vehicle-actions">
              <button class="btn btn-sm" @click="openAssign(v)">Monitore</button>
              <button class="btn btn-sm" @click="openEditVehicle(v)">Umbenennen</button>
              <button class="btn btn-sm btn-danger" @click="removeVehicle(v)">Löschen</button>
            </div>
          </div>

          <div class="vehicle-monitors">
            <template v-if="v.monitors.length">
              <router-link
                v-for="m in v.monitors"
                :key="m.id"
                :to="{ name: 'monitor', params: { id: m.id } }"
                class="mon-chip"
              >
                <span class="led" :class="monitorStatusCls(m.id)"></span>
                {{ m.name }}
              </router-link>
            </template>
            <span v-else class="chip-empty">Keine Monitore zugewiesen</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Projekt-Formular -->
  <div v-if="showProjectForm" class="modal-backdrop" @click.self="showProjectForm = false">
    <div class="modal">
      <h2>{{ editingProjectId ? "Projekt bearbeiten" : "Neues Projekt" }}</h2>
      <div v-if="projectError" class="error-msg">{{ projectError }}</div>

      <div class="field">
        <label>Name</label>
        <input v-model="projectForm.name" placeholder="Mein Projekt" />
      </div>
      <div class="field">
        <label>Beschreibung</label>
        <input v-model="projectForm.description" placeholder="Optional" />
      </div>

      <div class="modal-actions">
        <button class="btn" @click="showProjectForm = false">Abbrechen</button>
        <button class="btn btn-primary" @click="saveProject">Speichern</button>
      </div>
    </div>
  </div>

  <!-- Fahrzeug-Formular -->
  <div v-if="showVehicleForm" class="modal-backdrop" @click.self="showVehicleForm = false">
    <div class="modal">
      <h2>{{ editingVehicleId ? "Fahrzeug umbenennen" : "Neues Fahrzeug" }}</h2>
      <div v-if="vehicleError" class="error-msg">{{ vehicleError }}</div>

      <div class="field">
        <label>Name</label>
        <input v-model="vehicleName" placeholder="z. B. LKW-01" />
      </div>

      <div class="modal-actions">
        <button class="btn" @click="showVehicleForm = false">Abbrechen</button>
        <button class="btn btn-primary" @click="saveVehicle">Speichern</button>
      </div>
    </div>
  </div>

  <!-- Monitor-Zuweisung -->
  <div v-if="showAssign" class="modal-backdrop" @click.self="showAssign = false">
    <div class="modal">
      <h2>Monitore für „{{ assignVehicle?.name }}“</h2>
      <div v-if="assignError" class="error-msg">{{ assignError }}</div>

      <div class="field">
        <label>Zugewiesene Monitore</label>
        <div v-if="monitors.length === 0" class="muted">Keine Monitore vorhanden.</div>
        <div v-else class="pick-list">
          <label v-for="mon in monitors" :key="mon.id" class="pick-row">
            <input
              type="checkbox"
              :checked="selectedMonitorIds.includes(mon.id)"
              @change="toggleMonitor(mon.id)"
            />
            <span class="led" :class="monitorStatusCls(mon.id)"></span>
            <span>{{ mon.name }}</span>
          </label>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn" @click="showAssign = false">Abbrechen</button>
        <button class="btn btn-primary" @click="saveAssign">Speichern</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.project-card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.project-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.project-title-wrap {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  flex-wrap: wrap;
}
.project-name {
  font-weight: 600;
  font-size: 17px;
}
.project-badge {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  padding: 2px 8px;
  border-radius: 20px;
}
.project-actions,
.vehicle-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.project-desc {
  margin: 0;
  color: var(--text-dim);
  font-size: 13px;
}
.project-empty {
  color: var(--text-dim);
  font-size: 13px;
  font-style: italic;
}

.vehicle-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vehicle {
  background: var(--bg-elev-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vehicle-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.vehicle-name {
  font-weight: 600;
  font-size: 14px;
}
.vehicle-monitors {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.mon-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  text-decoration: none;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  padding: 3px 9px;
  border-radius: 6px;
  transition: border-color 0.15s;
}
.mon-chip:hover {
  border-color: var(--accent);
}
.mon-chip .led {
  width: 9px;
  height: 9px;
}
.chip-empty {
  font-size: 12px;
  color: var(--text-dim);
  font-style: italic;
}

/* Monitor-Auswahlliste im Zuweisungs-Dialog. */
.pick-list {
  max-height: 260px;
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
.pick-row input {
  width: auto;
  flex-shrink: 0;
  margin: 0;
}
.pick-row .led {
  width: 10px;
  height: 10px;
}
</style>
