<script setup lang="ts">
import { Folder, FolderSync } from "@lucide/vue";
import { Handle, Position } from "@vue-flow/core";
import { useI18n } from "vue-i18n";
import type { ProjectGroup } from "../../../shared/types";

defineProps<{ id: string; record?: ProjectGroup; active: boolean; sessionCount: number; onCreate: () => void }>();
const { t } = useI18n();
</script>

<template>
  <div class="board-root" :class="{ active }" :title="record?.project.path ?? id">
    <Handle type="source" :position="Position.Right" />
    <div class="board-root-heading">
      <FolderSync v-if="record?.project.remote" :size="20" />
      <Folder v-else :size="20" />
      <strong>{{ record?.project.name ?? id }}</strong>
    </div>
    <small>{{ record?.project.path ?? t('boards.missingFolder') }}</small>
    <span>{{ t('boards.sessionCount', { n: sessionCount }) }}</span>
    <button v-if="record" class="nodrag" type="button" @click.stop="onCreate">{{ t('nav.newSession') }}</button>
  </div>
</template>
