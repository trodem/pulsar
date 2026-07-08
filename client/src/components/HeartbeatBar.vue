<script setup lang="ts">
import { computed } from "vue";
import type { Heartbeat } from "../types";

const props = defineProps<{ beats: Heartbeat[]; slots?: number }>();

// Pad with empty placeholders so the bar keeps a stable width.
const cells = computed(() => {
  const total = props.slots ?? 40;
  const beats = props.beats.slice(-total);
  const pad = Math.max(0, total - beats.length);
  return [
    ...Array.from({ length: pad }, () => null),
    ...beats,
  ] as (Heartbeat | null)[];
});

function title(b: Heartbeat | null): string {
  if (!b) return "No data";
  const when = new Date(b.time * 1000).toLocaleString();
  return `${b.status === 1 ? "Up" : "Down"} · ${b.message} · ${when}`;
}
</script>

<template>
  <div class="heartbeat-bar">
    <div
      v-for="(b, i) in cells"
      :key="i"
      class="hb"
      :class="{ up: b?.status === 1, down: b?.status === 0 }"
      :style="{ height: b ? '100%' : '55%' }"
      :title="title(b)"
    ></div>
  </div>
</template>
