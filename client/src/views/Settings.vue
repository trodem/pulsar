<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useGroupStore } from "../stores/groups";
import { useTagStore } from "../stores/tags";
import type { Group, Tag } from "../types";

const groupStore = useGroupStore();
const tagStore = useTagStore();

onMounted(() => {
  groupStore.fetchAll();
  tagStore.fetchAll();
});

// --- Groups ---------------------------------------------------------------
const newGroup = reactive({ name: "" });
const groupError = ref("");

async function addGroup() {
  groupError.value = "";
  if (!newGroup.name.trim()) {
    groupError.value = "Group name is required.";
    return;
  }
  try {
    // Neue Gruppen erhalten die Standard-Sortierung (0); die Reihenfolge lässt
    // sich weiterhin in der Tabelle darunter anpassen.
    await groupStore.create({
      name: newGroup.name.trim(),
      position: 0,
    });
    newGroup.name = "";
  } catch (e: any) {
    groupError.value = e.response?.data?.error ?? "Could not create group.";
  }
}

async function saveGroup(g: Group) {
  await groupStore.update(g.id, {
    name: g.name,
    position: Number(g.position) || 0,
  });
}

async function removeGroup(g: Group) {
  if (
    confirm(
      `Delete group "${g.name}"? Its monitors are kept and moved to Ungrouped.`,
    )
  ) {
    await groupStore.remove(g.id);
  }
}

// --- Gruppen per Drag & Drop sortieren ------------------------------------
// dragId = gezogene Gruppe, dragOverId = aktuell überfahrene Zeile, dropAfter =
// ob unterhalb der Zeilenmitte losgelassen wird (Einfügemarke oben/unten).
const dragId = ref<number | null>(null);
const dragOverId = ref<number | null>(null);
const dropAfter = ref(false);

function onGroupDragStart(g: Group, e: DragEvent) {
  dragId.value = g.id;
  // Firefox startet den Drag nur, wenn Transfer-Daten gesetzt sind.
  e.dataTransfer?.setData("text/plain", String(g.id));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onGroupDragOver(g: Group, e: DragEvent) {
  if (dragId.value == null || dragId.value === g.id) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropAfter.value = e.clientY > rect.top + rect.height / 2;
  dragOverId.value = g.id;
}

function onGroupDragLeave(g: Group) {
  if (dragOverId.value === g.id) dragOverId.value = null;
}

function onGroupDragEnd() {
  dragId.value = null;
  dragOverId.value = null;
}

async function onGroupDrop(target: Group) {
  const id = dragId.value;
  const after = dropAfter.value;
  dragOverId.value = null;
  dragId.value = null;
  if (id == null || id === target.id) return;
  const dragged = groupStore.items.find((g) => g.id === id);
  if (!dragged) return;
  const arr = groupStore.items.filter((g) => g.id !== id);
  const targetIdx = arr.findIndex((g) => g.id === target.id);
  if (targetIdx < 0) return;
  arr.splice(after ? targetIdx + 1 : targetIdx, 0, dragged);
  await groupStore.reorder(arr);
}

// --- Tags -----------------------------------------------------------------
const newTag = reactive({ name: "", color: "#4f9dff" });
const tagError = ref("");

async function addTag() {
  tagError.value = "";
  if (!newTag.name.trim()) {
    tagError.value = "Tag name is required.";
    return;
  }
  try {
    await tagStore.create({ name: newTag.name.trim(), color: newTag.color });
    newTag.name = "";
    newTag.color = "#4f9dff";
  } catch (e: any) {
    tagError.value = e.response?.data?.error ?? "Could not create tag.";
  }
}

async function saveTag(t: Tag) {
  await tagStore.update(t.id, { name: t.name, color: t.color });
}

async function removeTag(t: Tag) {
  if (
    confirm(`Delete tag "${t.name}"? It is removed from all monitors.`)
  ) {
    await tagStore.remove(t.id);
  }
}
</script>

<template>
  <div class="page-head">
    <h1>Settings</h1>
  </div>

  <div class="settings-grid">
  <section class="settings-block">
    <h2>Groups</h2>
    <p class="muted">
      Groups organize the dashboard into sections. A monitor belongs to at most
      one group.
    </p>

    <div v-if="groupError" class="error-msg">{{ groupError }}</div>

    <div class="settings-add">
      <input v-model="newGroup.name" placeholder="Group name" @keyup.enter="addGroup" />
      <button class="btn btn-primary" @click="addGroup">+ Add group</button>
    </div>

    <div v-if="groupStore.items.length === 0" class="muted">No groups yet.</div>
    <table v-else class="settings-table">
      <thead>
        <tr>
          <th class="drag-col"></th>
          <th>Name</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="g in groupStore.items"
          :key="g.id"
          :class="{
            dragging: dragId === g.id,
            'drag-over-before': dragOverId === g.id && !dropAfter,
            'drag-over-after': dragOverId === g.id && dropAfter,
          }"
          @dragover="onGroupDragOver(g, $event)"
          @dragleave="onGroupDragLeave(g)"
          @drop.prevent="onGroupDrop(g)"
        >
          <td class="drag-cell">
            <span
              class="drag-handle"
              draggable="true"
              title="Zum Sortieren ziehen"
              @dragstart="onGroupDragStart(g, $event)"
              @dragend="onGroupDragEnd"
              >⠿</span
            >
          </td>
          <td><input v-model="g.name" @blur="saveGroup(g)" @keyup.enter="saveGroup(g)" /></td>
          <td class="row-actions">
            <button class="btn btn-sm btn-danger" @click="removeGroup(g)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>

  <section class="settings-block">
    <h2>Tags</h2>
    <p class="muted">
      Tags are colored labels you can attach to any number of monitors and use
      to filter the dashboard.
    </p>

    <div v-if="tagError" class="error-msg">{{ tagError }}</div>

    <div class="settings-add">
      <input v-model="newTag.name" placeholder="Tag name" @keyup.enter="addTag" />
      <input v-model="newTag.color" type="color" class="color-input" title="Tag color" />
      <button class="btn btn-primary" @click="addTag">+ Add tag</button>
    </div>

    <div v-if="tagStore.items.length === 0" class="muted">No tags yet.</div>
    <table v-else class="settings-table">
      <thead>
        <tr>
          <th>Name</th>
          <th class="pos-col">Color</th>
          <th>Preview</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in tagStore.items" :key="t.id">
          <td><input v-model="t.name" @blur="saveTag(t)" @keyup.enter="saveTag(t)" /></td>
          <td>
            <input v-model="t.color" type="color" class="color-input" @change="saveTag(t)" />
          </td>
          <td>
            <span
              class="tag-chip readonly"
              :style="{ background: t.color, borderColor: t.color }"
            >
              {{ t.name || "tag" }}
            </span>
          </td>
          <td class="row-actions">
            <button class="btn btn-sm btn-danger" @click="removeTag(t)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
  </div>
</template>
