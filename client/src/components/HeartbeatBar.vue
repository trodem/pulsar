<script setup lang="ts">
import { computed } from "vue";
import type { Heartbeat } from "../types";

const props = defineProps<{
  beats: Heartbeat[];
  slots?: number;
  paused?: boolean;
}>();

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

function statusText(status: number): string {
  if (status === 1) return "Up";
  if (status === 2) return "Degraded";
  if (status === 3) return "Maintenance";
  return "Down";
}

function title(b: Heartbeat | null): string {
  if (!b) return "No data";
  const when = new Date(b.time * 1000).toLocaleString();
  return `${statusText(b.status)} · ${b.message} · ${when}`;
}
</script>

<template>
  <div class="heartbeat-bar" :class="{ paused }">
    <div
      v-for="(b, i) in cells"
      :key="i"
      class="hb"
      :class="{
        up: !paused && b?.status === 1,
        degraded: !paused && b?.status === 2,
        maintenance: !paused && b?.status === 3,
        down: !paused && b?.status === 0,
      }"
      :style="{ height: b ? '100%' : '55%' }"
      :title="paused ? 'Paused' : title(b)"
    ></div>
  </div>
</template>
