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

  return { items, fetchAll, create, update, remove };
});
