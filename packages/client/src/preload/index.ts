import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getState: () => ipcRenderer.invoke('compass:state'),
  envCheck: () => ipcRenderer.invoke('compass:env-check'),
  fetchRemote: () => ipcRenderer.invoke('compass:fetch'),
  probe: () => ipcRenderer.invoke('compass:probe'),
  applyUpdate: (
    selections?: Array<{ domain: string; ip: string }>,
    opts?: { skipIfSame?: boolean },
  ) => ipcRenderer.invoke('compass:update', selections, opts),
  exportSnippet: () => ipcRenderer.invoke('compass:export-snippet'),
  saveSnippet: (content: string) => ipcRenderer.invoke('compass:save-snippet', content),
  diffBackup: (backupPath: string) => ipcRenderer.invoke('compass:diff-backup', backupPath),
  configGet: () => ipcRenderer.invoke('compass:config:get'),
  configSet: (patch: Record<string, unknown>) => ipcRenderer.invoke('compass:config:set', patch),
  winCtl: (action: 'min' | 'max' | 'close') => ipcRenderer.invoke('compass:win', action),
  completeWizard: () => ipcRenderer.invoke('compass:complete-wizard'),
  listBackups: () => ipcRenderer.invoke('compass:backups'),
  rollback: (backupPath: string) => ipcRenderer.invoke('compass:rollback', backupPath),
  autoRegister: (intervalMin: number) =>
    ipcRenderer.invoke('compass:autoupdate:register', intervalMin),
  autoUnregister: () => ipcRenderer.invoke('compass:autoupdate:unregister'),
  autoStatus: () => ipcRenderer.invoke('compass:autoupdate:status'),
  autoLegacyRemove: () => ipcRenderer.invoke('compass:autoupdate:legacy-remove'),
  autoRunNow: () => ipcRenderer.invoke('compass:autoupdate:run-now'),
  onLog: (cb: (line: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, line: string) => cb(line);
    ipcRenderer.on('compass:log', listener);
    return () => ipcRenderer.removeListener('compass:log', listener);
  },
  onProbeProgress: (cb: (p: { done: number; total: number }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { done: number; total: number }) => cb(p);
    ipcRenderer.on('compass:probe-progress', listener);
    return () => ipcRenderer.removeListener('compass:probe-progress', listener);
  },
};

export type CompassApi = typeof api;

contextBridge.exposeInMainWorld('compass', api);
