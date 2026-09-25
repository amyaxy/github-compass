import { formatCst } from '@github-compass/core';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ConfigStore } from './config.js';
import { HostsWriter } from './hostsWriter.js';
import { runUpdateCycle, type UpdateCycleResult } from './updater.js';

/**
 * 应用内保活定时器（不依赖操作系统调度功能）：
 * 主进程 setInterval 周期执行闭环检查（健康检查→劣化切换→扩池→自愈）。
 * 常驻能力由「托盘常驻 + 开机自启」保证；注册/注销不再触发 UAC 或计划任务告警。
 */

export interface KeepAliveStatus {
  running: boolean;
  intervalMin: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastAction: string | null;
  lastReason: string | null;
}

interface KeepAliveDeps {
  store: ConfigStore;
  writer: HostsWriter;
  log: (line: string) => void;
  /** autoupdate.log 所在目录（历史持久化，重启不丢） */
  logDir: string;
}

let deps: KeepAliveDeps | null = null;
let tickTimer: NodeJS.Timeout | null = null;
let startTimer: NodeJS.Timeout | null = null;
let busy = false;
let status: KeepAliveStatus = {
  running: false,
  intervalMin: 0,
  nextRunAt: null,
  lastRunAt: null,
  lastAction: null,
  lastReason: null,
};

/** 启动后延迟首查（等网络栈/代理就绪），随后固定间隔 */
const STARTUP_DELAY_MS = 60_000;

function appendHistory(line: string): void {
  if (!deps) return;
  try {
    mkdirSync(deps.logDir, { recursive: true });
    appendFileSync(path.join(deps.logDir, 'autoupdate.log'), line + '\n', 'utf8');
  } catch {
    // 历史落盘失败不影响保活本体
  }
}

async function runOnce(trigger: 'startup' | 'timer' | 'manual'): Promise<UpdateCycleResult> {
  if (!deps) return { action: 'error', reason: '保活未初始化' };
  if (busy) return { action: 'none', reason: '上一轮仍在执行，本次跳过' };
  busy = true;
  try {
    const r = await runUpdateCycle({
      store: deps.store,
      writer: deps.writer,
      log: deps.log,
      force: trigger === 'manual', // 手动检查不受劣化冷却限制
    });
    status = {
      ...status,
      lastRunAt: formatCst(new Date()),
      lastAction: r.action,
      lastReason: r.reason,
    };
    if (status.running) {
      status.nextRunAt = formatCst(new Date(Date.now() + status.intervalMin * 60_000));
    }
    deps.log(`[keepalive] ${trigger} 检查：${r.action} —— ${r.reason}`);
    appendHistory(`[${formatCst(new Date())}] [keepalive:${trigger}] ${r.action} —— ${r.reason}`);
    return r;
  } finally {
    busy = false;
  }
}

/** 启动/重设保活定时器（幂等：重复调用按新间隔重启） */
export function startKeepAlive(intervalMin: number): void {
  stopKeepAlive();
  if (!deps) return;
  const minutes = Math.max(1, Math.floor(intervalMin) || 10);
  status = { running: true, intervalMin: minutes, nextRunAt: null, lastRunAt: null, lastAction: null, lastReason: null };
  startTimer = setTimeout(() => {
    startTimer = null;
    void runOnce('startup');
    status.nextRunAt = formatCst(new Date(Date.now() + minutes * 60_000));
    tickTimer = setInterval(() => void runOnce('timer'), minutes * 60_000);
  }, STARTUP_DELAY_MS);
  deps.log(`[keepalive] 保活定时器已启动（每 ${minutes} 分钟，应用内运行，无系统计划任务）`);
}

export function stopKeepAlive(): void {
  if (startTimer) clearTimeout(startTimer);
  if (tickTimer) clearInterval(tickTimer);
  startTimer = null;
  tickTimer = null;
  status = { ...status, running: false, nextRunAt: null };
}

/** 手动立即检查（force），返回本轮结果 */
export function runKeepAliveNow(): Promise<UpdateCycleResult> {
  return runOnce('manual');
}

export function getKeepAliveStatus(): KeepAliveStatus {
  return { ...status };
}

/** 保活历史日志路径（应用内定时器与旧版遗留共用同一文件，便于查看历史） */
export function autoUpdateLogPath(userData: string): string {
  return path.join(userData, 'autoupdate.log');
}

/** 注入依赖（registerIpc 时调用一次） */
export function configureKeepAlive(d: KeepAliveDeps): void {
  deps = d;
}
