import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_CHANNEL_ORDER } from './fetcher.js';

export interface BackupRecord {
  id: string;
  path: string;
  createdAt: string;
  trigger: 'update' | 'rollback';
  /** 本次写入对应的数据版本 */
  version?: number;
}

export interface Settings {
  autoUpdate: boolean;
  intervalHours: number;
  channelOrder: string[];
  launchAtLogin: boolean;
  minimizeToTray: boolean;
  probeTimeoutMs: number;
  probeConcurrency: number;
  backupKeep: number;
  /** 自动保活定时器间隔（分钟） */
  autoUpdateIntervalMin: number;
}

export const DEFAULT_SETTINGS: Settings = {
  autoUpdate: false,
  intervalHours: 6,
  channelOrder: ['raw-pinned', 'snapshot'],
  launchAtLogin: false,
  minimizeToTray: true,
  probeTimeoutMs: 4000,
  probeConcurrency: 10,
  backupKeep: 10,
  autoUpdateIntervalMin: 10,
};

export interface ClientConfig {
  /** 已写入 hosts 的数据版本；0 = 从未写入 */
  appliedVersion: number;
  appliedAt: string | null;
  /** 首启向导是否完成 */
  firstRunDone: boolean;
  /** 上次成功写入的 域名→IP（raw-pinned 通道用） */
  lastGoodIps: Record<string, string>;
  settings: Settings;
  backups: BackupRecord[];
  /** runtime 扩池产物（域名→实测可用 IP 列表，质量降序，上限 12）：候选池枯竭时兜底 */
  expandedPools: Record<string, string[]>;
  /** 最近一次"候选池无可用替代"的时间（ISO）：冷却期内跳过全量重探，避免限速时段空转 */
  lastDegradedAt: string | null;
}

const DEFAULT_CONFIG: ClientConfig = {
  appliedVersion: 0,
  appliedAt: null,
  firstRunDone: false,
  lastGoodIps: {},
  settings: { ...DEFAULT_SETTINGS },
  backups: [],
  expandedPools: {},
  lastDegradedAt: null,
};

/** 通道迁移：过滤掉已下线通道（jsdelivr/raw 等，2026-09-25 精简），未知项清空时回退默认顺序 */
function normalizeChannelOrder(order: unknown): string[] {
  if (!Array.isArray(order)) return [...DEFAULT_CHANNEL_ORDER];
  const known = order.filter((c): c is string => DEFAULT_CHANNEL_ORDER.includes(c));
  return known.length > 0 ? known : [...DEFAULT_CHANNEL_ORDER];
}

/** userData 下的 JSON 持久化（零依赖） */
export class ConfigStore {
  private file: string;
  private data: ClientConfig;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'config.json');
    this.data = structuredClone(DEFAULT_CONFIG);
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ClientConfig>;
        this.data = {
          ...structuredClone(DEFAULT_CONFIG),
          ...raw,
          settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        };
        this.data.settings.channelOrder = normalizeChannelOrder(raw.settings?.channelOrder);
        // 语言切换已移除（仅中文）：清理旧配置残留字段
        delete (this.data.settings as Record<string, unknown>).language;
      } catch {
        // 配置损坏则重置
      }
    }
  }

  get(): ClientConfig {
    return this.data;
  }

  getSettings(): Settings {
    return this.data.settings;
  }

  update(patch: Partial<ClientConfig>): void {
    this.data = { ...this.data, ...patch };
    this.save();
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }

  addBackup(rec: BackupRecord): void {
    const keep = this.data.settings.backupKeep;
    this.data.backups = [rec, ...this.data.backups].slice(0, keep);
    this.save();
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}
