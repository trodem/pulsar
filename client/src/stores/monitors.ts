import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api";
import { getSocket } from "../socket";
import type { Heartbeat, LogFileEntry, Monitor } from "../types";

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

  // Heartbeats for a monitor within the last `hours` hours (detail-view scale).
  async function heartbeatsSince(
    id: number,
    hours: number,
  ): Promise<Heartbeat[]> {
    const { data } = await api.get<{ hours: number; heartbeats: Heartbeat[] }>(
      `/monitors/${id}/heartbeats`,
      { params: { hours } },
    );
    return data.heartbeats;
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

  // Reads the monitor's full remote log now and updates its logged-in users.
  async function checkUsers(
    id: number,
  ): Promise<{ users: string[]; error: string | null }> {
    const { data } = await api.post<{ users: string[]; error: string | null }>(
      `/monitors/${id}/check-users`,
    );
    const m = monitors.value.find((x) => x.id === id);
    if (m) {
      m.users = data.users;
      m.usersError = data.error;
    }
    return data;
  }

  // Stops and restarts the remote STAP backend executable for this monitor
  // (or just starts it if it was not running).
  async function restartProgram(
    id: number,
  ): Promise<{ ok: boolean; message: string }> {
    const { data } = await api.post<{ ok: boolean; message: string }>(
      `/monitors/${id}/restart-program`,
    );
    return data;
  }

  // Lists the files in the monitor's remote log folder (for the modal).
  async function logFiles(
    id: number,
  ): Promise<{ folder: string; files: LogFileEntry[] }> {
    const { data } = await api.get<{ folder: string; files: LogFileEntry[] }>(
      `/monitors/${id}/log-files`,
    );
    return data;
  }

  // Downloads all monitors (with their group and tags) as a CSV file. Fetched as
  // a blob (so the JWT is attached) and handed to the browser as a download.
  async function exportMonitorsCsv() {
    const { data } = await api.get("/monitors/export/monitors", {
      responseType: "blob",
    });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const url = URL.createObjectURL(data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pulsar-monitors-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Uploads a CSV file of monitors. Returns how many were imported and skipped;
  // the server validates the format and rejects the whole file on any error.
  async function importMonitorsCsv(
    csvText: string,
  ): Promise<{ imported: number; skipped: number }> {
    const { data } = await api.post<{ imported: number; skipped: number }>(
      "/monitors/import/monitors",
      csvText,
      { headers: { "Content-Type": "text/csv" } },
    );
    await fetchAll();
    return data;
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
    socket.on(
      "monitor:users",
      (p: { monitorId: number; users: string[]; error: string | null }) => {
        const m = monitors.value.find((x) => x.id === p.monitorId);
        if (m) {
          m.users = p.users;
          m.usersError = p.error;
        }
      },
    );
    socketBound = true;
  }

  return {
    monitors,
    loading,
    fetchAll,
    get,
    heartbeatsSince,
    create,
    update,
    toggle,
    remove,
    checkUsers,
    restartProgram,
    logFiles,
    exportMonitorsCsv,
    importMonitorsCsv,
    bindSocket,
  };
});
