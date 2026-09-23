<script setup lang="ts">
import { Folder, FolderPlus, LayoutDashboard, MoreHorizontal, Plus } from "@lucide/vue";
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from "reka-ui";
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import Button from "../../components/ui/Button.vue";
import { useBoardStore } from "../../stores/boards";
import { useLayoutStore } from "../../stores/layout";

const boards = useBoardStore();
const layout = useLayoutStore();
const { t } = useI18n();
const editing = ref("");
const name = ref("");
const sections = computed(() => [
  ...(boards.state?.groups ?? []).map(group => ({ id: group.id, group })),
  { id: "", group: null },
]);
function inGroup(id: string) { return boards.state?.boards.filter(board => board.groupId === (id || null)) ?? []; }
async function action(promise: Promise<unknown>) {
  try { await promise; }
  catch (error) { layout.showNotice(String(error), "error"); }
}
async function edit(id: string, value: string) {
  editing.value = id;
  name.value = value;
  await nextTick();
  const field = document.querySelector<HTMLInputElement>("[data-board-list] input");
  field?.focus();
  field?.select();
}
function saveName() {
  const id = editing.value;
  if (!id) return;
  editing.value = "";
  if (name.value.trim()) void action(boards.rename(id, name.value.trim()));
}
</script>

<template>
  <div class="board-list" data-board-list>
    <div class="board-list-header">
      <Button variant="ghost" size="icon" :title="t('boards.newGroup')" data-action="new-board-group" @click="action(boards.createGroup())"><FolderPlus :size="15" /></Button>
      <Button variant="ghost" size="icon" :title="t('boards.new')" data-action="new-board" @click="action(boards.create())"><Plus :size="16" /></Button>
    </div>
    <template v-for="section in sections" :key="section.id">
      <div v-if="section.group" class="board-group-row">
        <Folder :size="14" />
        <input v-if="editing === section.id" v-model="name" :aria-label="t('boards.renameGroup')" @keydown.enter="saveName" @keydown.esc="editing = ''" @blur="saveName" />
        <strong v-else>{{ section.group.name }}</strong>
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" :title="t('boards.groupActions')"><MoreHorizontal :size="14" /></Button></DropdownMenuTrigger>
          <DropdownMenuPortal><DropdownMenuContent class="menu-content" :side-offset="5">
            <DropdownMenuItem class="menu-item" @select="edit(section.id, section.group.name)">{{ t('common.rename') }}</DropdownMenuItem>
            <DropdownMenuItem class="menu-item" @select="action(boards.removeGroup(section.id))">{{ t('boards.ungroup') }}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>
      <div v-for="board in inGroup(section.id)" :key="board.id" class="board-row" :class="{ grouped: section.group }">
        <button v-if="editing !== board.id" type="button" class="board-select" :class="{ active: board.id === boards.state?.activeBoardId }" @click="action(boards.select(board.id))">
          <LayoutDashboard :size="16" />
          <span>{{ board.name }}</span>
        </button>
        <input v-else v-model="name" :aria-label="t('boards.rename')" @keydown.enter="saveName" @keydown.esc="editing = ''" @blur="saveName" />
        <DropdownMenuRoot>
          <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" :title="t('boards.actions')"><MoreHorizontal :size="14" /></Button></DropdownMenuTrigger>
          <DropdownMenuPortal><DropdownMenuContent class="menu-content" :side-offset="5">
            <DropdownMenuItem class="menu-item" @select="edit(board.id, board.name)">{{ t('common.rename') }}</DropdownMenuItem>
            <DropdownMenuItem v-if="board.groupId" class="menu-item" @select="action(boards.move(board.id, null))">{{ t('boards.ungroup') }}</DropdownMenuItem>
            <DropdownMenuItem v-for="target in boards.state?.groups ?? []" :key="target.id" class="menu-item" :disabled="target.id === board.groupId" @select="action(boards.move(board.id, target.id))">{{ t('boards.moveTo', { name: target.name }) }}</DropdownMenuItem>
            <DropdownMenuItem class="menu-item danger" :disabled="boards.state?.boards.length === 1" @select="action(boards.remove(board.id))">{{ t('boards.delete') }}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>
    </template>
  </div>
</template>
