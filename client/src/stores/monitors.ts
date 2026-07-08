import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api";
import { getSocket } from "../socket";
import type { Heartbeat, Monitor } from "../types";

export const useMonitorStore = defineStore("monitors", () => {
  const monitors = ref<Monitor[]>([]);
  const loading = ref(false);
  let socketBound = false;

  async function fetchAll() {
    loading.value = true;
    try {
      const { data } = await api.get<Monitor[]>("/monitors");
      monitors.value = data;
    } finally {
      loading.value = false;
    }
  }

  async function get(id: number): Promise<Monitor> {
    const { data } = await api.get<Monitor>(`/monitors/${id}`);
    return data;
  }

  async function create(payload: Partial<Monitor>) {
    await api.post("/monitors", payload);
    await fetchAll();
  }

  async function update(id: number, payload: Partial<Monitor>) {
    await api.put(`/monitors/${id}`, payload);
    await fetchAll();
  }

  async function toggle(id: number) {
    await api.patch(`/monitors/${id}/toggle`);
    await fetchAll();
  }

  async function remove(id: number) {
    await api.delete(`/monitors/${id}`);
    monitors.value = monitors.value.filter((m) => m.id !== id);
  }

  // Apply a live heartbeat pushed over the websocket to local state.
  function applyHeartbeat(monitorId: number, hb: Heartbeat) {
    const m = monitors.value.find((x) => x.id === monitorId);
    if (!m) return;
    const beats = (m.heartbeats ?? []).concat(hb).slice(-40);
    m.heartbeats = beats;
    m.stats = {
      ...(m.stats ?? {
        status: null,
        lastMessage: "",
        lastCheck: null,
        uptime24h: null,
        avgPing: null,
      }),
      status: hb.status,
      lastMessage: hb.message,
      lastCheck: hb.time,
      avgPing: hb.ping ?? m.stats?.avgPing ?? null,
    };
  }

  function bindSocket() {
    if (socketBound) return;
    const socket = getSocket();
    if (!socket) return;
    socket.on("heartbeat", (p: { monitorId: number; heartbeat: Heartbeat }) => {
      applyHeartbeat(p.monitorId, p.heartbeat);
    });
    socketBound = true;
  }

  return {
    monitors,
    loading,
    fetchAll,
    get,
    create,
    update,
    toggle,
    remove,
    bindSocket,
  };
});
