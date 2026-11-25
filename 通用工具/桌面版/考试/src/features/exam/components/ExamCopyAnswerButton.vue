<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { copyTextToClipboard } from "@pureadmin/utils";
import Check from "~icons/ep/check";
import CopyDocument from "~icons/ep/copy-document";
import { message } from "@/utils/message";

/**
 * 一键复制考生原文(阅卷 / 复盘共用一份)。
 * 为什么要有:提示词类简答与实操,判分时得把考生写的提示词整段拿去生图比对——
 * 手选一大段文字容易漏字漏行,复制按钮把这一步压成一次点击。
 * 反馈就地给(按钮自身变「已复制」1.6 秒),不靠全局 toast 抢注意力;
 * 复制失败才弹错误,并明说要手动选中。
 */
defineOptions({ name: "ExamCopyAnswerButton" });

const props = withDefaults(
  defineProps<{
    /** 要复制的原文;空串时组件自行隐藏(没内容不摆死按钮)。 */
    text: string;
    /** 无障碍名称里的对象,如「考生作答」。 */
    subject?: string;
    label?: string;
  }>(),
  { subject: "考生作答", label: "复制" }
);

const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | null = null;

const available = computed(() => props.text.trim().length > 0);
/** 按钮名称保持恒定:改写已获焦点按钮的可访问名,NVDA/JAWS 并不会重播。 */
const ariaLabel = computed(
  () => `复制${props.subject}（${props.text.length} 字）`
);
/** 复制结果走按钮外的 live 区播报——放按钮里会和按钮自身文案重复念一遍。 */
const liveMessage = ref("");

function copy() {
  if (!available.value) return;
  // copyTextToClipboard 内部是 document.execCommand("copy"),浏览器拒绝时它会 **抛异常**
  // 而不是返回 false(@pureadmin/utils 的实现)。不接住就是点了没反应、也没有任何提示。
  let ok = false;
  try {
    ok = copyTextToClipboard(props.text);
  } catch {
    ok = false;
  }
  if (!ok) {
    liveMessage.value = "复制失败";
    message("复制失败，请手动选中文本复制", { type: "error" });
    return;
  }
  copied.value = true;
  liveMessage.value = `${props.subject}已复制到剪贴板`;
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    copied.value = false;
    liveMessage.value = "";
    resetTimer = null;
  }, 1600);
}

onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer);
});
</script>

<template>
  <span v-if="available" class="exam-copy-answer-slot">
    <button
      class="exam-copy-answer"
      :class="{ 'is-copied': copied }"
      type="button"
      :aria-label="ariaLabel"
      :title="`复制${subject}，可直接粘贴去生图`"
      @click="copy"
    >
      <component :is="copied ? Check : CopyDocument" aria-hidden="true" />
      <span>{{ copied ? "已复制" : label }}</span>
    </button>
    <span class="exam-copy-answer-live" role="status" aria-live="polite">
      {{ liveMessage }}
    </span>
  </span>
</template>
