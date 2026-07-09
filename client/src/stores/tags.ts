import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api";
import type { Tag } from "../types";

export const useTagStore = defineStore("tags", () => {
  const items = ref<Tag[]>([]);

  async function fetchAll() {
    const { data } = await api.get<Tag[]>("/tags");
    items.value = data;
  }

  async function create(payload: Partial<Tag>) {
    await api.post("/tags", payload);
    await fetchAll();
  }

  async function update(id: number, payload: Partial<Tag>) {
    await api.put(`/tags/${id}`, payload);
    await fetchAll();
  }

  async function remove(id: number) {
    await api.delete(`/tags/${id}`);
    items.value = items.value.filter((t) => t.id !== id);
  }

  return { items, fetchAll, create, update, remove };
});
