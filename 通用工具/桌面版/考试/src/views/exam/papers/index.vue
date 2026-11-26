<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useExamPapers } from "@/features/exam/useExamPapers";
import ExamPublishDialog from "@/features/exam/components/ExamPublishDialog.vue";
import type { ExamPaperSummaryDto } from "@/api/exam";
import "../exam-shared.css";
import "./index.css";

defineOptions({ name: "ExamPapers" });

const router = useRouter();
const papersApi = useExamPapers();
const publishDialog = ref<InstanceType<typeof ExamPublishDialog> | null>(null);
const importInput = ref<HTMLInputElement | null>(null);

/** 发布走弹窗【计时 v2】:指定考试截止时间与考生后才发布。 */
function openPublish(paper: ExamPaperSummaryDto) {
  publishDialog.value?.open({
    paperId: paper.paperId,
    title: paper.title,
    questionCount: paper.questionCount,
    totalScore: paper.totalScore
  });
}

const {
  papers,
  pageIndex,
  totalPages,
  loading,
  loadError,
  isEmpty,
  busy,
  importing,
  assignVisible,
  assignPaper,
  assignSubs,
  assignSelected,
  assignDeadline,
  assignLoading,
  assignSubmitting
} = papersApi;

async function onCreate() {
  const paperId = await papersApi.createPaper();
  if (paperId) {
    void router.push({
      name: "ExamPaperEdit",
      query: { paperId, setup: "rules" }
    });
  }
}

/** 选好试卷文件就导入;选完把框清空,同一份文件才能再选一回。 */
async function onImportPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  await papersApi.importPapers(files);
}

async function copyPaper(paper: ExamPaperSummaryDto) {
  const paperId = await papersApi.copyArchived(paper);
  if (paperId) {
    void router.push({ name: "ExamPaperEdit", query: { paperId } });
  }
}

function goEdit(paper: ExamPaperSummaryDto) {
  void router.push({
    name: "ExamPaperEdit",
    query: { paperId: paper.paperId }
  });
}

function goResults(paper: ExamPaperSummaryDto) {
  void router.push({ name: "ExamResults", query: { paperId: paper.paperId } });
}

function statusStampClass(status: string) {
  return status === "已发布" ? "is-jade" : status === "草稿" ? "is-azure" : "";
}
</script>

<template>
  <div class="exam-page papers-page">
    <section class="exam-sheet papers-sheet">
      <header class="exam-sheet-head">
        <div>
          <h1 class="exam-title">试卷管理</h1>
          <div class="exam-subtitle">
            命题、发布、指派考试;AI 出的卷会先落在这里等你复核
          </div>
        </div>
        <div class="papers-head-actions">
          <input
            ref="importInput"
            class="papers-import-input"
            type="file"
            accept=".json,application/json"
            multiple
            @change="onImportPicked"
          />
          <button
            class="exam-btn is-ghost"
            type="button"
            :disabled="importing"
            title="选 AI 出好的试卷文件(.json),一份文件一张卷,可以一次选好几份;导进来是草稿"
            @click="importInput?.click()"
          >
            {{ importing ? "正在导入…" : "导入试卷" }}
          </button>
          <button class="exam-btn is-primary" type="button" @click="onCreate">
            新建试卷
          </button>
        </div>
      </header>

      <div v-if="loading" class="papers-loading">
        <div v-for="i in 4" :key="i" class="exam-skeleton" />
      </div>

      <div v-else-if="loadError" class="exam-error">
        <div class="icon">✕</div>
        <div class="lead">试卷列表加载失败</div>
        <div class="hint">网络或服务暂不可用,稍候重试一次即可。</div>
        <button
          class="exam-btn is-ghost"
          type="button"
          @click="papersApi.load()"
        >
          重新加载
        </button>
      </div>

      <div v-else-if="isEmpty" class="exam-empty">
        <div class="icon">◎</div>
        <div class="lead">案上还没有试卷</div>
        <div class="hint">
          可以点右上「新建试卷」手动出题;也可以让你的 AI
          把整张卷出成文件,点右上「导入试卷」放进来,导入的卷会出现在这里等你复核发布。
        </div>
        <button class="exam-btn is-primary" type="button" @click="onCreate">
          新建试卷
        </button>
      </div>

      <ul v-else class="papers-list">
        <li v-for="paper in papers" :key="paper.paperId" class="paper-row">
          <div class="paper-main">
            <div class="paper-title-line">
              <span class="paper-title">{{ paper.title }}</span>
              <span class="exam-stamp" :class="statusStampClass(paper.status)">
                {{ paper.status }}
              </span>
              <span
                v-if="paper.answerRevealPolicy === 'manual'"
                class="exam-stamp"
                :class="paper.answersPublished ? 'is-jade' : ''"
              >
                {{ paper.answersPublished ? "答案已公布" : "手动公布" }}
              </span>
            </div>
            <div class="paper-meta exam-mono">
              {{ paper.questionCount }} 题 · {{ paper.totalScore }} 分
              <template v-if="paper.durationMinutes">
                · {{ paper.durationMinutes }} 分钟
              </template>
              <template v-else>· 不限时</template>
              <span class="paper-counts">
                指派 {{ paper.assignedCount }} / 交卷
                {{ paper.submittedCount }} / 判分 {{ paper.gradedCount }}
              </span>
            </div>
          </div>
          <div class="paper-actions">
            <template v-if="paper.status === '草稿'">
              <button
                class="exam-btn is-ghost is-small"
                type="button"
                @click="goEdit(paper)"
              >
                编辑出题
              </button>
              <button
                class="exam-btn is-outline-primary is-small"
                type="button"
                :disabled="busy[paper.paperId] || paper.questionCount === 0"
                :title="paper.questionCount === 0 ? '先加题再发布' : ''"
                @click="openPublish(paper)"
              >
                发布
              </button>
              <button
                class="exam-link is-danger"
                type="button"
                @click="papersApi.removePaper(paper)"
              >
                删除
              </button>
            </template>
            <template v-else-if="paper.status === '已发布'">
              <button
                class="exam-btn is-outline-primary is-small"
                type="button"
                :disabled="busy[paper.paperId]"
                @click="papersApi.openAssign(paper)"
              >
                补指派
              </button>
              <button
                class="exam-btn is-ghost is-small"
                type="button"
                @click="goResults(paper)"
              >
                成绩
              </button>
              <el-dropdown trigger="click">
                <button class="exam-link" type="button">更多 ▾</button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="goEdit(paper)">
                      查看题目
                    </el-dropdown-item>
                    <el-dropdown-item
                      v-if="
                        paper.answerRevealPolicy === 'manual' &&
                        !paper.answersPublished
                      "
                      @click="papersApi.publishAnswers(paper)"
                    >
                      公布答案
                    </el-dropdown-item>
                    <el-dropdown-item @click="papersApi.revert(paper)">
                      撤回改题
                    </el-dropdown-item>
                    <el-dropdown-item @click="papersApi.archive(paper)">
                      归档
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
            <template v-else>
              <button
                class="exam-btn is-outline-primary is-small"
                type="button"
                :disabled="busy[paper.paperId] || paper.questionCount === 0"
                :title="
                  paper.questionCount === 0
                    ? '归档卷没有题目,不能复制'
                    : '复制为独立草稿并进入改题'
                "
                @click="copyPaper(paper)"
              >
                复制
              </button>
              <button
                class="exam-btn is-ghost is-small"
                type="button"
                @click="goResults(paper)"
              >
                成绩
              </button>
              <button
                v-if="
                  paper.answerRevealPolicy === 'manual' &&
                  !paper.answersPublished
                "
                class="exam-link"
                type="button"
                @click="papersApi.publishAnswers(paper)"
              >
                公布答案
              </button>
              <button
                class="exam-link is-danger"
                type="button"
                @click="papersApi.removePaper(paper)"
              >
                删除
              </button>
            </template>
          </div>
        </li>
      </ul>

      <footer
        v-if="!loading && !isEmpty && totalPages > 1"
        class="papers-pager"
      >
        <button
          class="exam-link"
          type="button"
          :disabled="pageIndex <= 1"
          @click="papersApi.goToPage(pageIndex - 1)"
        >
          上一页
        </button>
        <span class="exam-mono">{{ pageIndex }} / {{ totalPages }}</span>
        <button
          class="exam-link"
          type="button"
          :disabled="pageIndex >= totalPages"
          @click="papersApi.goToPage(pageIndex + 1)"
        >
          下一页
        </button>
      </footer>
    </section>

    <ExamPublishDialog ref="publishDialog" @published="papersApi.load()" />

    <el-dialog
      v-model="assignVisible"
      class="exam-assign-dialog"
      :title="assignPaper ? `指派「${assignPaper.title}」` : '指派考试'"
      width="460px"
      append-to-body
    >
      <div v-if="assignLoading" class="papers-loading">
        <div v-for="i in 3" :key="i" class="exam-skeleton" />
      </div>
      <template v-else>
        <div v-if="assignSubs.length === 0" class="assign-empty">
          还没有可指派的子账号,先到「协作账号」创建启用的子账号。
        </div>
        <template v-else>
          <div class="assign-label">选择考生(可多选)</div>
          <el-checkbox-group v-model="assignSelected" class="assign-subs">
            <el-checkbox
              v-for="sub in assignSubs"
              :key="sub.username"
              :value="sub.username"
            >
              {{ sub.displayName || sub.username }}
              <span v-if="sub.role === 'owner'" class="assign-sub-owner"
                >主账号·我自己</span
              >
              <span class="assign-sub-username">{{ sub.username }}</span>
            </el-checkbox>
          </el-checkbox-group>
          <div class="assign-label">截止时间(可选,过时未考记缺考)</div>
          <el-date-picker
            v-model="assignDeadline"
            type="datetime"
            placeholder="不设截止"
            value-format="YYYY-MM-DDTHH:mm:ss"
            style="width: 100%"
          />
        </template>
      </template>
      <template #footer>
        <button
          class="exam-btn is-ghost is-small"
          type="button"
          @click="assignVisible = false"
        >
          取消
        </button>
        <button
          class="exam-btn is-primary is-small"
          type="button"
          :disabled="assignSelected.length === 0 || assignSubmitting"
          @click="papersApi.confirmAssign()"
        >
          {{
            assignSubmitting ? "指派中…" : `指派 ${assignSelected.length} 人`
          }}
        </button>
      </template>
    </el-dialog>
  </div>
</template>
