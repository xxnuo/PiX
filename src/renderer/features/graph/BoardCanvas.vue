<script setup lang="ts">
import { Folder, Plus } from "@lucide/vue";
import { VueFlow, type NodeMouseEvent } from "@vue-flow/core";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ProjectGroup } from "../../../shared/types";
import { boardRootPosition } from "../../../shared/boards";
import Button from "../../components/ui/Button.vue";
import { useBoardStore } from "../../stores/boards";
import { useSessionStore } from "../../stores/session";
import { useLayoutStore } from "../../stores/layout";
import FolderNode from "./FolderNode.vue";

const emit = defineEmits<{ pickProject: []; activateProject: [record: ProjectGroup]; createProjectSession: [record: ProjectGroup]; openProjectSession: [record: ProjectGroup, path: string] }>();
const boards = useBoardStore();
const session = useSessionStore();
const layout = useLayoutStore();
const { t } = useI18n();
const roots = computed(() => (boards.active?.projectIds ?? []).map((id, index) => {
  const record = session.projects.find(item => item.id === id);
  return { id: `folder:${id}`, type: "folder", position: boardRootPosition(boards.active, id, index),
    data: { record, onCreate: () => { if (record) emit("createProjectSession", record); } } };
}));
const sessions = computed(() => (boards.active?.sessions ?? []).flatMap(item => {
  const record = session.projects.find(value => value.id === item.projectId);
  if (!record) return [];
  const folderIndex = boards.active!.projectIds.indexOf(item.projectId);
  const slot = boards.active!.sessions!.filter(value => value.projectId === item.projectId).findIndex(value => value.path === item.path);
  const root = boardRootPosition(boards.active, item.projectId, folderIndex);
  const summary = record.sessions.find(value => value.path === item.path);
  return [{ id: `session:${JSON.stringify([item.projectId, item.path])}`, type: "session", draggable: false, position: { x: root.x + 300, y: root.y + Math.max(0, slot) * 470 },
    data: { record, path: item.path, name: summary?.name || (summary?.messageCount ? summary.firstMessage : summary?.id) || item.path } }];
}));
const nodes = computed(() => [...roots.value, ...sessions.value]);
const edges = computed(() => sessions.value.map(node => ({ id: `edge:${node.id}`, source: `folder:${node.data.record.id}`, target: node.id, class: "folder-edge" })));
function open(event: NodeMouseEvent) {
  if (event.node.type === "session") {
    emit("openProjectSession", event.node.data.record as ProjectGroup, String(event.node.data.path));
    return;
  }
  const record = session.projects.find(item => `folder:${item.id}` === event.node.id);
  if (record) emit("activateProject", record);
}
async function placed(event: NodeMouseEvent) {
  if (event.node.type !== "folder") return;
  try { await boards.place(event.node.id.slice(7), event.node.position.x, event.node.position.y); }
  catch (error) { layout.showNotice(String(error), "error"); }
}
</script>

<template>
  <main class="panel graph-panel board-canvas" data-board-canvas>
    <div class="board-canvas-title">
      <strong>{{ boards.active?.name }}</strong>
      <Button variant="ghost" @click="emit('pickProject')"><Plus :size="15" />{{ t('boards.addFolder') }}</Button>
    </div>
    <VueFlow v-if="nodes.length" :key="boards.active?.id" class="session-flow board-flow" :nodes="nodes" :edges="edges"
      :min-zoom="0.25" :max-zoom="1.6" :fit-view-on-init="true" :nodes-draggable="true" :pan-on-drag="true"
      @node-click="open" @node-drag-stop="placed">
      <template #node-folder="props">
        <FolderNode :id="props.id.slice(7)" :record="props.data.record" :active="props.id === `folder:${session.activeProjectId}`" :session-count="boards.active?.sessions?.filter(item => item.projectId === props.id.slice(7)).length ?? 0" :on-create="props.data.onCreate" />
      </template>
      <template #node-session="props">
        <div class="board-session-stub" :title="props.data.path">{{ props.data.name }}</div>
      </template>
    </VueFlow>
    <div v-else class="graph-empty">
      <div aria-hidden="true"><Folder :size="60" :stroke-width="1.6" /></div>
      <span>{{ t('boards.noFolders') }}</span>
      <Button @click="emit('pickProject')">{{ t('boards.addFolder') }}</Button>
    </div>
  </main>
</template>
