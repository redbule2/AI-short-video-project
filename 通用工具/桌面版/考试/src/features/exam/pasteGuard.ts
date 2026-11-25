/**
 * 作答框「禁止粘贴」守卫——填空与简答共用一份(单一事实源,别再各自实现一遍)。
 *
 * 产品决定(R12 定填空,R15 扩到简答):这两类题考的是「记不记得住 / 写不写得出」,
 * 搬一段现成文字进来就把题考没了 ⇒ 键盘 Ctrl+V、右键粘贴、拖文字进来三条路一起堵。
 * 拦下时输入框朱砂抖一下 + 一句话说明,不静默吞掉动作——按了 Ctrl+V 什么都没发生,
 * 考生只会以为页面坏了。
 *
 * 不在此列:实操题的「最终提示词与自评」那一栏本来就要求把生图用的提示词原样交上来,
 * 拦粘贴等于跟题目要求打架。
 */
import { onBeforeUnmount, ref } from "vue";
import { message } from "@/utils/message";

/**
 * 判为「粘贴/拖入」的 beforeinput 类型。
 * 只列真正搬运外部内容的四种:中文输入法的 insertCompositionText、
 * 手机键盘纠错的 insertReplacementText 都不能拦——拦了就打不出字。
 */
const PastedInputTypes = new Set([
  "insertFromPaste",
  "insertFromPasteAsQuotation",
  "insertFromDrop",
  "insertFromYank"
]);

export function isPastedInputType(inputType: string | undefined): boolean {
  return Boolean(inputType) && PastedInputTypes.has(inputType as string);
}

/**
 * 卷首「不能粘贴」那句话:只讲本卷真有的题型(填空 / 简答 / 两者都有),一个都没有就不说。
 * 整卷只有选择题时还念一遍填空规矩,是纯噪音。
 *
 * 这里也是「哪些题型禁止粘贴」的唯一措辞出处——改范围时连同 take 页的作答框一起改,
 * 别让卷首说的和真拦的对不上。实操题的随附文字不在列(那一栏要求交提示词原文)。
 */
export function noPasteHintText(types: readonly string[]): string {
  const hasFillBlank = types.includes("fillBlank");
  const hasEssay = types.includes("essay");
  if (hasFillBlank && hasEssay) return "填空与简答都不能粘贴,请自己键入。";
  if (hasFillBlank) return "填空不能粘贴,请自己键入。";
  if (hasEssay) return "简答不能粘贴,请自己键入。";
  return "";
}

/** 抖动时长:与 take/index.css 的 take-reject-shake 动画(0.4s)对齐。 */
const ShakeMs = 420;
/** 粘贴提示节流:连按 Ctrl+V 不该刷屏。取值必须 ≤ message 默认停留 2000ms,
 *  否则会出现「上一条已消失、这一条被节流掉」的空窗——只抖不说话最难懂。 */
const WarnIntervalMs = 2000;
/** 节流状态放模块级:一页可能同时有多个作答格(整卷直答的多道填空),
 *  每实例各自计时会叠出一屏提示。 */
let lastWarnedAt = 0;

/**
 * 建一个守卫。`subject` 是提示语里的题型名(「填空题」「简答题」),
 * `key` 用来分辨同一实例下的哪个输入位在抖(填空传空序号,简答传题目 id)。
 */
export function usePasteGuard(subject: string) {
  const rejectedKey = ref<unknown>(null);
  let shakeTimer: ReturnType<typeof setTimeout> | null = null;

  function isRejected(key: unknown) {
    return rejectedKey.value !== null && rejectedKey.value === key;
  }

  /** 拦下一次搬运动作:抖一下 + 一句话(节流),把光标留在原地继续手写。 */
  function reject(key: unknown) {
    rejectedKey.value = key;
    if (shakeTimer) clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => {
      rejectedKey.value = null;
      shakeTimer = null;
    }, ShakeMs);

    const now = Date.now();
    if (now - lastWarnedAt < WarnIntervalMs) return;
    lastWarnedAt = now;
    message(`${subject}请自己写，已停用粘贴`, {
      type: "warning",
      grouping: true
    });
  }

  /** paste / drop 两条明路。 */
  function block(key: unknown, event: Event) {
    event.preventDefault();
    reject(key);
  }

  /**
   * 兜底:右键菜单、中键粘贴等路径最终都会走 beforeinput,
   * 在这里按 inputType 拦(中文输入法与手机纠错不在拦截清单里,见 isPastedInputType)。
   */
  function onBeforeInput(key: unknown, event: Event) {
    if (!isPastedInputType((event as InputEvent).inputType)) return;
    block(key, event);
  }

  onBeforeUnmount(() => {
    if (shakeTimer) clearTimeout(shakeTimer);
  });

  return { isRejected, onPaste: block, onDrop: block, onBeforeInput };
}
