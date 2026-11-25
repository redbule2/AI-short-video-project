import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Icons from 'unplugin-icons/vite';

/* 考试、团队页：从 new-video8-8 照搬的 Vue 页面（来历见 说明.md），打成一页放到 页面/考试，由本机服务开。
   本机服务只发 .html .js .css .json .svg .png：别引进字体和别的图片格式。 */
const here = p => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  base: './',
  plugins: [vue(), Icons({ compiler: 'vue3', scale: 1 })],
  resolve: { alias: { '@': here('./src') } },
  build: { outDir: here('../页面/考试'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
