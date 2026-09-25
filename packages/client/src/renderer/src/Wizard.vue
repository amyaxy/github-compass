<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { compass } from './api';
import { store } from './store';
import Icon from './Icon.vue';
import type { EnvInfo, FetchInfo, ProbeInfo } from './env';

const emit = defineEmits<{ done: []; close: [] }>();

const step = ref(0);
const env = ref<EnvInfo | null>(null);
const remote = ref<FetchInfo | null>(null);
const probe = ref<ProbeInfo | null>(null);
const snippet = ref('');
const copied = ref(false);
const busy = ref(false);
const errorMsg = ref('');

const STEPS = ['欢迎', '环境检测', '拉取与探测', '应用', '完成'];
const pctBar = computed(() => {
  const p = store.progress;
  if (p && p.total) return Math.round((p.done / p.total) * 100);
  return probe.value ? 100 : 0;
});

async function guard(fn: () => Promise<void>): Promise<void> {
  busy.value = true;
  errorMsg.value = '';
  try {
    await fn();
  } catch (e) {
    errorMsg.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const checkEnv = (): Promise<void> =>
  guard(async () => {
    env.value = await compass.envCheck();
  });

const fetchAndProbe = (): Promise<void> =>
  guard(async () => {
    probe.value = null;
    remote.value = await compass.fetchRemote();
    store.progress = { done: 0, total: 0 };
    probe.value = await compass.probe();
    store.progress = null;
  });

const doWrite = (): Promise<void> =>
  guard(async () => {
    await compass.applyUpdate();
    step.value = 4;
  });

const doExport = (): Promise<void> =>
  guard(async () => {
    snippet.value = await compass.exportSnippet();
    step.value = 4;
  });

async function copySnippet(): Promise<void> {
  try {
    await navigator.clipboard.writeText(snippet.value);
    copied.value = true;
  } catch {
    errorMsg.value = '复制失败，请手动选中文本复制';
  }
}

const saveSnippet = (): Promise<void> =>
  guard(async () => {
    await compass.saveSnippet(snippet.value);
  });

onMounted(() => void checkEnv());
</script>

<template>
  <div class="wizard" @click.self="emit('close')">
    <div class="wz">
      <div class="wz-side">
        <div class="wz-brand"><Icon name="compass" :size="18" />首启向导</div>
        <div
          v-for="(s, i) in STEPS"
          :key="s"
          class="st"
          :class="{ done: i < step, cur: i === step, last: i === STEPS.length - 1 }"
        >
          <span class="n">{{ i < step ? '✓' : i + 1 }}</span>{{ s }}
        </div>
        <div class="legal">
          本工具仅将 GitHub 官方域名指向其官方真实 IP（本地 hosts 优化），不提供代理服务，不转发流量，不收集数据。
        </div>
      </div>

      <div class="wz-body">
        <p v-if="errorMsg" class="error"><Icon name="alert" :size="15" />{{ errorMsg }}</p>

        <!-- 0 欢迎 -->
        <template v-if="step === 0">
          <h2><Icon name="sparkles" :size="20" />欢迎使用 GitHubCompass</h2>
          <p class="desc">解决国内访问 GitHub 图裂、加载慢的问题。全程本地 DNS 解析优化，安全合规。</p>
          <div class="wz-foot">
            <button class="btn ghost" @click="emit('close')">跳过</button>
            <button class="btn primary" style="margin-left: auto" @click="(checkEnv(), (step = 1))">开始配置</button>
          </div>
        </template>

        <!-- 1 环境检测 -->
        <template v-else-if="step === 1">
          <h2>环境检测</h2>
          <p class="desc">确认平台与 hosts 文件写入条件</p>
          <table class="card" style="margin: 0">
            <tbody>
              <tr><td>平台</td><td class="mono">{{ env?.platform ?? '…' }}</td></tr>
              <tr><td>hosts 路径</td><td class="mono">{{ env?.hostsPath }}</td></tr>
              <tr><td>直接可写</td><td>{{ env?.writable ? '✓ 是' : '✕ 否' }}</td></tr>
              <tr><td>说明</td><td>{{ env?.note }}</td></tr>
            </tbody>
          </table>
          <div class="wz-foot">
            <button class="btn ghost" @click="step = 0">← 上一步</button>
            <button class="btn primary" style="margin-left: auto" :disabled="busy" @click="(fetchAndProbe(), (step = 2))">
              下一步：拉取数据 →
            </button>
          </div>
        </template>

        <!-- 2 拉取与探测 -->
        <template v-else-if="step === 2">
          <h2>{{ probe ? '拉取与探测完成' : '正在拉取与探测…' }}</h2>
          <p class="desc">
            通道 <b>{{ remote?.channel ?? '…' }}</b> · 版本 <b>v{{ remote?.version ?? '—' }}</b> ·
            候选 {{ remote?.groups.reduce((s, g) => s + g.count, 0) ?? 0 }} IP
          </p>
          <div class="progress" :class="{ run: !probe }"><i :style="{ width: pctBar + '%' }"></i></div>
          <div class="card" style="margin-top: 10px; max-height: 240px; overflow: auto; padding: 4px 8px">
            <table>
              <thead><tr><th>域名</th><th>最优 IP</th><th>本地延迟</th></tr></thead>
              <tbody>
                <tr v-for="e in probe?.entries" :key="e.domain">
                  <td class="mono">{{ e.domain }}</td>
                  <td class="mono">{{ e.ip }}</td>
                  <td>{{ e.latencyMs }}ms</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="wz-foot">
            <button class="btn ghost" @click="step = 1">← 上一步</button>
            <button class="btn primary" style="margin-left: auto" :disabled="busy || !probe || probe.entries.length === 0" @click="step = 3">
              下一步：应用 →
            </button>
            <button class="btn" :disabled="busy" @click="fetchAndProbe"><Icon name="refresh" :size="13" />重试</button>
          </div>
        </template>

        <!-- 3 应用 -->
        <template v-else-if="step === 3">
          <h2>应用方式</h2>
          <p class="desc">推荐直接写入系统 hosts（将弹出系统授权框，写入前自动备份，可随时回滚）。</p>
          <div class="wz-foot">
            <button class="btn ghost" @click="step = 2">← 上一步</button>
            <button class="btn primary" style="margin-left: auto" :disabled="busy" @click="doWrite">
              <Icon name="zap" :size="15" />授权写入 hosts（v{{ probe?.version }}）
            </button>
            <button class="btn" :disabled="busy" @click="doExport"><Icon name="copy" :size="14" />只读导出</button>
          </div>
        </template>

        <!-- 4 完成 -->
        <template v-else>
          <h2>{{ snippet ? '手动模式：复制以下片段' : '配置完成 🎉' }}</h2>
          <template v-if="snippet">
            <p class="desc">请将以下内容追加到 <span class="mono">{{ env?.hostsPath }}</span> 末尾：</p>
            <textarea class="snippet" readonly :value="snippet"></textarea>
            <div class="wz-foot">
              <button class="btn" @click="copySnippet">{{ copied ? '✓ 已复制' : '复制片段' }}</button>
              <button class="btn" :disabled="busy" @click="saveSnippet">保存为 txt…</button>
              <button class="btn primary" style="margin-left: auto" @click="emit('done')">进入主界面</button>
            </div>
          </template>
          <p v-else class="desc">已写入最优解析并刷新 DNS 缓存，GitHub 访问已优化。可随时在"备份回滚"中还原。</p>
          <div v-if="!snippet" class="wz-foot">
            <button class="btn primary" style="margin-left: auto" @click="emit('done')">进入主界面</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
