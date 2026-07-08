import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api";
import type { Notification } from "../types";

export const useNotificationStore = defineStore("notifications", () => {
  const items = ref<Notification[]>([]);

  async function fetchAll() {
    const { data } = await api.get<Notification[]>("/notifications");
    items.value = data;
  }

  async function create(payload: Partial<Notification>) {
    await api.post("/notifications", payload);
    await fetchAll();
  }

  async function update(id: number, payload: Partial<Notification>) {
    await api.put(`/notifications/${id}`, payload);
    await fetchAll();
  }

  async function remove(id: number) {
    await api.delete(`/notifications/${id}`);
    items.value = items.value.filter((n) => n.id !== id);
  }

  async function test(type: string, config: Record<string, any>) {
    await api.post("/notifications/test", { type, config });
  }

  return { items, fetchAll, create, update, remove, test };
});
