import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api";
import type { Project } from "../types";

// Store für Projekte samt Fahrzeugen. Nach mutierenden Aktionen wird jeweils neu
// geladen, damit die verschachtelte Struktur (Projekt → Fahrzeug → Monitore)
// konsistent bleibt.
export const useProjectStore = defineStore("projects", () => {
  const items = ref<Project[]>([]);

  async function fetchAll() {
    const { data } = await api.get<Project[]>("/projects");
    items.value = data;
  }

  async function create(payload: { name: string; description?: string }) {
    await api.post("/projects", payload);
    await fetchAll();
  }

  async function update(
    id: number,
    payload: { name: string; description?: string },
  ) {
    await api.put(`/projects/${id}`, payload);
    await fetchAll();
  }

  async function remove(id: number) {
    await api.delete(`/projects/${id}`);
    items.value = items.value.filter((p) => p.id !== id);
  }

  async function addVehicle(projectId: number, name: string) {
    await api.post(`/projects/${projectId}/vehicles`, { name });
    await fetchAll();
  }

  async function updateVehicle(vehicleId: number, name: string) {
    await api.put(`/projects/vehicles/${vehicleId}`, { name });
    await fetchAll();
  }

  async function removeVehicle(vehicleId: number) {
    await api.delete(`/projects/vehicles/${vehicleId}`);
    await fetchAll();
  }

  // Setzt die komplette Monitor-Zuordnung eines Fahrzeugs (voller Ersatz).
  async function setVehicleMonitors(vehicleId: number, monitorIds: number[]) {
    await api.put(`/projects/vehicles/${vehicleId}/monitors`, { monitorIds });
    await fetchAll();
  }

  // Verschiebt einen einzelnen Monitor auf ein Fahrzeug (Drag & Drop), auch
  // projektübergreifend. vehicleId=null hebt die Zuweisung auf.
  async function moveMonitorToVehicle(
    monitorId: number,
    vehicleId: number | null,
  ) {
    await api.put(`/projects/monitors/${monitorId}/vehicle`, { vehicleId });
    await fetchAll();
  }

  return {
    items,
    fetchAll,
    create,
    update,
    remove,
    addVehicle,
    updateVehicle,
    removeVehicle,
    setVehicleMonitors,
    moveMonitorToVehicle,
  };
});
