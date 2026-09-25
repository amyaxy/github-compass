import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  workers: 1, // Electron 实例串行，避免资源竞争
  reporter: [['list']],
  use: { trace: 'off' },
});
