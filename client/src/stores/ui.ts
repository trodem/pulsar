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

  // Status codes selected in the Monitors toolbar's status filter. Empty = show
  // all. A monitor passes when its current status is one of the selected codes
  // (1 up, 2 degraded, 3 maintenance, 0 down).
  const activeStatuses = ref<Set<number>>(new Set());
  function toggleStatusFilter(status: number) {
    const next = new Set(activeStatuses.value);
    next.has(status) ? next.delete(status) : next.add(status);
    activeStatuses.value = next;
  }
  function clearStatusFilter() {
    activeStatuses.value = new Set();
  }

  return {
    monitorSearch,
    activeTagIds,
    toggleTagFilter,
    clearTagFilter,
    activeStatuses,
    toggleStatusFilter,
    clearStatusFilter,
  };
});
