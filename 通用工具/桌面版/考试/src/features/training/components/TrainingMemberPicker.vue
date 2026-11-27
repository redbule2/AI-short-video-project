<script setup lang="ts">
// 这里新写的（旧网站没有）：「参加的人」——全选、清空、搜名字，按部门一组组摆，勾组名带上整个部门。
// 只管摆和点：勾了谁、展开了谁都在 useTrainingEditor 里。
import {
  type PickerGroup,
  MAX_MEMBERS,
  tickOf
} from "../memberPicker";

defineOptions({ name: "TrainingMemberPicker" });

const props = defineProps<{
  groups: PickerGroup[];
  picked: ReadonlySet<string>;
  keyword: string;
  /** 这一组现在摊开没有 */
  isExpanded: (groupId: string) => boolean;
}>();

const emit = defineEmits<{
  "update:keyword": [value: string];
  togglePerson: [username: string];
  toggleGroup: [group: PickerGroup];
  toggleExpand: [groupId: string];
  selectAll: [];
  clearAll: [];
}>();

function pickedIn(group: PickerGroup) {
  return group.allUsernames.filter(username => props.picked.has(username))
    .length;
}
</script>

<template>
  <div class="training-picker">
    <div class="training-picker-bar">
      <button
        class="exam-link"
        type="button"
        title="全体成员都勾上；负责人自己要参加，单独勾"
        @click="emit('selectAll')"
      >
        {{ keyword.trim() ? "全选搜到的" : "全选" }}
      </button>
      <button
        class="exam-link"
        type="button"
        title="已停用或已离开的人不会被清掉，要去掉得单独点"
        @click="emit('clearAll')"
      >
        {{ keyword.trim() ? "去掉搜到的" : "清空" }}
      </button>
      <el-input
        :model-value="keyword"
        class="training-picker-search"
        size="small"
        clearable
        placeholder="搜名字、账号、职位"
        aria-label="搜参加的人"
        @update:model-value="emit('update:keyword', String($event ?? ''))"
      />
      <span
        class="training-picker-count exam-mono"
        :class="{ 'is-over': picked.size > MAX_MEMBERS }"
        aria-live="polite"
      >
        已选 {{ picked.size }} 人
        <template v-if="picked.size > MAX_MEMBERS">
          · 最多 {{ MAX_MEMBERS }} 人
        </template>
      </span>
    </div>

    <div class="training-picker-list">
      <div v-if="groups.length === 0" class="assign-empty">
        {{
          keyword.trim()
            ? "没有搜到这个人，换个字试试。"
            : "还没有可以参加的人，先到「账号管理」建账号。"
        }}
      </div>
      <section
        v-for="group in groups"
        :key="group.id"
        class="training-group"
        :style="{ '--training-depth': group.depth - 1 }"
      >
        <header class="training-group-head">
          <el-checkbox
            :model-value="tickOf(group.allUsernames, picked) === 'all'"
            :indeterminate="tickOf(group.allUsernames, picked) === 'some'"
            :aria-label="`${group.name}：整组勾上或去掉`"
            @change="emit('toggleGroup', group)"
          />
          <button
            class="training-group-name"
            type="button"
            :aria-expanded="isExpanded(group.id)"
            :disabled="group.people.length === 0"
            @click="emit('toggleExpand', group.id)"
          >
            <span
              v-if="group.people.length > 0"
              class="training-group-caret"
              aria-hidden="true"
            >
              {{ isExpanded(group.id) ? "▾" : "▸" }}
            </span>
            <span class="training-group-title">{{ group.name }}</span>
            <span class="training-group-count exam-mono">
              {{ pickedIn(group) }} / {{ group.allUsernames.length }} 人
            </span>
          </button>
        </header>
        <div
          v-if="isExpanded(group.id) && group.people.length > 0"
          class="training-people"
        >
          <el-checkbox
            v-for="person in group.people"
            :key="person.username"
            :model-value="picked.has(person.username)"
            @change="emit('togglePerson', person.username)"
          >
            <span class="training-person-name">{{ person.displayName }}</span>
            <span v-if="person.isOwner" class="assign-sub-owner">我自己</span>
            <span v-if="person.title" class="training-person-note">
              {{ person.title }}
            </span>
            <!-- 账号也写上：两个人重名时靠它分 -->
            <span
              v-if="person.username !== person.displayName"
              class="training-person-note exam-mono"
            >
              {{ person.username }}
            </span>
            <span v-if="person.gone" class="training-person-note">
              去掉后加不回来
            </span>
          </el-checkbox>
        </div>
      </section>
    </div>
  </div>
</template>
