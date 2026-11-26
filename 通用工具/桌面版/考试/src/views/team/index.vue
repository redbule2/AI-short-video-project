<script setup lang="ts">
// 壳子自己的（不是照搬的）：「我的团队」——一个部门一组，团队里的人一页看全。
// 样子照考试页的「清样纸」（views/exam/exam-shared.css），和旁边「账号管理」一样宽，切过去不跳。
// 团队里人人能看；建部门、调人、改职位只有团队负责人看得到。建账号、停用、重置密码在旁边「账号管理」那一页。
import { computed } from "vue";
import type { TeamMember } from "@/api/team";
import { useTeam } from "@/features/team/useTeam";
import { avatarText } from "@/utils/avatar";
import "../exam/exam-shared.css";

defineOptions({ name: "MyTeam" });

const {
  TOP,
  overview,
  loadState,
  loadError,
  saving,
  departmentForm,
  memberForm,
  canManage,
  members,
  departments,
  groups,
  departmentChoices,
  memberDepartmentChoices,
  load,
  openCreateDepartment,
  openEditDepartment,
  saveDepartment,
  removeDepartment,
  openMember,
  saveMember
} = useTeam();

// 「发消息」：叫壳子打开左边的「消息」、进和这个人的私聊（老壳子没有这一样，钮就不出来）
const desk = (window as unknown as { desk?: { openChat?: (username: string) => void } }).desk;
const chatReady = !!desk?.openChat;
const canChat = (member: TeamMember) =>
  chatReady &&
  member.status === "active" &&
  member.username !== overview.value?.currentUsername;
const chatWith = (member: TeamMember) => desk?.openChat?.(member.username);

/** 标题下面那一行：几个人、分在几个部门，指到人上能做什么 */
const summary = computed(() => {
  if (!overview.value) return "看看团队里都有谁";
  const count = departments.value.length;
  const head = `${members.value.length} 人，${count ? `分在 ${count} 个部门` : "还没分部门"}。`;
  const can = [chatReady && "发消息", canManage.value && "调部门和职位"].filter(Boolean);
  return can.length ? `${head}指到人上可以${can.join("、")}` : head;
});
</script>

<template>
  <div class="exam-page desk-panel team-page">
    <section class="exam-sheet team-sheet">
      <header class="exam-sheet-head">
        <div>
          <h1 class="exam-title">{{ overview?.teamName || "我的团队" }}</h1>
          <div class="exam-subtitle">{{ summary }}</div>
        </div>
        <div class="team-head-actions">
          <button
            class="exam-link"
            type="button"
            :disabled="loadState === 'loading'"
            @click="load"
          >
            刷新
          </button>
          <button
            v-if="canManage"
            class="exam-btn is-primary"
            type="button"
            data-do="new-department"
            @click="openCreateDepartment"
          >
            新建部门
          </button>
        </div>
      </header>

      <div v-if="!overview && loadState === 'error'" class="exam-error">
        <div class="lead">没读出来</div>
        <div class="hint">{{ loadError }}</div>
        <button class="exam-btn is-ghost is-small" type="button" @click="load">
          再试一次
        </button>
      </div>
      <div v-else-if="!overview" class="team-loading">
        <div v-for="n in 4" :key="n" class="exam-skeleton" />
      </div>

      <template v-else>
        <p v-if="canManage && departments.length === 0" class="team-tip">
          还没有部门。点右上角「新建部门」，再把人分进去。
        </p>

        <section v-for="group in groups" :key="group.id" class="team-group">
          <h2 v-if="group.name" class="team-group-head">
            <span class="team-group-name">
              <small v-if="group.parentPath">{{ group.parentPath }} / </small>
              {{ group.name }}
            </span>
            <span class="team-group-count">{{ group.members.length }} 人</span>
            <span v-if="canManage && group.department" class="team-group-actions">
              <button
                class="exam-link"
                type="button"
                data-do="edit-department"
                @click="openEditDepartment(group.department)"
              >
                改名 / 移动
              </button>
              <button
                class="exam-link is-danger"
                type="button"
                data-do="delete-department"
                @click="removeDepartment(group.department)"
              >
                删除
              </button>
            </span>
          </h2>

          <ul v-if="group.members.length" class="team-roster">
            <li
              v-for="member in group.members"
              :key="member.username"
              class="team-person"
              :class="{ muted: member.status === 'disabled' }"
            >
              <span
                class="desk-avatar"
                :class="{ owner: member.role === 'owner' }"
                aria-hidden="true"
              >
                {{ avatarText(member.displayName) }}
              </span>
              <div class="team-person-text">
                <div class="team-person-name">
                  <strong :title="member.username">{{ member.displayName }}</strong>
                  <span v-if="member.role === 'owner'" class="exam-stamp is-vermilion">
                    负责人
                  </span>
                  <span
                    v-if="member.username === overview.currentUsername"
                    class="exam-stamp"
                  >
                    我
                  </span>
                  <span v-if="member.status === 'disabled'" class="exam-stamp">
                    已停用
                  </span>
                </div>
                <div class="team-person-title" :class="{ empty: !member.title }">
                  {{ member.title || "职位没填" }}
                </div>
              </div>
              <div v-if="canChat(member) || canManage" class="team-person-actions">
                <button
                  v-if="canChat(member)"
                  class="exam-btn is-ghost is-small"
                  type="button"
                  data-do="chat-member"
                  @click="chatWith(member)"
                >
                  发消息
                </button>
                <button
                  v-if="canManage"
                  class="exam-btn is-ghost is-small"
                  type="button"
                  data-do="place-member"
                  @click="openMember(member)"
                >
                  调整
                </button>
              </div>
            </li>
          </ul>
          <p v-else-if="!group.hasChildren" class="team-group-empty">
            还没有人{{ canManage ? "：指到人上点「调整」，把人分进来" : "" }}
          </p>
        </section>
      </template>
    </section>

    <el-dialog
      v-model="departmentForm.visible"
      :title="departmentForm.id ? '修改部门' : '新建部门'"
      width="460px"
      class="desk-dialog"
    >
      <el-form label-position="top" @submit.prevent="saveDepartment">
        <el-form-item label="部门名称">
          <el-input
            v-model="departmentForm.name"
            name="team-department-name"
            maxlength="40"
            show-word-limit
            placeholder="例如：后期组"
          />
        </el-form-item>
        <el-form-item label="上级部门">
          <el-select
            v-model="departmentForm.parentId"
            :teleported="false"
            style="width: 100%"
          >
            <el-option label="（放在顶层）" :value="TOP" />
            <el-option
              v-for="item in departmentChoices"
              :key="item.id"
              :label="item.label"
              :value="item.id"
              :disabled="item.disabled"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="departmentForm.visible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="saving"
          data-do="save-department"
          @click="saveDepartment"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="memberForm.visible"
      :title="`调整：${memberForm.displayName}`"
      width="460px"
      class="desk-dialog"
    >
      <el-form label-position="top" @submit.prevent="saveMember">
        <el-form-item label="所在部门">
          <el-select
            v-model="memberForm.departmentId"
            :teleported="false"
            style="width: 100%"
          >
            <el-option label="（不分部门）" :value="TOP" />
            <el-option
              v-for="item in memberDepartmentChoices"
              :key="item.id"
              :label="item.label"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="职位">
          <el-input
            v-model="memberForm.title"
            name="team-member-title"
            maxlength="40"
            show-word-limit
            placeholder="例如：剪辑"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="memberForm.visible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="saving"
          data-do="save-member"
          @click="saveMember"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped src="./index.css"></style>
