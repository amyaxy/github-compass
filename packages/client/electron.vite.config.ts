import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  main: {
    // core 是 workspace TS 包，必须打进 bundle 而非 externalize
    plugins: [externalizeDepsPlugin({ exclude: ['@github-compass/core'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [vue()],
    build: {
      // 显式锚定到 client 包内（electron-vite 5 默认相对 workspace root，打包会缺 renderer）
      outDir: 'out/renderer',
      emptyOutDir: true,
    },
  },
});
