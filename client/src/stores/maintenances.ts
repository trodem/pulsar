import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api";
import type { Maintenance } from "../types";

export const useMaintenanceStore = defineStore("maintenances", () => {
  const items = ref<Maintenance[]>([]);

  async function fetchAll() {
    const { data } = await api.get<Maintenance[]>("/maintenances");
    items.value = data;
  }

  async function create(payload: Partial<Maintenance>) {
    await api.post("/maintenances", payload);
    await fetchAll();
  }

  async function update(id: number, payload: Partial<Maintenance>) {
    await api.put(`/maintenances/${id}`, payload);
    await fetchAll();
  }

  async function toggle(id: number) {
    await api.patch(`/maintenances/${id}/toggle`);
    await fetchAll();
  }

  async function remove(id: number) {
    await api.delete(`/maintenances/${id}`);
    items.value = items.value.filter((m) => m.id !== id);
  }

  return { items, fetchAll, create, update, toggle, remove };
});
