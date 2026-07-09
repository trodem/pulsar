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

  return { newMonitorRequests, requestNewMonitor };
});
