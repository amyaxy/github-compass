import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import type { CandidatesFile, HostsEntry } from '@github-compass/core';
import { formatCst } from '@github-compass/core';
import { fetchCandidatesJson } from './fetcher.js';
import { runLocalProbe, fakeProbe, type ProbeOutcome } from './proberRunner.js';
import { buildBlock, defaultHostsPath, HostsWriter, readBlockVersion, readMarkedBlock } from './hostsWriter.js';
import {
  autoUpdateLogPath,
  configureKeepAlive,
  getKeepAliveStatus,
  runKeepAliveNow,
  startKeepAlive,
  stopKeepAlive,
} from './keepAlive.js';
import type { Settings } from './config.js';
import { ConfigStore } from './config.js';

let writer: HostsWriter;
let store: ConfigStore;
let cachedCandidates: CandidatesFile | null = null;
let lastProbe: ProbeOutcome | null = null;

const send = (channel: string, payload: unknown): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
};

const log = (line: string): void => {
  send('compass:log', `[${formatCst(new Date()).slice(11, 19)}] ${line}`);
};

export function registerIpc(): ConfigStore {
  const userData = app.getPath('userData');
  store = new ConfigStore(userData);
  writer = new HostsWriter(undefined, path.join(userData, 'backups'), log);

  // 应用内保活：不依赖操作系统计划任务；开机按设置自启定时器
  configureKeepAlive({ store, writer, log, logDir: userData });
  if (store.getSettings().autoUpdate) {
    startKeepAlive(store.getSettings().autoUpdateIntervalMin);
  }

  ipcMain.handle('compass:state', () => ({
    version: app.getVersion(),
    config: store.get(),
    cached: cachedCandidates
      ? { version: cachedCandidates.version, generatedAt: cachedCandidates.generatedAt }
      : null,
  }));

  /** 向导①：环境检测（平台 / hosts 路径 / 直接可写性） */
  ipcMain.handle('compass:env-check', async () => {
    const hostsPath = defaultHostsPath();
    let writable = false;
    try {
      await access(hostsPath, fsConstants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    return {
      platform: process.platform,
      hostsPath,
      writable,
      note: writable ? '可直接写入' : '写入时将请求提权授权（Windows UAC / macOS 密码框）',
    };
  });

  /** 拉取候选池（多通道 fallback + 版本比对） */
  ipcMain.handle('compass:fetch', async () => {
    const cfg = store.get();
    const { data, channel } = await fetchCandidatesJson(
      log,
      cfg.lastGoodIps['raw.githubusercontent.com'],
      cfg.settings.channelOrder,
    );
    cachedCandidates = data;
    return {
      version: data.version,
      generatedAt: data.generatedAt,
      channel,
      groups: data.groups.map((g) => ({ domain: g.domain, count: g.candidates.length })),
      upToDate: data.version === cfg.appliedVersion,
    };
  });

  /** 本地探测选优（进度推送 compass:probe-progress，返回含全量明细） */
  ipcMain.handle('compass:probe', async () => {
    if (!cachedCandidates) throw new Error('请先拉取数据');
    const s = store.getSettings();
    const outcome =
      process.env.COMPASS_E2E_FAKE_PROBE === '1'
        ? fakeProbe(cachedCandidates)
        : await runLocalProbe(
            cachedCandidates,
            (p) => send('compass:probe-progress', { done: p.done, total: p.total, result: p.result }),
            { concurrency: s.probeConcurrency, timeoutMs: s.probeTimeoutMs },
          );
    lastProbe = outcome;
    if (outcome.entries.length === 0) {
      log(
        `本地探测无通过项（${outcome.failureReason}），候选池仍可在"探测详情"中手动选择为远程备选`,
      );
    } else {
      log(`本地探测完成：${outcome.entries.length}/${cachedCandidates.groups.length} 个域名选优成功`);
    }
    return {
      entries: outcome.entries,
      results: outcome.results,
      failureReason: outcome.failureReason,
      version: cachedCandidates.version,
    };
  });

  /**
   * 写入 hosts：手动点击必写（尊重用户意图，不做版本/内容拦截）；
   * 自动更新传 opts.skipIfSame=true，走内容比对防打扰。
   */
  ipcMain.handle(
    'compass:update',
    async (
      _event,
      selections?: Array<{ domain: string; ip: string }>,
      opts?: { skipIfSame?: boolean },
    ) => {
      if (!cachedCandidates) throw new Error('请先拉取数据');
      let entries: HostsEntry[];
      log(`[update] 请求到达：selections=${selections?.length ?? 0}，cached=${cachedCandidates.version}，applied=${store.get().appliedVersion}`);
      if (selections && selections.length > 0) {
        const groupMap = new Map(cachedCandidates.groups.map((g) => [g.domain, g]));
        const resultKey = new Map((lastProbe?.results ?? []).map((r) => [`${r.domain}|${r.ip}`, r]));
        entries = selections.map(({ domain, ip }) => {
          const g = groupMap.get(domain);
          if (!g || !g.candidates.includes(ip)) {
            throw new Error(`非法选择：${ip} 不在 ${domain} 的候选池`);
          }
          const r = resultKey.get(`${domain}|${ip}`);
          if (!r?.ok) {
            throw new Error(`${domain} ${ip} 本地探测未通过，不可写入（hosts 强制解析会阻断系统 DNS）`);
          }
          return {
            domain,
            ip,
            latencyMs: r.latencyMs ?? 0,
            tlsVerified: true as const,
            checkedAt: formatCst(new Date()),
          };
        });
      } else {
        if (!lastProbe || lastProbe.entries.length === 0) throw new Error('请先完成本地探测');
        entries = lastProbe.entries;
      }
      // 守护合并：现块中存在、本次未选择的域名保留原条目——防止该域名无通过候选时整条被顶掉，
      // 造成域名失去 hosts 守护且脱离闭环监控（2026-09-25 github.com 丢失事故）
      const curEntries = await readMarkedBlock();
      for (const e of curEntries) {
        if (!entries.some((x) => x.domain === e.domain)) entries.push(e);
      }
      const cfg = store.get();
      // 仅自动模式做内容比对跳过；手动点击必写（hosts 标记块每次刷新 Update time）
      if (opts?.skipIfSame && (await writer.sameAsCurrent(entries))) {
        log('[update] 自动模式：内容与当前 hosts 一致，跳过写入');
        return { skipped: true, version: cachedCandidates.version };
      }
      const { backupId, backupPath } = await writer.write(entries, cachedCandidates.version);
      store.addBackup({
        id: backupId,
        path: backupPath,
        createdAt: formatCst(new Date()),
        trigger: 'update',
        version: cachedCandidates.version,
      });
      const mergedIps = { ...cfg.lastGoodIps };
      for (const e of entries) mergedIps[e.domain] = e.ip;
      store.update({
        appliedVersion: cachedCandidates.version,
        appliedAt: formatCst(new Date()),
        lastGoodIps: mergedIps,
      });
      return { skipped: false, version: cachedCandidates.version };
    },
  );

  /** 只读导出模式（拒绝提权路径）：仅导出本地实测通过项（写入不通 IP 无意义） */
  ipcMain.handle('compass:export-snippet', () => {
    const entries = lastProbe?.entries ?? [];
    if (entries.length === 0) throw new Error('本地无可用 IP，请重试探测或检查网络');
    return buildBlock(entries, cachedCandidates?.version ?? 0);
  });

  /** 保存片段到用户选择的文件 */
  ipcMain.handle('compass:save-snippet', async (_event, content: string) => {
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined!, {
      title: '保存 GitHubCompass hosts 片段',
      defaultPath: 'github-compass-hosts.txt',
    });
    if (canceled || !filePath) return { saved: false };
    await writeFile(filePath, content, 'utf8');
    log(`片段已保存：${filePath}`);
    return { saved: true, filePath };
  });

  /** 备份 diff：返回备份原文与当前 hosts 内容 */
  ipcMain.handle('compass:diff-backup', async (_event, backupPath: string) => {
    const before = await readFile(backupPath, 'utf8');
    const after = await readFile(defaultHostsPath(), 'utf8').catch(() => '');
    return { before, after };
  });

  ipcMain.handle('compass:config:get', () => store.getSettings());
  ipcMain.handle('compass:config:set', (_event, patch: Partial<Settings>) => {
    const s = store.updateSettings(patch);
    // 开机自启即时生效（打包后指向安装版 exe；dev 下指向 electron dev 入口）
    if (patch.launchAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: s.launchAtLogin });
    }
    // 保活开关/间隔经通用保存路径进来时，同步应用内定时器
    if (patch.autoUpdate !== undefined || patch.autoUpdateIntervalMin !== undefined) {
      if (s.autoUpdate) startKeepAlive(s.autoUpdateIntervalMin);
      else stopKeepAlive();
    }
    return s;
  });

  /** 无边框窗口控制 */
  ipcMain.handle('compass:win', (event, action: 'min' | 'max' | 'close') => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (action === 'min') win.minimize();
    else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
    else win.close();
  });

  ipcMain.handle('compass:complete-wizard', () => {
    store.update({ firstRunDone: true });
    return { ok: true };
  });

  ipcMain.handle('compass:backups', () => store.get().backups);

  ipcMain.handle('compass:rollback', async (_event, backupPath: string) => {
    await writer.rollback(backupPath);
    store.addBackup({
      id: `rollback-${Date.now()}`,
      path: backupPath,
      createdAt: formatCst(new Date()),
      trigger: 'rollback',
    });
    // 状态回填：恢复到含标记块的旧备份 → 沿用块内版本号；恢复到无块原始态 → 0（未优化）
    const restoredVersion = await readBlockVersion();
    store.update({ appliedVersion: restoredVersion, appliedAt: formatCst(new Date()) });
    return { ok: true, appliedVersion: restoredVersion };
  });

  /** ===== 自动保活（应用内定时器，不依赖操作系统计划任务）===== */

  /** 开启保活：应用内 setInterval，无需 UAC；间隔改动即时生效（重启定时器） */
  ipcMain.handle('compass:autoupdate:register', async (_event, intervalMin: number) => {
    const minutes = Math.max(1, Math.floor(intervalMin) || 10);
    store.updateSettings({ autoUpdate: true, autoUpdateIntervalMin: minutes });
    startKeepAlive(minutes);
    return { ok: true };
  });

  ipcMain.handle('compass:autoupdate:unregister', async () => {
    stopKeepAlive();
    store.updateSettings({ autoUpdate: false });
    log('[keepalive] 保活定时器已停止');
    return { ok: true };
  });

  /** 保活状态 + 最近日志尾部 + 遗留系统任务检测（旧版计划任务/LaunchAgent 提示清理） */
  ipcMain.handle('compass:autoupdate:status', async () => {
    const st = getKeepAliveStatus();
    let logTail = '';
    try {
      const raw = await readFile(autoUpdateLogPath(userData), 'utf8');
      logTail = raw.split(/\r?\n/).filter(Boolean).slice(-20).join('\n');
    } catch {
      // 尚无保活日志
    }
    return { ...st, logTail, legacyTask: await detectLegacyTask() };
  });

  /** 清理旧版遗留的系统计划任务/LaunchAgent（Windows 需一次 UAC，macOS 免权限） */
  ipcMain.handle('compass:autoupdate:legacy-remove', async () => {
    if (process.platform === 'win32') {
      await execFileP('schtasks', ['/Delete', '/F', '/TN', 'GitHubCompassAutoUpdate']);
    } else if (process.platform === 'darwin') {
      const p = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.githubcompass.autoupdate.plist');
      await execFileP('launchctl', ['unload', p]).catch(() => undefined);
      await unlink(p).catch(() => undefined);
    }
    log('[keepalive] 旧版系统调度残留已清理');
    return { ok: true, legacyTask: await detectLegacyTask() };
  });

  /** 立即检查一轮（force 跳过劣化冷却；需要写入时走正常提权流程） */
  ipcMain.handle('compass:autoupdate:run-now', async () => {
    log('[keepalive] 手动触发一轮检查…');
    return runKeepAliveNow();
  });

  return store;
}

/** 旧版遗留系统任务检测（只读查询，不注册不触发告警） */
async function detectLegacyTask(): Promise<boolean> {
  if (process.platform === 'win32') {
    return execFileP('schtasks', ['/Query', '/TN', 'GitHubCompassAutoUpdate'])
      .then(() => true)
      .catch(() => false);
  }
  if (process.platform === 'darwin') {
    return existsSync(path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.githubcompass.autoupdate.plist'));
  }
  return false;
}

function execFileP(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))),
  );
}
