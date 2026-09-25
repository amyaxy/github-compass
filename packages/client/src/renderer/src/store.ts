import { cstTime } from './time';
import { computed, reactive } from 'vue';
import { compass } from './api';
import type { BackupRecord, ClientState, FetchInfo, ProbeInfo, ProbeResultInfo, Settings } from './env';

export const store = reactive({
  state: null as ClientState | null,
  remote: null as FetchInfo | null,
  probe: null as ProbeInfo | null,
  /** 用户自选写入：domain → ip（本地优先，远程备选） */
  selections: {} as Record<string, string>,
  backups: [] as BackupRecord[],
  settings: null as Settings | null,
  logs: [] as string[],
  progress: null as { done: number; total: number } | null,
  busy: false,
  errorMsg: '',
  /** 首启向导模态开关（App 级，任何页面可唤起） */
  showWizard: false,
});

/** 探测完成后初始化选择：仅本地通过项；全不通域名无可选（不写入坏 IP） */
export function initSelections(): void {
  const byDomain = new Map<string, ProbeResultInfo[]>();
  for (const r of store.probe?.results ?? []) {
    const arr = byDomain.get(r.domain) ?? [];
    arr.push(r);
    byDomain.set(r.domain, arr);
  }
  const sel: Record<string, string> = {};
  for (const [domain, arr] of byDomain) {
    const ok = arr.filter((r) => r.ok).sort((a, b) => (a.latencyMs ?? 0) - (b.latencyMs ?? 0));
    if (ok.length > 0) sel[domain] = ok[0].ip;
  }
  store.selections = sel;
}

export const status = computed(() => {
  const v = store.state?.config.appliedVersion ?? 0;
  return v > 0 ? { text: `已优化 v${v}`, cls: 'ok' } : { text: '未优化', cls: 'idle' };
});

export const health = computed(() => ({
  ok: store.probe?.entries.length ?? 0,
  total: store.remote?.groups.length ?? 0,
}));

export function pushLog(line: string): void {
  store.logs.push(line);
  if (store.logs.length > 300) store.logs.shift();
}

let fetchInflight: Promise<void> | null = null;

export const actions = {
  async refreshState(): Promise<void> {
    store.state = await compass.getState();
    store.backups = await compass.listBackups();
    store.settings = await compass.configGet();
  },

  /** 拉取+探测；in-flight 互斥：并发调用（App 自动 / 向导 / 手动重试）合并为一次 */
  async fetchAndProbe(): Promise<void> {
    if (fetchInflight) return fetchInflight;
    fetchInflight = (async () => {
      store.busy = true;
      store.errorMsg = '';
      try {
        store.probe = null;
        store.remote = await compass.fetchRemote();
        store.progress = { done: 0, total: 0 };
        store.probe = await compass.probe();
        store.progress = null;
        initSelections();
        await this.refreshState();
      } catch (e) {
        store.errorMsg = (e as Error).message;
        store.progress = null;
      } finally {
        store.busy = false;
      }
    })();
    try {
      await fetchInflight;
    } finally {
      fetchInflight = null;
    }
  },

  async update(): Promise<void> {
    store.busy = true;
    store.errorMsg = '';
    try {
      const r = await compass.applyUpdate();
      if (r.skipped) pushLog(`[${cstTime()}] （自动模式）内容与当前 hosts 一致，未写入`);
      else pushLog(`[${cstTime()}] 已写入本地最优结果`);
      await this.refreshState();
    } catch (e) {
      store.errorMsg = (e as Error).message;
    } finally {
      store.busy = false;
    }
  },

  /** 按用户自选（本地优先、远程备选）写入 */
  async updateWithSelections(): Promise<void> {
    const selections = Object.entries(store.selections).map(([domain, ip]) => ({ domain, ip }));
    if (selections.length === 0) {
      store.errorMsg = '尚无可选候选，请先拉取并探测';
      return;
    }
    store.busy = true;
    store.errorMsg = '';
    try {
      const r = await compass.applyUpdate(selections);
      if (r.skipped) pushLog(`[${cstTime()}] （自动模式）内容与当前 hosts 一致，未写入`);
      else pushLog(`[${cstTime()}] 已按自选 ${selections.length} 条写入 hosts`);
      await this.refreshState();
    } catch (e) {
      store.errorMsg = (e as Error).message;
    } finally {
      store.busy = false;
    }
  },

  async rollback(backupPath: string): Promise<void> {
    store.busy = true;
    store.errorMsg = '';
    try {
      await compass.rollback(backupPath);
      await this.refreshState();
    } catch (e) {
      store.errorMsg = (e as Error).message;
    } finally {
      store.busy = false;
    }
  },
};
