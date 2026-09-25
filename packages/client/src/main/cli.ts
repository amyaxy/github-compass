import { app } from 'electron';
import { formatCst } from '@github-compass/core';

/**
 * @deprecated 旧版计划任务入口（--compass-cli）。
 * 保活已改为应用内定时器（keepAlive.ts），不再依赖操作系统计划任务。
 * 保留本入口为安全 no-op：若用户机器上仍有旧版计划任务未清理，
 * 触发时立即退出，不会误弹 GUI 窗口。
 */
export async function runCliUpdate(): Promise<void> {
  console.log(
    `[${formatCst(new Date())}] [cli] 计划任务入口已废弃：保活已由应用内定时器承担，本实例直接退出。建议在 GitHubCompass 设置中清理旧计划任务。`,
  );
  app.exit(0);
}
