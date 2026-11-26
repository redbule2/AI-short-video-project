<script setup lang="ts">
// 壳子自己的（不是照搬的）：聊天里的一张图（2026-11-26）。
// 先按宽高把地方占好（图来了不跳），滚到快看得见了才经壳子去拿（拿过的不再拿），点开看大图。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { imageUrl } from "../chatImage";
import { thumbSize, type ChatItem } from "../chatModel";

const props = defineProps<{ item: ChatItem }>();
const emit = defineEmits<{ open: [url: string] }>();

const box = ref<HTMLElement | null>(null);
const src = ref(props.item.localUrl || "");
const failed = ref(false);
const size = computed(() => thumbSize(props.item.image?.width, props.item.image?.height));
let watcher: IntersectionObserver | null = null;

function fetchNow() {
  if (src.value || props.item.state) return; // 还没发出去的：只有本机那一份
  failed.value = false;
  imageUrl(props.item.id).then(
    url => {
      src.value = url;
    },
    () => {
      failed.value = true;
    }
  );
}

function click() {
  if (src.value) emit("open", src.value);
  else if (failed.value) fetchNow();
}

onMounted(() => {
  if (src.value || props.item.state || !box.value) return;
  watcher = new IntersectionObserver(
    entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      watcher?.disconnect();
      watcher = null;
      fetchNow();
    },
    { rootMargin: "240px" }
  );
  watcher.observe(box.value);
});
onBeforeUnmount(() => watcher?.disconnect());
</script>

<template>
  <button
    ref="box"
    class="chat-picture"
    :class="{ wait: !src && !failed }"
    type="button"
    :style="{ width: `${size.width}px`, height: `${size.height}px` }"
    :title="src ? '点开看大图' : failed ? '点一下再拿一回' : ''"
    @click="click"
  >
    <img v-if="src" :src="src" alt="图片" draggable="false" />
    <span v-else-if="failed">图没拿到<br />点一下再试</span>
  </button>
</template>

<style scoped>
.chat-picture {
  display: grid;
  place-items: center;
  padding: 0;
  overflow: hidden;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  color: var(--c-muted);
  cursor: zoom-in;
  background: rgb(from var(--ink) r g b / 4%);
  border: 1px solid var(--c-line);
  border-radius: 10px;
}

.chat-picture.wait {
  cursor: default;
}

.chat-picture img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
