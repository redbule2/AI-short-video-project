<script setup lang="ts">
// 这里新写的（旧网站没有）：「新建 / 修改培训」小窗——名字、勾试卷、勾参加的人、截止时间，点「保存并发卷」。
// 用法：ref 拿到实例后调 openCreate() 或 openEdit(这一期)；保存完发 saved(培训编号)。
import { MAX_MEMBERS } from "../memberPicker";
import { outcomeText } from "../trainingRank";
import {
  type EditingTraining,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PAPERS,
  useTrainingEditor
} from "../useTrainingEditor";
import TrainingMemberPicker from "./TrainingMemberPicker.vue";

defineOptions({ name: "TrainingEditorDialog" });

const emit = defineEmits<{ saved: [trainingId: string] }>();

const editor = useTrainingEditor(trainingId => {
  emit("saved", trainingId);
});

defineExpose({
  openCreate: () => editor.openCreate(),
  openEdit: (target: EditingTraining) => editor.openEdit(target)
});

function statusStampClass(status: string) {
  return status === "已发布" ? "is-jade" : status === "草稿" ? "is-azure" : "";
}

function outcomeClass(outcome: string) {
  return outcome === "failed"
    ? "is-vermilion"
    : outcome === "published" || outcome === "assigned"
      ? "is-jade"
      : "";
}

function outcomeStamp(outcome: string) {
  switch (outcome) {
    case "published":
      return "已发布";
    case "assigned":
      return "已补发";
    case "skipped":
      return "没发";
    case "failed":
      return "没发出去";
    case "held":
      return "先留着";
    default:
      return "不用发";
  }
}
</script>

<template>
  <el-dialog
    :model-value="editor.visible.value"
    class="exam-assign-dialog training-editor-dialog"
    :title="
      editor.outcome.value
        ? '发卷结果'
        : editor.isEdit.value
          ? '修改培训'
          : '新建培训'
    "
    width="920px"
    top="5vh"
    append-to-body
    :close-on-click-modal="false"
    :before-close="() => void editor.requestClose()"
  >
    <div v-if="editor.loading.value" class="training-editor-loading">
      <div v-for="i in 5" :key="i" class="exam-skeleton" />
    </div>

    <div v-else-if="editor.loadError.value" class="assign-empty">
      试卷和成员没读出来，可能是网络不通。
      <button class="exam-link" type="button" @click="editor.load()">
        再读一次
      </button>
    </div>

    <!-- 有卷没发出去：把每张卷发得怎么样摆出来 -->
    <div v-else-if="editor.outcome.value" class="training-outcome">
      <p class="training-outcome-lead">
        培训已经保存。下面没发出去的卷，改好以后回来再点一次「保存并发卷」就会补发。
      </p>
      <ul class="training-outcome-list">
        <li
          v-for="paper in editor.outcome.value.papers"
          :key="paper.paperId"
          class="training-outcome-row"
        >
          <span class="exam-stamp" :class="outcomeClass(paper.outcome)">
            {{ outcomeStamp(paper.outcome) }}
          </span>
          <span class="training-outcome-title">{{ paper.title }}</span>
          <span
            class="training-outcome-text"
            :class="{ 'is-failed': paper.outcome === 'failed' }"
          >
            {{ outcomeText(paper) }}
          </span>
        </li>
      </ul>
      <p
        v-if="editor.outcome.value.revokedCount > 0"
        class="training-outcome-lead"
      >
        去掉的人，收回了
        {{ editor.outcome.value.revokedCount }} 份还没开考的卷。
      </p>
    </div>

    <div v-else class="training-editor">
      <div class="training-editor-top">
        <div>
          <label class="assign-label" for="training-name">培训名字</label>
          <el-input
            id="training-name"
            v-model="editor.name.value"
            :maxlength="MAX_NAME_LENGTH"
            placeholder="比如：Seedance 提示词培训 第一期"
          />
        </div>
        <div>
          <label class="assign-label" for="training-deadline">
            截止时间（可不填）
          </label>
          <el-date-picker
            id="training-deadline"
            v-model="editor.deadline.value"
            type="datetime"
            placeholder="不设截止"
            value-format="YYYY-MM-DDTHH:mm:ss"
            style="width: 100%"
          />
          <div
            v-if="editor.deadlineExpired.value"
            class="training-editor-tip is-over"
          >
            原来的截止时间已经过了：要给新加的人、新加的卷发卷，先改晚一点或清空。
          </div>
          <div v-else class="training-editor-tip">
            只管这次新发出去的卷；已经发出去的不变。
          </div>
        </div>
      </div>

      <label class="assign-label" for="training-description">
        说明（可不填）
      </label>
      <el-input
        id="training-description"
        v-model="editor.description.value"
        :maxlength="MAX_DESCRIPTION_LENGTH"
        placeholder="给参加的人看的一句话"
      />

      <!-- 左边勾试卷、右边勾人：两样同时看得见，不用上下来回滚 -->
      <div class="training-editor-cols">
        <section class="training-editor-col" aria-label="这次培训的试卷">
          <div class="assign-label training-editor-row">
            <span>这次培训的试卷</span>
            <span
              class="training-editor-count exam-mono"
              :class="{ 'is-over': editor.tooManyPapers.value }"
            >
              已选 {{ editor.pickedPapers.value.size }} 张 · 满分
              {{ editor.pickedScore.value }}
              <template v-if="editor.tooManyPapers.value">
                · 最多 {{ MAX_PAPERS }} 张
              </template>
            </span>
          </div>
          <el-input
            v-if="editor.paperChoices.value.length > 8"
            v-model="editor.paperKeyword.value"
            class="training-paper-search"
            size="small"
            clearable
            placeholder="搜卷名"
            aria-label="搜试卷"
          />
          <div class="training-paper-list">
            <div
              v-if="editor.paperChoices.value.length === 0"
              class="assign-empty"
            >
              还没有试卷，先到「试卷管理」出一张。
            </div>
            <div
              v-else-if="editor.visiblePapers.value.length === 0"
              class="assign-empty"
            >
              没有搜到这张卷。
            </div>
            <div
              v-for="choice in editor.visiblePapers.value"
              :key="choice.option.paperId"
              class="training-paper"
              :class="{ 'is-blocked': Boolean(choice.blocked) }"
            >
              <el-checkbox
                :model-value="
                  editor.pickedPapers.value.has(choice.option.paperId)
                "
                :disabled="
                  Boolean(choice.blocked) &&
                  !editor.pickedPapers.value.has(choice.option.paperId)
                "
                @change="editor.togglePaper(choice)"
              >
                <span class="training-paper-title">
                  {{ choice.option.title }}
                </span>
                <span
                  class="exam-stamp"
                  :class="statusStampClass(choice.option.status)"
                >
                  {{ choice.option.status }}
                </span>
                <span v-if="choice.blocked" class="training-paper-note">
                  {{ choice.blocked }}
                </span>
                <span
                  v-else-if="choice.option.questionCount < 0"
                  class="training-paper-note exam-mono"
                >
                  {{ choice.option.totalScore }} 分
                </span>
                <span v-else class="training-paper-note exam-mono">
                  {{ choice.option.questionCount }} 题 ·
                  {{ choice.option.totalScore }} 分
                </span>
              </el-checkbox>
            </div>
          </div>
          <!-- 原来就在培训里、还是草稿的卷：可能正撤回来改题，改名字、加个人这种保存不该顺手把它发出去 -->
          <el-checkbox
            v-if="editor.existingDrafts.value.length > 0"
            v-model="editor.publishExistingDrafts.value"
            class="training-editor-drafts"
          >
            这次一起发布还是草稿的
            {{ editor.existingDrafts.value.length }} 张卷（{{
              editor.existingDrafts.value.join("、")
            }}）
          </el-checkbox>
          <div v-if="editor.papersTruncated.value" class="training-editor-tip">
            试卷太多，这里只列了最近的 500 张和已经在培训里的。
          </div>
        </section>

        <section class="training-editor-col" aria-label="参加的人">
          <div class="assign-label">参加的人</div>
          <TrainingMemberPicker
            v-model:keyword="editor.peopleKeyword.value"
            :groups="editor.groups.value"
            :picked="editor.pickedPeople.value"
            :is-expanded="editor.isExpanded"
            @toggle-person="editor.togglePerson"
            @toggle-group="editor.toggleGroup"
            @toggle-expand="editor.toggleExpand"
            @select-all="editor.selectAll"
            @clear-all="editor.clearAll"
          />
          <div
            v-if="editor.tooManyPeople.value"
            class="training-editor-tip is-over"
          >
            一次培训最多 {{ MAX_MEMBERS }} 人参加，请去掉几个。
          </div>
        </section>
      </div>
    </div>

    <template #footer>
      <template v-if="editor.outcome.value">
        <button
          class="exam-btn is-primary is-small"
          type="button"
          @click="editor.visible.value = false"
        >
          知道了
        </button>
      </template>
      <div v-else class="training-editor-foot">
        <span class="training-editor-hint">
          {{
            editor.loading.value || editor.loadError.value
              ? ""
              : editor.hint.value
          }}
        </span>
        <button
          class="exam-btn is-ghost is-small"
          type="button"
          :disabled="editor.submitting.value"
          @click="editor.requestClose()"
        >
          取消
        </button>
        <button
          class="exam-btn is-primary is-small"
          type="button"
          :disabled="!editor.canSave.value"
          @click="editor.save()"
        >
          {{ editor.submitting.value ? "正在保存、发卷…" : "保存并发卷" }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>
