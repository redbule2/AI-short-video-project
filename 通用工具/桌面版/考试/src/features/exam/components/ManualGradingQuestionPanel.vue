<script setup lang="ts">
import { computed } from "vue";
import {
  answerCopyText,
  ExamTypeLabels,
  formatAnswerText,
  type ManualGradingQuestionDto
} from "@/api/exam";
import ExamCopyAnswerButton from "@/features/exam/components/ExamCopyAnswerButton.vue";
import ExamQuestionGroupIntro from "@/features/exam/components/ExamQuestionGroupIntro.vue";

/**
 * 逐题阅卷的「当前题」内容区：题号 / 题型 / 满分 / 题干 / 题干配图 / 考生作答（含上传图片）。
 * 一次只渲染一道题——整卷不再纵向堆叠。
 * 大题共享案例在逐题模式下每道子题都要重述（否则脱离上下文无法判分），
 * 因此只要有 group 就展示，不按 isQuestionGroupStart 收敛。
 * 样式类挂在 views/exam/manual-grading/index.css 全局 css。
 */
defineOptions({ name: "ManualGradingQuestionPanel" });

const props = defineProps<{
  item: ManualGradingQuestionDto;
  /** 0 基主观题序号。 */
  index: number;
  total: number;
  majorNo: number;
  /** 切题后滚动回读的锚点 id。 */
  anchorId: string;
}>();

/** 卷面题号：分组子题用组内子题号，独立题用全卷排序号。 */
const paperNo = computed(
  () => props.item.group?.subQuestionNo ?? props.item.orderNo
);
const hasUploads = computed(
  () =>
    props.item.type === "practical" &&
    Boolean(props.item.studentAnswer?.files?.length)
);
/**
 * 考生正文原样整段展示。
 * 不能走 formatAnswerText:那份是摘要,实操正文会被截到 60 字加省略号
 * ——阅卷人正要看完整提示词,截断的等于看不到。
 */
const answerText = computed(() => props.item.studentAnswer?.text?.trim() ?? "");
/** 可一键复制的考生原文(提示词类简答/实操:复制走就能直接拿去生图)。 */
const copyText = computed(() =>
  answerCopyText(props.item.type, props.item.studentAnswer)
);
</script>

<template>
  <article
    :id="anchorId"
    class="mg-question"
    :aria-label="`第 ${index + 1} 题，共 ${total} 题`"
  >
    <header class="mg-question-head">
      <span class="mg-question-no exam-mono" aria-hidden="true">
        {{ paperNo }}
      </span>
      <span class="mg-question-seq exam-mono">
        主观题 {{ index + 1 }} / {{ total }}
      </span>
      <span class="exam-stamp">{{ ExamTypeLabels[item.type] }}</span>
      <span class="mg-question-max exam-mono">满分 {{ item.score }}</span>
    </header>

    <ExamQuestionGroupIntro
      v-if="item.group"
      :group="item.group"
      :major-no="majorNo"
      compact
    />

    <div class="mg-question-stem">{{ item.stem }}</div>

    <div v-if="item.stemImages?.length" class="mg-images">
      <a
        v-for="image in item.stemImages"
        :key="image.url"
        :href="image.url"
        target="_blank"
        rel="noopener"
      >
        <img :src="image.url" :alt="image.name || '题干配图'" />
      </a>
    </div>

    <section class="mg-answer">
      <div class="mg-answer-head">
        <span class="mg-answer-label">考生作答</span>
        <ExamCopyAnswerButton
          :text="copyText"
          subject="考生作答"
          label="复制作答"
        />
      </div>
      <div v-if="hasUploads" class="mg-answer-files">
        <a
          v-for="file in item.studentAnswer!.files"
          :key="file.url"
          :href="file.url"
          target="_blank"
          rel="noopener"
        >
          <img :src="file.url" :alt="file.name || '作答图片'" />
        </a>
      </div>
      <p v-if="answerText">{{ answerText }}</p>
      <p v-else-if="!hasUploads">
        {{ formatAnswerText(item.type, item.studentAnswer) }}
      </p>
    </section>
  </article>
</template>
