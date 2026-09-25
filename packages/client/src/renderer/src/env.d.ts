export interface CandidateGroupInfo {
  domain: string;
  count: number;
}

export interface FetchInfo {
  version: number;
  generatedAt: string;
  channel: string;
  groups: CandidateGroupInfo[];
  upToDate: boolean;
}

export interface ProbeEntry {
  domain: string;
  ip: string;
  latencyMs: number;
  tlsVerified: boolean;
  checkedAt: string;
}

export interface ProbeResultInfo {
  domain: string;
  ip: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ProbeInfo {
  entries: ProbeEntry[];
  results: ProbeResultInfo[];
  failureReason: string | null;
  version: number;
}

export interface EnvInfo {
  platform: string;
  hostsPath: string;
  writable: boolean;
  note: string;
}

export interface BackupRecord {
  id: string;
  path: string;
  createdAt: string;
  trigger: string;
  version?: number;
}

export interface DiffInfo {
  before: string;
  after: string;
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

export interface ClientState {
  /** 客户端版本（app.getVersion，与 package.json 对齐） */
  version: string;
  config: {
    appliedVersion: number;
    appliedAt: string | null;
    firstRunDone: boolean;
    lastGoodIps: Record<string, string>;
    settings: Settings;
    backups: BackupRecord[];
  };
  cached: { version: number; generatedAt: string } | null;
}

declare global {
  interface Window {
    compass: {
      getState(): Promise<ClientState>;
      envCheck(): Promise<EnvInfo>;
      fetchRemote(): Promise<FetchInfo>;
      probe(): Promise<ProbeInfo>;
      applyUpdate(
        selections?: Array<{ domain: string; ip: string }>,
        opts?: { skipIfSame?: boolean },
      ): Promise<{ skipped: boolean; version: number }>;
      exportSnippet(): Promise<string>;
      saveSnippet(content: string): Promise<{ saved: boolean; filePath?: string }>;
      diffBackup(backupPath: string): Promise<DiffInfo>;
      configGet(): Promise<Settings>;
      configSet(patch: Partial<Settings>): Promise<Settings>;
      winCtl(action: 'min' | 'max' | 'close'): Promise<void>;
      completeWizard(): Promise<{ ok: boolean }>;
      listBackups(): Promise<BackupRecord[]>;
      rollback(backupPath: string): Promise<{ ok: boolean }>;
      autoRegister(intervalMin: number): Promise<{ ok: boolean }>;
      autoUnregister(): Promise<{ ok: boolean }>;
      autoStatus(): Promise<{
        running: boolean;
        intervalMin: number;
        nextRunAt: string | null;
        lastRunAt: string | null;
        lastAction: string | null;
        lastReason: string | null;
        logTail?: string;
        legacyTask?: boolean;
      }>;
      autoLegacyRemove(): Promise<{ ok: boolean; legacyTask: boolean }>;
      autoRunNow(): Promise<{
        action: 'none' | 'write' | 'error';
        reason: string;
        switched?: Array<{ domain: string; from: string; to: string }>;
        version?: number;
      }>;
      onLog(cb: (line: string) => void): () => void;
      onProbeProgress(cb: (p: { done: number; total: number }) => void): () => void;
    };
  }
}

export {};
