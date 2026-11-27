<script setup lang="ts">
// 这里新写的（旧网站没有）：「培训」页——右上角选哪一期，下面是这一期的总分排名；负责人能新建、修改、删除。
import { nextTick, ref } from "vue";
import TrainingEditorDialog from "@/features/training/components/TrainingEditorDialog.vue";
import {
  CELL_STATE_TEXT,
  cellHint,
  formatDeadline,
  isBelowPass
} from "@/features/training/trainingRank";
import { useTrainings } from "@/features/training/useTrainings";
import "../exam-shared.css";
import "./index.css";

defineOptions({ name: "ExamTrainings" });

const page = useTrainings();
const {
  trainings,
  canManage,
  listLoading,
  listError,
  isEmpty,
  selectedId,
  ranking,
  rankingLoading,
  rankingError,
  stats,
  myRow,
  myRemaining,
  departments,
  keyword,
  departmentId,
  visibleRows,
  filtering,
  removing,
  rankingReady
} = page;

const editor = ref<InstanceType<typeof TrainingEditorDialog> | null>(null);
/** 点了「修改」、正在把这一期读新 */
const opening = ref(false);

/**
 * 改这一期：先把这一期重读一遍，再拿刚读回来的名字、试卷、名单当底稿。
 * 保存是整份覆盖的，底稿旧了会把别处刚加的人、刚加的卷悄悄去掉。
 */
async function openEdit() {
  if (opening.value) return;
  opening.value = true;
  try {
    const current = await page.freshForEdit();
    if (!current) return;
    await editor.value?.openEdit({
      trainingId: current.trainingId,
      name: current.name,
      description: current.description,
      deadline: current.deadline,
      revision: current.revision,
      papers: current.papers.map(paper => ({
        paperId: paper.paperId,
        title: paper.title,
        status: paper.status,
        totalScore: paper.totalScore
      })),
      members: current.rows.map(row => ({
        username: row.username,
        displayName: row.displayName
      }))
    });
  } finally {
    opening.value = false;
  }
}

/** 人多时我那一行可能在很下面：点一下滚过去；正筛着别的部门、别的名字时先看回全部 */
async function jumpToMine() {
  if (!visibleRows.value.some(row => row.isMe)) {
    page.clearFilters();
    await nextTick();
  }
  document
    .querySelector(".trainings-table tr.is-me")
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
</script>

<template>
  <div class="exam-page trainings-page">
    <section class="exam-sheet trainings-sheet">
      <header class="exam-sheet-head">
        <div>
          <h1 class="exam-title">培训</h1>
          <div class="exam-subtitle">一次培训几张卷，分数加起来排名次</div>
        </div>
        <div class="trainings-head-actions">
          <el-select
            v-if="trainings.length > 0"
            :model-value="selectedId"
            class="trainings-select"
            popper-class="exam-popper"
            placeholder="选哪一期"
            aria-label="选哪一期培训"
            @change="page.selectTraining"
          >
            <el-option
              v-for="item in trainings"
              :key="item.trainingId"
              :label="item.name"
              :value="item.trainingId"
            >
              <span class="exam-option">
                <strong>{{ item.name }}</strong>
                <em>{{ item.paperCount }} 张卷 · {{ item.memberCount }} 人</em>
              </span>
            </el-option>
          </el-select>
          <button
            v-if="canManage"
            class="exam-btn is-primary"
            type="button"
            @click="editor?.openCreate()"
          >
            新建培训
          </button>
        </div>
      </header>

      <div
        v-if="listLoading && trainings.length === 0"
        class="trainings-loading"
      >
        <div v-for="i in 4" :key="i" class="exam-skeleton" />
      </div>

      <div v-else-if="listError && trainings.length === 0" class="exam-error">
        <div class="icon">✕</div>
        <div class="lead">培训列表加载失败</div>
        <div class="hint">网络或服务暂不可用,稍候重试一次即可。</div>
        <button
          class="exam-btn is-ghost"
          type="button"
          @click="page.reloadAll()"
        >
          重新加载
        </button>
      </div>

      <div v-else-if="isEmpty" class="exam-empty">
        <div class="icon">◎</div>
        <div class="lead">还没有培训</div>
        <div class="hint">
          {{
            canManage
              ? "点「新建培训」：起个名字、勾几张卷、勾上参加的人。系统自动把卷发下去，算每个人的总分，排出名次。"
              : "负责人建了培训以后，这里会出现大家的总分排名。"
          }}
        </div>
        <button
          v-if="canManage"
          class="exam-btn is-primary"
          type="button"
          @click="editor?.openCreate()"
        >
          新建培训
        </button>
        <button
          v-else
          class="exam-btn is-ghost"
          type="button"
          :disabled="listLoading"
          @click="page.refresh()"
        >
          {{ listLoading ? "刷新中…" : "刷新" }}
        </button>
      </div>

      <template v-else>
        <div v-if="rankingLoading && !ranking" class="trainings-loading">
          <div v-for="i in 5" :key="i" class="exam-skeleton" />
        </div>

        <div v-else-if="rankingError && !ranking" class="exam-error">
          <div class="icon">✕</div>
          <div class="lead">排名加载失败</div>
          <div class="hint">网络或服务暂不可用,稍候重试一次即可。</div>
          <button
            class="exam-btn is-ghost"
            type="button"
            @click="page.refresh()"
          >
            重新加载
          </button>
        </div>

        <template v-else-if="ranking">
          <div class="trainings-summary">
            <div class="trainings-facts">
              <span>
                <span class="exam-mono">{{ ranking.papers.length }}</span> 张卷
                · 满分 <span class="exam-mono">{{ ranking.fullScore }}</span> ·
                <span class="exam-mono">{{ ranking.rows.length }}</span> 人
                <template v-if="stats">
                  · 已交
                  <span class="exam-mono">
                    {{ stats.submitted
                    }}<template v-if="stats.assigned !== null">
                      / {{ stats.assigned }}</template
                    >
                  </span>
                  份
                </template>
              </span>
              <span v-if="stats && stats.pending > 0" class="exam-stamp is-azure">
                待判 {{ stats.pending }} 份
              </span>
              <span v-if="ranking.deadline" class="exam-stamp">
                截止 {{ formatDeadline(ranking.deadline) }}
              </span>
            </div>
            <div class="trainings-actions">
              <button
                class="exam-link"
                type="button"
                :disabled="rankingLoading || listLoading"
                @click="page.refresh()"
              >
                {{ rankingLoading || listLoading ? "刷新中…" : "刷新" }}
              </button>
              <button
                v-if="ranking.rows.length > 0"
                class="exam-link"
                type="button"
                title="复制下来，到表格软件里粘贴，一格一格正好"
                @click="page.copyTable()"
              >
                复制成绩表
              </button>
              <template v-if="canManage">
                <button
                  class="exam-btn is-ghost is-small"
                  type="button"
                  title="改名字、加减试卷、加减参加的人"
                  :disabled="!rankingReady || opening"
                  @click="openEdit"
                >
                  {{ opening ? "正在读…" : "修改" }}
                </button>
                <button
                  class="exam-link is-danger"
                  type="button"
                  :disabled="removing || !rankingReady"
                  @click="page.remove()"
                >
                  {{ removing ? "删除中…" : "删除" }}
                </button>
              </template>
            </div>
          </div>

          <p v-if="ranking.description" class="trainings-description">
            {{ ranking.description }}
          </p>

          <div v-if="myRow" class="trainings-mine">
            <span>
              我：第 <b class="exam-mono">{{ myRow.rank }}</b> 名
            </span>
            <span>
              总分 <b class="exam-mono">{{ myRow.total }}</b>
              <span class="trainings-mine-full exam-mono">
                / {{ ranking.fullScore }}
              </span>
            </span>
            <button
              v-if="ranking.rows.length > 8"
              class="exam-link"
              type="button"
              @click="jumpToMine"
            >
              看我这一行
            </button>
            <span v-if="myRow.pendingCount > 0">
              有 {{ myRow.pendingCount }} 张在等判分
            </span>
            <template v-if="myRemaining > 0">
              <span>还有 {{ myRemaining }} 张没考</span>
              <button
                class="exam-btn is-outline-primary is-small"
                type="button"
                @click="page.goMyExams()"
              >
                去考试
              </button>
            </template>
          </div>

          <div
            v-if="ranking.rows.length > 8 || departments.length > 0 || filtering"
            class="trainings-filters"
          >
            <el-input
              v-model="keyword"
              class="trainings-search"
              clearable
              placeholder="搜名字或账号"
              aria-label="搜名字或账号"
            />
            <el-select
              v-if="departments.length > 0"
              v-model="departmentId"
              class="trainings-department"
              popper-class="exam-popper"
              clearable
              placeholder="全部部门"
              aria-label="按部门看"
            >
              <el-option
                v-for="choice in departments"
                :key="choice.id"
                :label="`${choice.label}（${choice.count} 人）`"
                :value="choice.id"
              />
            </el-select>
            <span v-if="filtering" class="trainings-filter-count">
              显示 {{ visibleRows.length }} / {{ ranking.rows.length }} 人
              <button
                class="exam-link"
                type="button"
                @click="page.clearFilters()"
              >
                看全部
              </button>
            </span>
          </div>

          <div v-if="ranking.rows.length === 0" class="exam-empty">
            <div class="icon">✎</div>
            <div class="lead">这期培训还没有参加的人</div>
            <div v-if="canManage" class="hint">点「修改」把人勾上。</div>
          </div>

          <div v-else-if="visibleRows.length === 0" class="exam-empty">
            <div class="icon">◎</div>
            <div class="lead">没有找到这个人</div>
            <div class="hint">换个字搜，或者点「看全部」。</div>
          </div>

          <div
            v-else
            class="trainings-table-wrap"
            tabindex="0"
            role="region"
            aria-label="培训排名表，卷多时可以左右滚动"
          >
            <table class="trainings-table">
              <thead>
                <tr>
                  <th class="col-rank" scope="col">名次</th>
                  <th class="col-name" scope="col">姓名</th>
                  <th
                    v-for="paper in ranking.papers"
                    :key="paper.paperId"
                    class="col-paper"
                    scope="col"
                    :title="paper.title"
                  >
                    <span class="paper-title">{{ paper.title }}</span>
                    <span
                      v-if="paper.status === '草稿'"
                      class="paper-meta is-draft"
                    >
                      还没发布
                    </span>
                    <span v-else class="paper-meta exam-mono">
                      满分 {{ paper.totalScore }}
                    </span>
                  </th>
                  <th class="col-total" scope="col">总分</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in visibleRows"
                  :key="row.username"
                  :class="{ 'is-me': row.isMe }"
                >
                  <td class="col-rank">
                    <span
                      class="training-rank exam-mono"
                      :class="{ 'is-top': row.rank <= 3 && row.total > 0 }"
                    >
                      {{ row.rank }}
                    </span>
                  </td>
                  <th class="col-name" scope="row">
                    <span class="training-name">
                      {{ row.displayName }}
                      <span v-if="row.isMe" class="exam-stamp is-vermilion">
                        我
                      </span>
                      <span v-if="row.removed" class="exam-stamp">已移除</span>
                    </span>
                    <span class="training-username exam-mono">
                      {{ row.username }}
                    </span>
                  </th>
                  <td
                    v-for="(cell, index) in row.cells"
                    :key="ranking.papers[index].paperId"
                    class="col-paper"
                    :title="cellHint(cell)"
                  >
                    <button
                      v-if="page.cellOpenable(cell, ranking.papers[index])"
                      class="training-score is-link exam-mono"
                      :class="{
                        'is-below': isBelowPass(cell, ranking.papers[index])
                      }"
                      type="button"
                      :aria-label="`${row.displayName}「${ranking.papers[index].title}」${cell.score} 分，点开看答卷`"
                      @click="page.openSheet(row, cell, ranking.papers[index])"
                    >
                      {{ cell.score
                      }}<span
                        v-if="cell.state === 'pending'"
                        class="training-cell-note"
                        >待判</span
                      >
                    </button>
                    <span
                      v-else-if="
                        cell.state === 'graded' || cell.state === 'pending'
                      "
                      class="training-score exam-mono"
                      :class="{
                        'is-below': isBelowPass(cell, ranking.papers[index])
                      }"
                    >
                      {{ cell.score
                      }}<span
                        v-if="cell.state === 'pending'"
                        class="training-cell-note"
                        >待判</span
                      >
                    </span>
                    <span
                      v-else
                      class="training-cell-state"
                      :class="`is-${cell.state}`"
                    >
                      {{ CELL_STATE_TEXT[cell.state] }}
                    </span>
                  </td>
                  <td class="col-total">
                    <b class="training-total exam-mono">{{ row.total }}</b>
                    <span
                      v-if="row.pendingCount > 0"
                      class="training-cell-note"
                    >
                      待判 {{ row.pendingCount }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p v-if="ranking.rows.length > 0" class="trainings-legend">
            总分 = 各卷分数相加。老师判过用人工分，没判用系统 / AI
            分；交了卷没判完先记已出的分、标「待判」；没考、缺考按 0
            分；同分并列。红色的分数是没到及格分。
            <template v-if="canManage">点分数可以看那份答卷。</template>
            <template v-else>答案公布以后，点分数可以看那份答卷。</template>
          </p>
        </template>
      </template>
    </section>

    <TrainingEditorDialog ref="editor" @saved="page.afterSaved" />
  </div>
</template>
