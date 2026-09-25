<script setup lang="ts">
import { cstDateTime, cstDate } from './time';
import { useRouter } from 'vue-router';
import { actions, health, status, store } from './store';
import Icon from './Icon.vue';

const router = useRouter();

function latCls(ms: number): string {
  return ms < 250 ? 'g' : ms < 450 ? 'y' : 'r';
}
function latPct(ms: number): number {
  return Math.min(100, (ms / 700) * 100);
}
function seedAge(): string {
  const g = store.remote?.generatedAt;
  if (!g) return '—';
  const days = Math.floor((Date.now() - Date.parse(g)) / 86400000);
  return days <= 0 ? '今日' : `${days} 天前`;
}
const recent = () => [...store.logs].slice(-7).reverse();
</script>

<template>
  <div>
  <h2 class="view-title"><Icon name="dashboard" :size="19" />仪表盘</h2>
  <p class="view-sub">GitHub 访问优化状态总览 · 仅本地 DNS 解析，无代理</p>

  <div class="status-banner">
    <div class="status-ico" :class="{ idle: status.cls !== 'ok' }">
      <Icon :name="status.cls === 'ok' ? 'shield' : 'activity'" :size="24" :weight="1.7" />
    </div>
    <div class="status-main">
      <div class="big" :style="{ color: status.cls === 'ok' ? 'var(--ok)' : 'var(--muted)' }">
        {{ status.text }}
      </div>
      <div class="facts">
        <span class="fact"><Icon name="database" :size="13" />种子数据 <b>{{ store.remote ? `v${store.remote.version}` : '—' }}</b></span>
        <span class="fact"><Icon name="clock" :size="13" />数据生成于 <b>{{ store.remote ? `${seedAge()}（${cstDate(store.remote.generatedAt)}）` : '—' }}</b></span>
        <span class="fact"><Icon name="play" :size="12" />上次写入 <b>{{ store.state?.config.appliedAt ? cstDateTime(store.state.config.appliedAt) : '—' }}</b></span>
        <span class="fact"><Icon name="download" :size="13" />来源通道 <b>{{ store.remote?.channel ?? '—' }}</b></span>
        <span class="fact"><Icon name="radar" :size="13" />本地探测 <b>{{ health.ok }}/{{ health.total }} 域名</b></span>
      </div>
    </div>
    <button
      class="btn primary lg"
      :disabled="store.busy || !store.probe || store.probe.entries.length === 0"
      :title="store.probe && store.probe.entries.length === 0 ? '本地无通过项，请到探测详情手动选择远程备选' : '一键写入本地最优'"
      @click="actions.update()"
    >
      <Icon name="refresh" :size="16" />立即更新
    </button>
  </div>

  <section class="card">
    <h3>
      <Icon name="activity" :size="15" />域名健康
      <span class="h-right muted" style="font-size: 12.5px">
        本地实测延迟 · TLS 证书链均已验证 ·
        <a href="#" style="color: var(--accent-h)" @click.prevent="router.push('/probe')">查看探测明细</a>
      </span>
    </h3>
    <div v-if="store.probe" class="grid">
      <div v-for="e in store.probe.entries" :key="e.domain" class="dcard">
        <div class="dom">
          <span class="dm-ico"><Icon name="globe" :size="14" /></span>
          <span class="dm-name" :title="e.domain">{{ e.domain }}</span>
          <span class="tls"><Icon name="check" :size="10" :weight="2.6" />TLS</span>
        </div>
        <div class="ip">{{ e.ip }}</div>
        <div class="lat">
          <div class="bar"><i :class="latCls(e.latencyMs)" :style="{ width: latPct(e.latencyMs) + '%' }"></i></div>
          <span>{{ e.latencyMs }}ms</span>
        </div>
      </div>
    </div>
    <p v-else-if="store.progress" class="muted">
      <Icon name="radar" :size="14" /> 探测中 {{ store.progress.done }}/{{ store.progress.total }} …
    </p>
    <div v-else class="empty">
      <Icon name="radar" :size="30" :weight="1.4" />
      等待探测结果…
      <small>启动后会自动探测；也可到「探测详情」手动重试</small>
    </div>
  </section>

  <section class="card">
    <h3><Icon name="history" :size="15" />最近活动</h3>
    <ul class="timeline">
      <li v-for="(l, i) in recent()" :key="i">
        <span class="tld"></span>
        <span class="t">{{ l.match(/\[(\d{2}:\d{2}:\d{2})\]/)?.[1] ?? '' }}</span>
        <span>{{ l.replace(/^\[[^\]]+\]\s*/, '') }}</span>
      </li>
      <li v-if="recent().length === 0">
        <span class="tld" style="opacity: 0.3"></span><span class="muted">暂无活动</span>
      </li>
    </ul>
  </section>
  </div>
</template>
