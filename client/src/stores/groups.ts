import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api";
import type { Group } from "../types";

export const useGroupStore = defineStore("groups", () => {
  const items = ref<Group[]>([]);

  async function fetchAll() {
    const { data } = await api.get<Group[]>("/groups");
    items.value = data;
  }

  async function create(payload: Partial<Group>) {
    await api.post("/groups", payload);
    await fetchAll();
  }

  async function update(id: number, payload: Partial<Group>) {
    await api.put(`/groups/${id}`, payload);
    await fetchAll();
  }

  async function remove(id: number) {
    await api.delete(`/groups/${id}`);
    items.value = items.value.filter((g) => g.id !== id);
  }

  // Persistiert eine neue Reihenfolge (per Drag & Drop). Es gibt keinen Bulk-
  // Endpunkt, daher schreiben wir für jede Gruppe die neue position (= Index).
  // Optimistisch: lokale Liste sofort aktualisieren, bei Fehler neu laden.
  async function reorder(ordered: Group[]) {
    ordered.forEach((g, i) => {
      g.position = i;
    });
    items.value = [...ordered];
    try {
      await Promise.all(
        ordered.map((g, i) =>
          api.put(`/groups/${g.id}`, { name: g.name, position: i }),
        ),
      );
    } catch {
      await fetchAll();
    }
  }

  return { items, fetchAll, create, update, remove, reorder };
});
