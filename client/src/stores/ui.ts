import { defineStore } from "pinia";
import { ref } from "vue";

// Small cross-component channel so global toolbar buttons (in App.vue) can
// trigger page-owned actions like opening the "new monitor" form on Dashboard.
export const useUiStore = defineStore("ui", () => {
  // Incremented every time the global "New monitor" button is pressed;
  // Dashboard watches this and opens its form.
  const newMonitorRequests = ref(0);
  function requestNewMonitor() {
    newMonitorRequests.value++;
  }

  // Free-text monitor search, owned by the global toolbar (App.vue) and read by
  // the Dashboard to filter its list by monitor name or target.
  const monitorSearch = ref("");

  // Tag ids selected in the global toolbar's tag filter. Empty = show all. A
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

  return {
    newMonitorRequests,
    requestNewMonitor,
    monitorSearch,
    activeTagIds,
    toggleTagFilter,
    clearTagFilter,
  };
});
