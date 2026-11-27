<script setup lang="ts">
import { computed } from "vue";
import { blankBoxWidth, layoutFillBlank } from "@/features/exam/fillBlanks";

/**
 * 填空题作答格(卷面直答与专注模式共用一份;样式类挂 take-page 全局 css)。
 *
 * 两条产品决定写在这里,别再各自实现:
 * 1) 直接填空——空位能嵌进题干就嵌进去(所见即所填),嵌不进去才排在题干下面标「空 N」;
 *    填空不是简答,不该先点进专注模式再面对一张稿纸。
 * 2) 允许复制粘贴——2026-11-27 用户定「考试作答的时候允许复制」,作答格和普通输入框一样,
 *    不拦粘贴、拖入(原先的粘贴守卫 pasteGuard.ts 已删,别再加回来)。
 */
defineOptions({ name: "ExamFillBlankFields" });

const props = withDefaults(
  defineProps<{
    stem: string;
    blankCount: number;
    /** 当前作答(可能短于 blankCount,按下标取值)。 */
    values?: string[];
    disabled?: boolean;
    /** 输入框 id 前缀:同一页可能同时存在多题,必须各自唯一。 */
    idPrefix: string;
    /** 读屏用的题目定位,如「第 3 题」——整卷直答时满屏「第 1 空」分不清是哪道题。 */
    questionLabel?: string;
  }>(),
  { values: () => [], disabled: false, questionLabel: "" }
);

const emit = defineEmits<{ update: [index: number, value: string] }>();

/** 单空长度上限:真实填空答案远够用,只为挡住异常长文(后端对填空没有长度上限)。 */
const MaxBlankLength = 500;

const layout = computed(() => layoutFillBlank(props.stem, props.blankCount));

function valueAt(index: number) {
  return props.values?.[index] ?? "";
}

function blankId(index: number) {
  return `${props.idPrefix}-blank-${index}`;
}

/**
 * 每个空的无障碍名称:带上题号与总空数,读屏在整卷里也能定位。
 * 措辞必须以「空 N」开头——补空行那一支的可见文字就是「空 N」,
 * 可访问名要包含可见文字(WCAG 2.5.3 Label in Name),否则语音控制念不动。
 */
function blankLabel(index: number) {
  const position = `空 ${index + 1}，共 ${layout.value.blankCount} 空`;
  return props.questionLabel ? `${props.questionLabel} ${position}` : position;
}

/** 空位宽度:横线长度与已写内容取大,写多长撑多长(看不全自己的答案是硬伤)。 */
function blankStyle(index: number, markerWidth: number) {
  return { "--blank-width": `${blankBoxWidth(markerWidth, valueAt(index))}ch` };
}

/** 题干段落 id:读屏在表单模式下只念可访问名,靠它把题干补进来。 */
const stemId = computed(() => `${props.idPrefix}-stem`);

function onInput(index: number, event: Event) {
  emit("update", index, (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="take-fill" :class="{ 'is-inline': layout.inline }">
    <!-- 空位嵌在句子里:题干与输入框同一行流式排版 -->
    <p v-if="layout.inline" :id="stemId" class="take-fill-stem">
      <template
        v-for="(segment, index) in layout.segments"
        :key="`${segment.kind}-${index}`"
      >
        <template v-if="segment.kind === 'text'">{{ segment.text }}</template>
        <input
          v-else
          :id="blankId(segment.blankIndex)"
          class="take-fill-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :maxlength="MaxBlankLength"
          :style="blankStyle(segment.blankIndex, segment.width)"
          :disabled="disabled"
          :value="valueAt(segment.blankIndex)"
          :aria-label="blankLabel(segment.blankIndex)"
          :aria-describedby="stemId"
          @input="onInput(segment.blankIndex, $event)"
        />
      </template>
    </p>

    <!-- 题干没写横线(或横线数与空数对不上):题干原样,空排在下面 -->
    <template v-else>
      <p :id="stemId" class="take-fill-stem is-plain">{{ stem }}</p>
      <div class="take-fill-rows">
        <div
          v-for="blankIndex in layout.trailing"
          :key="blankIndex"
          class="take-fill-row"
        >
          <label class="take-fill-no exam-mono" :for="blankId(blankIndex)">
            空 {{ blankIndex + 1 }}
          </label>
          <input
            :id="blankId(blankIndex)"
            class="take-fill-input is-row"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :maxlength="MaxBlankLength"
            :disabled="disabled"
            :value="valueAt(blankIndex)"
            :aria-label="blankLabel(blankIndex)"
            :aria-describedby="stemId"
            placeholder="在此作答"
            @input="onInput(blankIndex, $event)"
          />
        </div>
      </div>
    </template>
  </div>
</template>
