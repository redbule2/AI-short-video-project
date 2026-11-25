<script setup lang="ts">
import { computed } from "vue";
import {
  answerCopyText,
  formatAnswerText,
  type ReviewItemDto
} from "@/api/exam";
import ExamCopyAnswerButton from "@/features/exam/components/ExamCopyAnswerButton.vue";
import ExamQuestionGroupIntro from "@/features/exam/components/ExamQuestionGroupIntro.vue";

/**
 * 复盘题目正文(题干/配图/选项标注/作答对照/解析/AI与人工批语)。
 * 单源两用:全卷清单的每题卡片 与 逐题阅读的专注卡片(样式类挂 review-page 全局 css)。
 */
defineOptions({ name: "ReviewQuestionBody" });

const props = defineProps<{
  item: ReviewItemDto;
  showGroupIntro?: boolean;
  majorNo?: number;
  /** 视角:student=考生自己复盘(第一人称);owner=主账号查阅考生答卷(第三人称)。 */
  viewer?: "student" | "owner";
}>();

/** 同一份版式两种口吻:考生看到「我的」,主账号看到「考生」。 */
const answerLabel = computed(() =>
  props.viewer === "owner" ? "考生作答" : "我的作答"
);
const choiceLabel = computed(() =>
  props.viewer === "owner" ? "考生选择" : "我的选择"
);

/**
 * 可一键复制的作答原文(提示词类简答/实操:复盘时把自己写的提示词整段拿去生图)。
 * 本组件同时服务考生复盘与老师看答卷,所以措辞取中性的「作答原文」。
 */
const copyText = computed(() =>
  answerCopyText(props.item.type, props.item.myAnswer)
);

function optionState(key: string) {
  const mine =
    props.item.myAnswer?.answer === key ||
    props.item.myAnswer?.answers?.includes(key);
  const correct =
    props.item.correctAnswer?.answer === key ||
    props.item.correctAnswer?.answers?.includes(key);
  return { mine, correct };
}
</script>

<template>
  <div class="review-q-body">
    <ExamQuestionGroupIntro
      v-if="item.group && showGroupIntro"
      :group="item.group"
      :major-no="majorNo ?? item.orderNo"
      compact
    />
    <div class="review-q-stem">{{ item.stem }}</div>

    <div v-if="item.stemImages?.length" class="review-stem-images">
      <a
        v-for="image in item.stemImages"
        :key="image.url"
        :href="image.url"
        target="_blank"
        rel="noopener"
      >
        <img :src="image.url" :alt="image.name || '题干配图'" loading="lazy" />
      </a>
    </div>

    <!-- 选择题:标注我的选择与正确项 -->
    <ul v-if="item.options?.length" class="review-options">
      <li
        v-for="option in item.options"
        :key="option.key"
        class="review-option"
        :class="{
          'is-mine': optionState(option.key).mine,
          'is-correct': optionState(option.key).correct
        }"
      >
        <span class="review-option-key exam-mono">{{ option.key }}</span>
        <span class="review-option-text">{{ option.text }}</span>
        <span
          v-if="optionState(option.key).mine"
          class="review-option-tag is-mine"
        >
          {{ choiceLabel }}
        </span>
        <span
          v-if="optionState(option.key).correct"
          class="review-option-tag is-correct"
        >
          正确答案
        </span>
      </li>
    </ul>

    <!-- 实操题:上传图片 + 评分标准 -->
    <div v-else-if="item.type === 'practical'" class="review-answers">
      <div class="review-my-answer">
        <div class="review-answer-line">
          <span class="review-answer-label">{{ answerLabel }}</span>
          <span
            v-if="!item.myAnswer?.files?.length && !item.myAnswer?.text?.trim()"
            class="review-answer-value"
          >
            未作答
          </span>
        </div>
        <div v-if="item.myAnswer?.files?.length" class="review-practical-files">
          <a
            v-for="file in item.myAnswer.files"
            :key="file.url"
            :href="file.url"
            target="_blank"
            rel="noopener"
            class="review-practical-file"
          >
            <img
              :src="file.url"
              :alt="file.name || '答案图片'"
              loading="lazy"
            />
          </a>
        </div>
        <div v-if="item.myAnswer?.text?.trim()" class="review-answer-line">
          <span class="review-answer-label">提示词/自评</span>
          <span class="review-answer-value">{{ item.myAnswer.text }}</span>
        </div>
        <div v-if="copyText" class="review-answer-copy-row">
          <ExamCopyAnswerButton
            :text="copyText"
            subject="作答原文"
            label="复制作答"
          />
        </div>
      </div>
      <div class="review-answer-line">
        <span class="review-answer-label">评分标准</span>
        <span class="review-answer-value is-correct">
          {{ item.correctAnswer?.reference || "—" }}
        </span>
      </div>
    </div>

    <!-- 非选择题:并排展示 -->
    <div v-else class="review-answers">
      <div class="review-my-answer">
        <div class="review-answer-line">
          <span class="review-answer-label">{{ answerLabel }}</span>
          <span class="review-answer-value">
            {{ formatAnswerText(item.type, item.myAnswer) }}
          </span>
        </div>
        <div v-if="copyText" class="review-answer-copy-row">
          <ExamCopyAnswerButton
            :text="copyText"
            subject="作答原文"
            label="复制作答"
          />
        </div>
      </div>
      <div class="review-answer-line">
        <span class="review-answer-label">参考答案</span>
        <span class="review-answer-value is-correct">
          {{ formatAnswerText(item.type, item.correctAnswer) }}
        </span>
      </div>
    </div>

    <div class="review-explanation-stack">
      <div class="review-analysis">
        <span class="review-analysis-label">解析</span>
        <p>{{ item.analysis }}</p>
      </div>

      <div v-if="item.aiComment" class="review-ai-comment">
        <span class="review-ai-stamp">AI 批</span>
        <p>{{ item.aiComment }}</p>
      </div>

      <div v-if="item.manualComment" class="review-human-comment">
        <span class="review-human-stamp">人工批</span>
        <p>{{ item.manualComment }}</p>
      </div>
    </div>
  </div>
</template>
