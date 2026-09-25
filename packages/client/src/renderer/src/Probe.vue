<script setup lang="ts">
import { computed } from 'vue';
import { actions, store } from './store';
import Icon from './Icon.vue';
import type { ProbeResultInfo } from './env';

const bestKeys = computed(
  () => new Set((store.probe?.entries ?? []).map((e) => `${e.domain}|${e.ip}`)),
);

/** 每域名组内排序：本地通过按延迟升序 → 本地未通（远程备选）排后 */
const grouped = computed(() => {
  const map = new Map<string, ProbeResultInfo[]>();
  for (const r of store.probe?.results ?? []) {
    const arr = map.get(r.domain) ?? [];
    arr.push(r);
    map.set(r.domain, arr);
  }
  for (const [, arr] of map) {
    arr.sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      return (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9);
    });
  }
  return [...map.entries()];
});

const stats = computed(() => {
  const rs = store.probe?.results ?? [];
  const ok = rs.filter((r) => r.ok);
  const avg = ok.length ? Math.round(ok.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / ok.length) : 0;
  const certFails = rs.filter((r) => !r.ok && /certificate|issuer|self[- ]signed/i.test(r.error ?? '')).length;
  return { total: rs.length, passed: ok.length, avg, certFails };
});

const pct = computed(() => {
  const p = store.progress;
  if (!p) return store.probe ? 100 : 0;
  return p.total ? Math.round((p.done / p.total) * 100) : 0;
});

const noLocalOk = computed(() => !!store.probe && store.probe.entries.length === 0);
const sslSuspect = computed(() => store.probe?.failureReason === 'SSL_INSPECTION_SUSPECTED');
const selectionCount = computed(() => Object.keys(store.selections).length);

function sourceOf(domain: string, r: ProbeResultInfo): { cls: string; text: string } {
  if (bestKeys.value.has(`${domain}|${r.ip}`)) return { cls: 'ok', text: '★ 本地最优' };
  if (r.ok) return { cls: '', text: '✓ 本地通过' };
  return { cls: 'warn', text: '○ 本地未通（仅展示，不可写入）' };
}
</script>

<template>
  <div>
  <h2 class="view-title"><Icon name="radar" :size="19" />探测详情</h2>
  <p class="view-sub">
    仅本地实测通过的 IP 可写入（hosts 为强制解析，写入不通 IP 会阻断系统 DNS）· 每域名单选一个 · 未通行仅作展示
  </p>

  <p v-if="sslSuspect" class="error">
    <Icon name="alert" :size="15" />检测到 SSL 检查网络（证书链均不受信，如企业代理）——建议换可信网络重试；仍可选远程备选写入
  </p>
  <p v-else-if="noLocalOk" class="error" style="color: var(--warn); border-color: rgba(210, 153, 34, 0.55); background: rgba(210, 153, 34, 0.1)">
    <Icon name="alert" :size="15" />本地探测无通过项——已默认选中远程备选 IP（Actions 已 TLS 验证），可直接写入或重试探测
  </p>

  <section class="card">
    <h3>
      <Icon name="activity" :size="15" />本次探测
      <span class="h-right">
        <button class="btn sm" :disabled="store.busy" @click="actions.fetchAndProbe()">
          <Icon name="refresh" :size="13" />重新探测
        </button>
      </span>
    </h3>
    <div class="progress" :class="{ run: !!store.progress }">
      <i :style="{ width: pct + '%' }"></i>
    </div>
    <p v-if="store.progress" class="muted" style="font-size: 12.5px">
      探测中 {{ store.progress.done }}/{{ store.progress.total }} …
    </p>
    <p v-else-if="store.probe" class="muted" style="font-size: 12.5px">
      {{ stats.total }}/{{ stats.total }} 完成 · 本地通过 {{ stats.passed }} · 均延 {{ stats.avg }}ms ·
      {{ stats.certFails > 0 ? `证书类失败 ×${stats.certFails}` : '无证书类错误' }}
    </p>
    <p v-else class="muted" style="font-size: 12.5px">尚未探测</p>
  </section>

  <section v-if="store.probe" class="card tablewrap">
    <table>
      <thead>
        <tr><th style="width: 36px">选</th><th>域名</th><th>候选 IP</th><th>连通</th><th>TLS 验证</th><th>延迟</th><th>来源</th></tr>
      </thead>
      <tbody>
        <template v-for="[domain, list] in grouped" :key="domain">
          <tr
            v-for="(r, i) in list"
            :key="r.ip"
            :class="{ best: store.selections[domain] === r.ip, dim: !r.ok }"
          >
            <td>
              <input
                type="radio"
                :name="`pick-${domain}`"
                :value="r.ip"
                :checked="store.selections[domain] === r.ip"
                :disabled="!r.ok"
                :title="r.ok ? '' : '本地探测未通过，不可写入（hosts 强制解析会阻断系统 DNS 可用路径）'"
                style="accent-color: var(--accent)"
                @change="store.selections[domain] = r.ip"
              />
            </td>
            <td class="mono">{{ i === 0 ? domain : '' }}</td>
            <td class="mono">{{ r.ip }}</td>
            <td><span class="st-dot"><span class="d" :class="r.ok ? 'g' : 'r'"></span>{{ r.ok ? '通' : '断' }}</span></td>
            <td>
              <span v-if="r.ok" class="st-dot" style="color: var(--ok)"><Icon name="shield" :size="13" />证书+SAN</span>
              <span v-else class="muted" style="font-size: 12px">{{ r.error ?? '' }}</span>
            </td>
            <td class="mono">{{ r.ok ? `${r.latencyMs}ms` : '—' }}</td>
            <td><span class="badge" :class="sourceOf(domain, r).cls">{{ sourceOf(domain, r).text }}</span></td>
          </tr>
        </template>
      </tbody>
    </table>
  </section>

  <section v-if="store.probe" class="card actions" style="display: flex; align-items: center; gap: 14px">
    <template v-if="selectionCount > 0">
      <button class="btn primary lg" :disabled="store.busy" @click="actions.updateWithSelections()">
        <Icon name="zap" :size="16" />按所选更新 hosts（{{ selectionCount }} 条）
      </button>
      <span class="muted" style="font-size: 12.5px">
        已选 {{ selectionCount }}/{{ grouped.length }} 个域名（仅本地实测通过项）· 写入前自动备份，可随时回滚
      </span>
    </template>
    <span v-else class="muted">
      <Icon name="alert" :size="14" /> 本地无可用 IP（所有候选均未通过实测）——请"重新探测"或检查网络，未写入任何内容
    </span>
  </section>
  </div>
</template>

<style scoped>
.actions { display: flex; align-items: center; }
</style>
