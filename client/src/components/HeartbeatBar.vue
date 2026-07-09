<script setup lang="ts">
import { computed, ref } from "vue";
import type { Heartbeat } from "../types";

const props = defineProps<{
  // May contain nulls: callers that bin beats into fixed time buckets pass a
  // null for any empty bucket (rendered as a "no data" placeholder).
  beats: (Heartbeat | null)[];
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

function statusClass(status: number): string {
  if (status === 1) return "up";
  if (status === 2) return "degraded";
  if (status === 3) return "maintenance";
  return "down";
}

// Custom tooltip state: which cell is hovered and where to anchor the bubble.
const barEl = ref<HTMLElement | null>(null);
const hovered = ref<number | null>(null);
const tipLeft = ref(0);

const hoveredBeat = computed(() =>
  hovered.value === null ? null : cells.value[hovered.value],
);

function onEnter(i: number, event: MouseEvent) {
  hovered.value = i;
  const cell = event.currentTarget as HTMLElement;
  const bar = barEl.value;
  if (!bar) return;
  // Anchor the tooltip to the centre of the hovered bar, measured relative
  // to the bar container so the bubble can be absolutely positioned.
  const cellRect = cell.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  tipLeft.value = cellRect.left - barRect.left + cellRect.width / 2;
}

function onLeave() {
  hovered.value = null;
}
</script>

<template>
  <div ref="barEl" class="heartbeat-bar" :class="{ paused }">
    <div
      v-for="(b, i) in cells"
      :key="i"
      class="hb"
      :class="[
        {
          up: !paused && b?.status === 1,
          degraded: !paused && b?.status === 2,
          maintenance: !paused && b?.status === 3,
          down: !paused && b?.status === 0,
          active: hovered === i,
        },
      ]"
      :style="{ height: b ? '100%' : '55%' }"
      @mouseenter="onEnter(i, $event)"
      @mouseleave="onLeave"
    ></div>

    <Transition name="hb-tip">
      <div
        v-if="hovered !== null"
        class="hb-tooltip"
        :style="{ left: tipLeft + 'px' }"
      >
        <template v-if="paused">
          <div class="hb-tooltip-head">
            <span class="hb-dot paused"></span>
            <span>Paused</span>
          </div>
        </template>
        <template v-else-if="hoveredBeat">
          <div class="hb-tooltip-head">
            <span class="hb-dot" :class="statusClass(hoveredBeat.status)"></span>
            <span>{{ statusText(hoveredBeat.status) }}</span>
          </div>
          <div v-if="hoveredBeat.message" class="hb-tooltip-msg">
            {{ hoveredBeat.message }}
          </div>
          <div class="hb-tooltip-time">
            {{ new Date(hoveredBeat.time * 1000).toLocaleString() }}
          </div>
        </template>
        <template v-else>
          <div class="hb-tooltip-head">
            <span class="hb-dot empty"></span>
            <span>No data</span>
          </div>
        </template>
      </div>
    </Transition>
  </div>
</template>
