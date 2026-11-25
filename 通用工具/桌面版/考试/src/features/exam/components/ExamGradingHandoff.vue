<script setup lang="ts">
import { computed, ref } from "vue";
import { copyTextToClipboard } from "@pureadmin/utils";
import CopyDocument from "~icons/ep/copy-document";
import MagicStick from "~icons/ep/magic-stick";
import { message } from "@/utils/message";
import { prepareExamGradingPrompt } from "../examGradingHandoff";

defineOptions({ name: "ExamGradingHandoff" });

const props = defineProps<{
  sheetId: string;
}>();

const normalizedSheetId = computed(() => props.sheetId.trim());
const preparing = ref(false);
const grantExpiresAt = ref("");
const grantExpiresLabel = computed(() => {
  if (!grantExpiresAt.value) return "";
  const expiresAt = new Date(grantExpiresAt.value);
  return Number.isNaN(expiresAt.getTime())
    ? ""
    : expiresAt.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
});

function copy(value: string, label: string) {
  const copied = copyTextToClipboard(value);
  message(copied ? `${label}已复制` : "复制失败，请手动选择文本", {
    type: copied ? "success" : "error"
  });
}

async function prepareAndCopyPrompt() {
  if (preparing.value) return;
  preparing.value = true;
  try {
    const prepared = await prepareExamGradingPrompt(
      normalizedSheetId.value,
      window.location.origin
    );
    const copied = copyTextToClipboard(prepared.prompt);
    if (!copied) {
      throw new Error("复制失败，请重试。");
    }

    grantExpiresAt.value = prepared.expiresAt;
    message("授权提示词已复制，10 分钟内可直接交给 AI 阅卷", {
      type: "success"
    });
  } catch (error) {
    message(error instanceof Error ? error.message : "临时授权生成失败，请重试", {
      type: "error"
    });
  } finally {
    preparing.value = false;
  }
}
</script>

<template>
  <div class="grading-handoff-container">
    <section class="grading-handoff" aria-label="AI 阅卷交接">
      <div class="grading-handoff__identity">
        <span class="grading-handoff__stamp">API 阅卷</span>
        <div class="grading-handoff__copy">
          <span class="grading-handoff__label">答卷 ID</span>
          <code class="grading-handoff__id" :title="normalizedSheetId">
            {{ normalizedSheetId }}
          </code>
        </div>
      </div>

      <div class="grading-handoff__actions">
        <button
          class="grading-handoff__button"
          type="button"
          @click="copy(normalizedSheetId, '答卷 ID')"
        >
          <CopyDocument aria-hidden="true" />
          复制 ID
        </button>
        <button
          class="grading-handoff__button is-prompt"
          type="button"
          :disabled="preparing"
          :aria-busy="preparing"
          @click="prepareAndCopyPrompt"
        >
          <MagicStick aria-hidden="true" />
          {{ preparing ? "正在生成授权…" : "生成并复制授权提示词" }}
        </button>
      </div>

      <p class="grading-handoff__note">
        <template v-if="grantExpiresLabel">
          本次授权仅限这份答卷，{{ grantExpiresLabel }} 自动失效；无需提供账号密码。
        </template>
        <template v-else>
          点击后生成仅限这份答卷、10 分钟自动失效的授权；无需提供账号密码或完整
          token。
        </template>
      </p>
    </section>
  </div>
</template>

<style scoped>
.grading-handoff-container {
  width: 100%;
  container-type: inline-size;
}

.grading-handoff {
  --handoff-ink: var(--ink, var(--el-text-color-primary));
  --handoff-muted: var(--graphite, var(--el-text-color-secondary));
  --handoff-accent: var(--azure, var(--el-color-primary));
  --handoff-field: var(--field, var(--el-fill-color-light));
  --handoff-edge: var(--field-edge, var(--el-border-color));

  display: grid;
  box-sizing: border-box;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 16px;
  align-items: center;
  width: 100%;
  padding: 12px 14px;
  margin: 10px 0 14px;
  color: var(--handoff-ink);
  text-align: left;
  background: var(--handoff-field);
  border: 1px solid var(--handoff-edge);
  border-left: 3px solid var(--handoff-accent);
  border-radius: var(--el-border-radius-base);
}

.grading-handoff__identity,
.grading-handoff__actions {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.grading-handoff__stamp {
  flex-shrink: 0;
  padding: 2px 7px;
  font-size: var(--el-font-size-extra-small);
  color: var(--handoff-accent);
  letter-spacing: 0.12em;
  border: 1px solid var(--handoff-accent);
  border-radius: var(--el-border-radius-small);
}

.grading-handoff__copy {
  display: flex;
  flex: 1;
  align-items: baseline;
  min-width: 0;
}

.grading-handoff__label {
  flex-shrink: 0;
  margin-right: 8px;
  font-size: var(--el-font-size-extra-small);
  color: var(--handoff-muted);
}

.grading-handoff__id {
  display: block;
  flex: 1;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(
    --exam-mono,
    "JetBrains Mono",
    "Cascadia Code",
    consolas,
    monospace
  );
  font-size: var(--el-font-size-small);
  color: var(--handoff-ink);
  white-space: nowrap;
}

.grading-handoff__button {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 7px 12px;
  font-size: var(--el-font-size-small);
  color: var(--handoff-ink);
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--handoff-edge);
  border-radius: var(--el-border-radius-base);
  transition:
    color var(--el-transition-duration),
    border-color var(--el-transition-duration),
    background-color var(--el-transition-duration);
}

.grading-handoff__button svg {
  width: 16px;
  height: 16px;
}

.grading-handoff__button:hover,
.grading-handoff__button:focus-visible {
  color: var(--handoff-accent);
  border-color: var(--handoff-accent);
}

.grading-handoff__button:hover {
  background: var(--el-color-primary-light-9);
}

.grading-handoff__button:focus-visible {
  outline: 2px solid var(--handoff-accent);
  outline-offset: 2px;
}

.grading-handoff__button.is-prompt {
  color: var(--el-color-white);
  background: var(--handoff-accent);
  border-color: var(--handoff-accent);
}

.grading-handoff__button.is-prompt:hover {
  color: var(--el-color-white);
  background: var(--el-color-primary-dark-2);
}

.grading-handoff__button:disabled {
  cursor: wait;
  opacity: 0.64;
}

.grading-handoff__note {
  grid-column: 1 / -1;
  margin: 0;
  font-size: var(--el-font-size-extra-small);
  line-height: 1.6;
  color: var(--handoff-muted);
}

@container (width <= 520px) {
  .grading-handoff {
    grid-template-columns: 1fr;
  }

  .grading-handoff__identity {
    align-items: flex-start;
  }

  .grading-handoff__copy {
    flex-direction: column;
  }

  .grading-handoff__label {
    margin: 0 0 2px;
  }

  .grading-handoff__actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .grading-handoff__button {
    white-space: normal;
  }
}
</style>
