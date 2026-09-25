<script setup lang="ts">
import { cstTime } from './time';
import { onMounted, ref } from 'vue';
import { compass } from './api';
import { pushLog, store } from './store';
import Icon from './Icon.vue';
import type { Settings } from './env';

const s = ref<Settings | null>(null);
const autoStatus = ref<{
  running: boolean;
  intervalMin: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastAction: string | null;
  lastReason: string | null;
  logTail?: string;
  legacyTask?: boolean;
} | null>(null);
const autoBusy = ref(false);

onMounted(async () => {
  s.value = store.settings ?? (await compass.configGet());
  void loadAutoStatus();
});

async function loadAutoStatus(): Promise<void> {
  try {
    autoStatus.value = await compass.autoStatus();
  } catch {
    autoStatus.value = null;
  }
}

async function save(patch: Partial<Settings>): Promise<void> {
  if (!s.value) return;
  s.value = await compass.configSet(patch);
  store.settings = s.value;
  pushLog(`[${cstTime()}] 设置已保存（${Object.keys(patch).join(', ')}）`);
}

const CHANNEL_LABELS: Record<string, [string, string]> = {
  'raw-pinned': ['raw + 缓存 IP 直连', '用上次成功 IP，SNI/证书校验不跳过'],
  snapshot: ['内置兜底池', 'candidates.snapshot.json（随版本打包）'],
};

function toggleChannel(name: string): void {
  if (!s.value) return;
  const cur = s.value.channelOrder;
  const next = cur.includes(name) ? cur.filter((c) => c !== name) : [...cur, name];
  void save({ channelOrder: next });
}

async function exportLogs(): Promise<void> {
  await navigator.clipboard.writeText(store.logs.join('\n'));
  pushLog(`[${cstTime()}] 诊断日志已复制到剪贴板`);
}

/** 自动保活：开=启动应用内定时器，关=停止 */
async function toggleAutoUpdate(): Promise<void> {
  if (!s.value || autoBusy.value) return;
  autoBusy.value = true;
  try {
    if (s.value.autoUpdate) {
      await compass.autoUnregister();
      await save({ autoUpdate: false });
      pushLog(`[${cstTime()}] 自动保活已关闭（定时器已停止）`);
    } else {
      await compass.autoRegister(s.value.autoUpdateIntervalMin);
      await save({ autoUpdate: true });
      pushLog(
        `[${cstTime()}] 自动保活已开启（每 ${s.value.autoUpdateIntervalMin} 分钟，应用内定时器运行）`,
      );
    }
    await loadAutoStatus();
  } catch (e) {
    pushLog(
      `[${cstTime()}] 自动保活操作失败：${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    autoBusy.value = false;
  }
}

/** 间隔改动需重新注册任务 */
async function changeAutoInterval(min: number): Promise<void> {
  if (!s.value || autoBusy.value) return;
  await save({ autoUpdateIntervalMin: min });
  if (s.value.autoUpdate) {
    autoBusy.value = true;
    try {
      await compass.autoRegister(min);
      await loadAutoStatus();
      pushLog(`[${cstTime()}] 检查间隔已更新为每 ${min} 分钟`);
    } catch (e) {
      pushLog(`[${cstTime()}] 重新注册失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      autoBusy.value = false;
    }
  }
}

/** GUI 内立即跑一轮健康检查（写入时可能弹 UAC） */
async function runAutoNow(): Promise<void> {
  if (autoBusy.value) return;
  autoBusy.value = true;
  try {
    const r = await compass.autoRunNow();
    pushLog(`[${cstTime()}] 自动检查：${r.action} —— ${r.reason}`);
    await loadAutoStatus();
  } catch (e) {
    pushLog(`[${cstTime()}] 自动检查失败：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    autoBusy.value = false;
  }
}

/** 清理旧版遗留的系统计划任务（Windows 需一次 UAC；macOS 免权限） */
async function removeLegacy(): Promise<void> {
  if (autoBusy.value) return;
  autoBusy.value = true;
  try {
    await compass.autoLegacyRemove();
    pushLog(`[${cstTime()}] 旧版系统计划任务已清理`);
    await loadAutoStatus();
  } catch (e) {
    pushLog(`[${cstTime()}] 清理失败（可手动删除计划任务 GitHubCompassAutoUpdate）：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    autoBusy.value = false;
  }
}
</script>

<template>
  <div>
  <h2 class="view-title"><Icon name="settings" :size="19" />设置</h2>
  <p class="view-sub">修改即时保存；自动保活为应用内定时器（不依赖系统计划任务）；托盘常驻与开机自启均已生效</p>

  <template v-if="s">
    <section class="card">
      <h3><Icon name="shield" :size="15" />自动保活（闭环稳定性）</h3>
      <div class="set-row">
        <div class="lab">
          <b>定时健康检查 + 劣化自动切换</b>
          <span>应用内定时器周期探测并自动换优写入（含备份、刷新 DNS）；不注册系统计划任务、无需 UAC，需保持托盘常驻（建议开启开机自启）</span>
        </div>
        <div class="toggle" :class="{ on: s.autoUpdate }" @click="toggleAutoUpdate"><i></i></div>
      </div>
      <div class="set-row">
        <div class="lab"><b>检查间隔</b><span>改动即时生效</span></div>
        <select
          :value="s.autoUpdateIntervalMin"
          :disabled="autoBusy"
          @change="changeAutoInterval(Number(($event.target as HTMLSelectElement).value))"
        >
          <option :value="5">每 5 分钟</option>
          <option :value="10">每 10 分钟</option>
          <option :value="15">每 15 分钟</option>
          <option :value="30">每 30 分钟</option>
        </select>
      </div>
      <div class="set-row">
        <div class="lab">
          <b>保活状态</b>
          <span v-if="autoStatus?.running">
            运行中 · 下次 {{ autoStatus.nextRunAt ?? '启动后 60 秒首查' }} · 上次 {{ autoStatus.lastRunAt ?? '—' }}（{{ autoStatus.lastAction ?? '—' }}）
          </span>
          <span v-else>已停止（开启上方开关即应用内运行）</span>
        </div>
        <button class="btn sm" :disabled="autoBusy" @click="runAutoNow"><Icon name="play" :size="12" />立即检查</button>
      </div>
      <div v-if="autoStatus?.legacyTask" class="error" style="color: var(--warn); border-color: rgba(210, 153, 34, 0.55); background: rgba(210, 153, 34, 0.1)">
        <Icon name="alert" :size="15" />
        <span style="flex: 1">检测到旧版系统计划任务残留（可能触发安全软件告警），建议清理。</span>
        <button class="btn sm" :disabled="autoBusy" @click="removeLegacy">清理旧任务</button>
      </div>
      <pre v-if="autoStatus?.logTail" class="logbox">{{ autoStatus.logTail }}</pre>
    </section>

    <section class="card">
      <h3><Icon name="download" :size="15" />拉取通道（关闭即从顺序中移除）</h3>
      <div v-for="(name, i) in s.channelOrder" :key="name" class="chan">
        <span class="ord">{{ i + 1 }}</span>
        <span class="nm">
          <b>{{ CHANNEL_LABELS[name]?.[0] ?? name }}</b>
          <small v-if="CHANNEL_LABELS[name]?.[1]">{{ CHANNEL_LABELS[name][1] }}</small>
        </span>
        <div class="toggle on" @click="toggleChannel(name)"><i></i></div>
      </div>
      <div v-for="name in Object.keys(CHANNEL_LABELS).filter((n) => !s.channelOrder.includes(n))" :key="'off' + name" class="chan off">
        <span class="ord">—</span>
        <span class="nm"><b>{{ CHANNEL_LABELS[name][0] }}</b><small>{{ CHANNEL_LABELS[name][1] }}</small></span>
        <div class="toggle" @click="toggleChannel(name)"><i></i></div>
      </div>
    </section>

    <section class="card">
      <h3><Icon name="zap" :size="15" />系统</h3>
      <div class="set-row">
        <div class="lab"><b>开机自启</b><span>登录系统后自动启动并常驻托盘</span></div>
        <div class="toggle" :class="{ on: s.launchAtLogin }" @click="save({ launchAtLogin: !s.launchAtLogin })"><i></i></div>
      </div>
      <div class="set-row">
        <div class="lab"><b>关闭时最小化到托盘</b><span>关闭窗口后后台常驻，托盘菜单可退出</span></div>
        <div class="toggle" :class="{ on: s.minimizeToTray }" @click="save({ minimizeToTray: !s.minimizeToTray })"><i></i></div>
      </div>
      <div class="set-row">
        <div class="lab"><b>重新运行首启向导</b></div>
        <button class="btn sm" @click="store.showWizard = true">打开向导</button>
      </div>
    </section>

    <section class="card">
      <h3><Icon name="settings" :size="15" />高级</h3>
      <div class="set-row">
        <div class="lab"><b>探测超时</b><span>单个 TLS 握手等待上限，下次探测生效</span></div>
        <select :value="s.probeTimeoutMs" @change="save({ probeTimeoutMs: Number(($event.target as HTMLSelectElement).value) })">
          <option :value="3000">3000ms</option>
          <option :value="4000">4000ms</option>
          <option :value="6000">6000ms</option>
        </select>
      </div>
      <div class="set-row">
        <div class="lab"><b>探测并发</b></div>
        <select :value="s.probeConcurrency" @change="save({ probeConcurrency: Number(($event.target as HTMLSelectElement).value) })">
          <option :value="5">5</option>
          <option :value="10">10</option>
          <option :value="20">20</option>
        </select>
      </div>
      <div class="set-row">
        <div class="lab"><b>备份保留数</b></div>
        <select :value="s.backupKeep" @change="save({ backupKeep: Number(($event.target as HTMLSelectElement).value) })">
          <option :value="5">5</option>
          <option :value="10">10</option>
          <option :value="20">20</option>
        </select>
      </div>
      <div class="set-row">
        <div class="lab"><b>导出诊断日志</b><span>不收集任何用户数据，仅本机操作记录</span></div>
        <button class="btn sm" @click="exportLogs">复制到剪贴板</button>
      </div>
    </section>
  </template>
  </div>
</template>
