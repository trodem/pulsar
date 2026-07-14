<script setup lang="ts">
// Projects-Seite: pro Projekt eine Karte mit seinen Fahrzeugen; an jedes
// Fahrzeug lassen sich Monitore zuweisen. Hierarchie: Projekt → Fahrzeug → Monitor.
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useProjectStore } from "../stores/projects";
import { useMonitorStore } from "../stores/monitors";
import { useAuthStore } from "../stores/auth";
import { statusLabel } from "../format";
import type { Project, Vehicle, VehicleMonitor } from "../types";

const store = useProjectStore();
const monitorStore = useMonitorStore();
const auth = useAuthStore();
const router = useRouter();
// Admin und Editor dürfen anlegen/ändern/löschen (der Server erzwingt dies
// ebenfalls via requireWrite("admin","editor")). "user" sieht alles nur lesend.
const canEdit = computed(() => auth.canManageProjects);

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

// Aktuelle Zuordnung jedes Monitors zu einem Fahrzeug (über alle Projekte),
// um im Zuweisungs-Dialog bereits vergebene Monitore zu sperren.
const monitorAssignment = computed(() => {
  const map = new Map<number, { vehicleId: number; vehicleName: string }>();
  for (const p of store.items) {
    for (const v of p.vehicles) {
      for (const m of v.monitors) {
        map.set(m.id, { vehicleId: v.id, vehicleName: v.name });
      }
    }
  }
  return map;
});

// True, wenn der Monitor bereits einem ANDEREN Fahrzeug zugewiesen ist (nicht dem
// gerade im Dialog offenen) — dann im Dialog nicht auswählbar.
function assignedElsewhere(id: number): boolean {
  const a = monitorAssignment.value.get(id);
  return !!a && a.vehicleId !== assignVehicle.value?.id;
}

// Status-LED-Klasse eines Monitors (aus dem Monitor-Store nachgeschlagen).
function monitorStatusCls(id: number): string {
  const m = monitorStore.monitors.find((x) => x.id === id);
  return statusLabel(m?.stats?.status).cls;
}

// Nur http/http-ping-Monitore haben eine aufrufbare URL (target).
function hasUrl(id: number): boolean {
  const m = monitorStore.monitors.find((x) => x.id === id);
  return !!m && (m.type === "http" || m.type === "http-ping");
}

// Öffnet die überwachte Website (target) des Monitors in einem neuen Tab.
function openMonitorUrl(id: number) {
  const m = monitorStore.monitors.find((x) => x.id === id);
  if (m) window.open(m.target, "_blank", "noopener");
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

// --- Drag & Drop: Monitore zwischen Fahrzeugen verschieben (auch projektübergreifend) ---
const dragMonitorId = ref<number | null>(null);
const dragOverVehicleId = ref<number | null>(null);

function onMonitorDragStart(m: VehicleMonitor, e: DragEvent) {
  if (!canEdit.value) return;
  dragMonitorId.value = m.id;
  e.dataTransfer?.setData("text/plain", String(m.id));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onMonitorDragEnd() {
  dragMonitorId.value = null;
  dragOverVehicleId.value = null;
}

function onVehicleDragOver(v: Vehicle, e: DragEvent) {
  if (dragMonitorId.value == null) return;
  e.preventDefault(); // erlaubt das Drop
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dragOverVehicleId.value = v.id;
}

function onVehicleDragLeave(v: Vehicle) {
  if (dragOverVehicleId.value === v.id) dragOverVehicleId.value = null;
}

async function onMonitorDrop(v: Vehicle) {
  const id = dragMonitorId.value;
  dragOverVehicleId.value = null;
  dragMonitorId.value = null;
  if (id == null) return;
  // Bereits auf diesem Fahrzeug? Dann nichts tun (spart einen Serveraufruf).
  if (v.monitors.some((m) => m.id === id)) return;
  await store.moveMonitorToVehicle(id, v.id);
}

function goToMonitor(id: number) {
  router.push({ name: "monitor", params: { id } });
}

// Nimmt einen Monitor aus seinem Fahrzeug (löscht ihn nicht, setzt nur
// vehicle_id = null, sodass er wieder frei zuweisbar ist).
async function removeFromVehicle(m: VehicleMonitor) {
  await store.moveMonitorToVehicle(m.id, null);
}
</script>

<template>
  <div class="page-head">
    <h1>Projects</h1>
    <div class="page-actions">
      <button v-if="canEdit" class="btn btn-primary" @click="openNewProject">
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
        <div v-if="canEdit" class="project-actions">
          <button class="btn btn-sm" @click="openNewVehicle(p)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Fahrzeug
          </button>
          <button class="btn btn-sm" @click="openEditProject(p)">
            ✏️ Bearbeiten
          </button>
          <button class="btn btn-sm btn-danger" @click="removeProject(p)">
            ✕ Löschen
          </button>
        </div>
      </div>

      <p v-if="p.description" class="project-desc">{{ p.description }}</p>

      <div v-if="p.vehicles.length === 0" class="project-empty">
        Noch keine Fahrzeuge.
      </div>

      <div v-else class="vehicle-list">
        <div
          v-for="v in p.vehicles"
          :key="v.id"
          class="vehicle"
          :class="{ 'vehicle-drop': dragOverVehicleId === v.id }"
          @dragover="onVehicleDragOver(v, $event)"
          @dragleave="onVehicleDragLeave(v)"
          @drop.prevent="onMonitorDrop(v)"
        >
          <div class="vehicle-head">
            <span class="vehicle-name">🚆 {{ v.name }}</span>
            <div v-if="canEdit" class="vehicle-actions">
              <button
                class="btn btn-sm btn-icon"
                title="Monitore zuweisen"
                aria-label="Monitore zuweisen"
                @click="openAssign(v)"
              >
                🖥️
              </button>
              <button
                class="btn btn-sm btn-icon"
                title="Fahrzeug umbenennen"
                aria-label="Fahrzeug umbenennen"
                @click="openEditVehicle(v)"
              >
                ✏️
              </button>
              <button
                class="btn btn-sm btn-icon btn-icon-danger"
                title="Fahrzeug löschen"
                aria-label="Fahrzeug löschen"
                @click="removeVehicle(v)"
              >
                ✕
              </button>
            </div>
          </div>

          <div class="vehicle-monitors">
            <template v-if="v.monitors.length">
              <div
                v-for="m in v.monitors"
                :key="m.id"
                class="mon-card"
                :class="{ 'mon-dragging': dragMonitorId === m.id }"
              >
                <span
                  v-if="canEdit"
                  class="drag-handle"
                  draggable="true"
                  title="Ziehen, um den Monitor einem anderen Fahrzeug zuzuweisen"
                  aria-label="Zu anderem Fahrzeug ziehen"
                  @dragstart="onMonitorDragStart(m, $event)"
                  @dragend="onMonitorDragEnd"
                  >⠿</span
                >
                <span class="led" :class="monitorStatusCls(m.id)"></span>
                <span class="mon-card-name">{{ m.name }}</span>
                <button
                  v-if="canEdit"
                  class="mon-detail"
                  title="Monitor-Details öffnen"
                  aria-label="Monitor-Details öffnen"
                  draggable="false"
                  @click.stop="goToMonitor(m.id)"
                  @mousedown.stop
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
                <button
                  v-if="hasUrl(m.id)"
                  class="mon-open"
                  title="Website öffnen"
                  aria-label="Website öffnen"
                  draggable="false"
                  @click.stop="openMonitorUrl(m.id)"
                  @mousedown.stop
                >
                  🌐
                </button>
                <button
                  v-if="canEdit"
                  class="mon-remove"
                  title="Aus Fahrzeug entfernen"
                  aria-label="Aus Fahrzeug entfernen"
                  draggable="false"
                  @click.stop="removeFromVehicle(m)"
                  @mousedown.stop
                >
                  ✕
                </button>
              </div>
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
        <input v-model="vehicleName" placeholder="z. B. Zug" />
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
          <label
            v-for="mon in monitors"
            :key="mon.id"
            class="pick-row"
            :class="{ 'pick-row-disabled': assignedElsewhere(mon.id) }"
          >
            <input
              type="checkbox"
              :checked="selectedMonitorIds.includes(mon.id)"
              :disabled="assignedElsewhere(mon.id)"
              @change="toggleMonitor(mon.id)"
            />
            <span class="led" :class="monitorStatusCls(mon.id)"></span>
            <span class="pick-name">{{ mon.name }}</span>
            <span v-if="assignedElsewhere(mon.id)" class="pick-note">
              bereits an „{{ monitorAssignment.get(mon.id)?.vehicleName }}“
            </span>
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
  /* Trennlinie zwischen Kopf und Inhalt der Projekt-Karte. */
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
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
/* Projekt-Karte: Buttons mit Icon + Beschriftung, kompakt. */
.project-actions .btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  font-size: var(--fs-sm);
}
/* Aktions-Icons der Fahrzeug-Karte: etwas kleiner, mit Scale beim Hover. */
.vehicle-actions .btn-icon {
  width: 26px;
  height: 26px;
  font-size: var(--fs-md);
  transition: transform 0.12s, background 0.15s, border-color 0.15s;
}
.vehicle-actions .btn-icon:hover {
  transform: scale(1.18);
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
  /* Fahrzeug-Karten als Zeilen: mindestens 300px breit, wachsen aber mit und
     füllen den verfügbaren Platz (auto-fit dehnt vorhandene Karten aus). */
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
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
  transition: border-color 0.15s, background 0.15s;
}
/* Aktives Drop-Ziel beim Ziehen eines Monitors auf dieses Fahrzeug. */
.vehicle-drop {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elev-2));
}
.vehicle-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  /* Trennlinie zwischen Kopf und Inhalt der Fahrzeug-Karte. */
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.vehicle-name {
  font-weight: 600;
  font-size: 14px;
}
.vehicle-monitors {
  /* Monitor-Pillen untereinander (eine Spalte), jede über die volle Breite. */
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}
.mon-card {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 12px;
  color: var(--text);
  /* Transparente Pill mit dünnem, dezentem Rahmen in der App-Farbe. */
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  padding: 4px 6px 4px 8px;
  border-radius: 999px;
  transition: border-color 0.15s, background 0.15s;
}
/* Griff skaliert beim Hover wie die übrigen Icons. */
.mon-card .drag-handle {
  transition: transform 0.12s, color 0.15s;
}
.mon-card .drag-handle:hover {
  transform: scale(1.25);
  color: var(--accent);
}
/* Die gerade gezogene Karte abschwächen. */
.mon-dragging {
  opacity: 0.4;
}
.mon-card .led {
  width: 9px;
  height: 9px;
}
.mon-card-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Kleine, runde Aktions-Buttons in der Pill (Details / Website öffnen / Entfernen). */
.mon-detail,
.mon-open,
.mon-remove {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s, background 0.15s, transform 0.12s;
}
.mon-detail:hover,
.mon-open:hover,
.mon-remove:hover {
  transform: scale(1.25);
}
.mon-detail:hover,
.mon-open:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
.mon-remove:hover {
  color: var(--down);
  background: color-mix(in srgb, var(--down) 15%, transparent);
}
/* Leerer-Zustand-Text spannt über beide Spalten. */
.chip-empty {
  grid-column: 1 / -1;
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
.pick-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Bereits an ein anderes Fahrzeug vergebener Monitor: nicht auswählbar. */
.pick-row-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.pick-row-disabled input {
  cursor: not-allowed;
}
.pick-note {
  flex-shrink: 0;
  font-size: 11px;
  font-style: italic;
  color: var(--text-dim);
}
</style>
