import { defineStore } from "pinia";
import { ref } from "vue";

// Shared UI state for the Dashboard's toolbar (search + tag filter), kept in a
// store so it survives navigation away from and back to the Dashboard.
export const useUiStore = defineStore("ui", () => {
  // Free-text monitor search, driven by the Dashboard toolbar and read by the
  // Dashboard to filter its list by monitor name or target.
  const monitorSearch = ref("");

  // Tag ids selected in the Dashboard toolbar's tag filter. Empty = show all. A
  // monitor passes when it carries at least one of the selected tags.
  const activeTagIds = ref<Set<number>>(new Set());
  function toggleTagFilter(id: number) {
    const next = new Set(activeTagIds.value);
    next.has(id) ? next.delete(id) : next.add(id);
    activeTagIds.value = next;
  }
  function clearTagFilter() {
    activeTagIds.value = new Set();
  }

  // Status code selected in the Monitors toolbar's status filter. `null` = show
  // all. A monitor passes when its current status equals the selected code
  // (1 up, 2 degraded, 3 maintenance, 0 down). Single-select.
  const activeStatus = ref<number | null>(null);

  // How the Monitors page renders each section: "card" (the detailed grid) or
  // "list" (a compact row per monitor). Persisted so the choice survives
  // reloads; the store keeps it consistent across navigation.
  const MONITOR_VIEW_KEY = "monitors.view";
  const stored = localStorage.getItem(MONITOR_VIEW_KEY);
  const monitorView = ref<"card" | "list">(stored === "list" ? "list" : "card");
  function setMonitorView(view: "card" | "list") {
    monitorView.value = view;
    localStorage.setItem(MONITOR_VIEW_KEY, view);
  }

  return {
    monitorSearch,
    activeTagIds,
    toggleTagFilter,
    clearTagFilter,
    activeStatus,
    monitorView,
    setMonitorView,
  };
});
