<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { compass } from './api';
import { actions, health, pushLog, status, store } from './store';
import { NAV_ITEMS } from './router';
import Icon from './Icon.vue';
import Wizard from './Wizard.vue';

const route = useRoute();
const router = useRouter();
let offLog: (() => void) | null = null;
let offProgress: (() => void) | null = null;

onMounted(async () => {
  offLog = compass.onLog(pushLog);
  offProgress = compass.onProbeProgress((p) => {
    store.progress = p;
  });
  try {
    await actions.refreshState();
    if (!store.state?.config.firstRunDone) store.showWizard = true;
  } catch (e) {
    pushLog(`初始化失败：${(e as Error).message}`);
  }
  void actions.fetchAndProbe(); // 无条件自动拉取探测；in-flight 互斥锁保证与向导并发时只跑一次
});

onBeforeUnmount(() => {
  offLog?.();
  offProgress?.();
});

async function wizardDone(): Promise<void> {
  await compass.completeWizard();
  store.showWizard = false;
  await actions.refreshState();
  void actions.fetchAndProbe(); // 向导结束后为主界面刷新数据（main 有缓存，秒回）
}
</script>

<template>
  <header class="titlebar">
    <span class="brand-chip">
      <!-- 与 icon.png/icon.ico/tray.png 同一完整字形：细环+针+深色中心点 -->
      <svg viewBox="0 0 64 64" width="24" height="24" aria-hidden="true">
        <defs>
          <linearGradient id="gbchip" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#4c93ff" />
            <stop offset="1" stop-color="#1b9c82" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#gbchip)" />
        <circle cx="32" cy="32" r="19" fill="none" stroke="#fff" stroke-width="3.6" />
        <path d="M41 23L36.4 35.4 23 41l4.6-12.4z" fill="#fff" />
        <circle cx="32" cy="32" r="2.8" fill="#0d1117" />
      </svg>
    </span>
    <span class="tname">GitHubCompass</span>
    <div class="tspacer"></div>
    <span class="badge" :class="status.cls"><span class="dotb"></span>{{ status.text }}</span>
    <div class="wbtns">
      <button class="wbtn" title="最小化" @click="compass.winCtl('min')"><Icon name="min" :size="14" /></button>
      <button class="wbtn" title="最大化" @click="compass.winCtl('max')"><Icon name="max" :size="13" /></button>
      <button class="wbtn close" title="关闭（托盘常驻）" @click="compass.winCtl('close')"><Icon name="x" :size="13" /></button>
    </div>
  </header>

  <div class="layout">
    <aside class="sidebar">
      <button
        v-for="n in NAV_ITEMS"
        :key="n.path"
        class="nav-item"
        :class="{ active: route.path === n.path }"
        @click="router.push(n.path)"
      >
        <span class="ico"><Icon :name="n.ico" :size="17" /></span>{{ n.label }}
      </button>
      <button class="nav-item wizard-entry" @click="store.showWizard = true">
        <span class="ico"><Icon name="sparkles" :size="17" /></span>预览首启向导
      </button>
      <div class="side-foot">
        <div class="row"><span class="grow">客户端</span><span class="mono">v{{ store.state?.version ?? '—' }}</span></div>
        <div class="row">
          <span class="grow">种子数据</span>
          <span class="mono">{{ store.state?.config.appliedVersion ? `v${store.state.config.appliedVersion}` : '—' }}</span>
        </div>
        <div class="row health" :class="{ idle: health.ok === 0 }">
          <span class="dot"></span>{{ health.ok }}/{{ health.total }} 域名健康
        </div>
      </div>
    </aside>

    <main class="main">
      <p v-if="store.errorMsg" class="error"><Icon name="alert" :size="15" />{{ store.errorMsg }}</p>
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" :key="route.path" />
        </transition>
      </router-view>
    </main>
  </div>

  <Wizard v-if="store.showWizard" @done="wizardDone" @close="store.showWizard = false" />
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.16s ease, transform 0.16s var(--ease);
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.titlebar .badge.idle { color: var(--muted); }
.side-foot .health.idle { color: var(--muted); }
.side-foot .health.idle .dot { background: var(--muted); box-shadow: none; animation: none; }
</style>
