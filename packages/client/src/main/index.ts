import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc.js';
import type { ConfigStore } from './config.js';

let tray: Tray | null = null;
let quitting = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: 'GitHubCompass',
    backgroundColor: '#0d1117',
    frame: false,
    icon: path.join(import.meta.dirname, '../../resources/icon.png'), // 任务栏/窗口图标（打包后由 exe 图标接管）
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  }
  return win;
}

/** 托盘常驻：关闭窗口 → 隐藏到托盘（minimizeToTray 开启时），退出走托盘菜单 */
function createTray(win: BrowserWindow, store: ConfigStore): void {
  const icon = nativeImage.createFromPath(path.join(import.meta.dirname, '../../resources/tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('GitHubCompass — GitHub hosts 守护中');
  const show = (): void => {
    win.show();
    win.focus();
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 GitHubCompass', click: show },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', show);
  // 用户点 X → 隐藏而非退出；app.quit()（含托盘退出/E2E 收尾）先触发 before-quit 置 quitting，不会误拦
  win.on('close', (e) => {
    if (!quitting && !win.isVisible()) return;
    if (!quitting && store.getSettings().minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  app.on('before-quit', () => {
    quitting = true;
  });
}

// 计划任务无窗口入口：--compass-cli 跑一轮自动更新即退出（不创建窗口/不注册 IPC）
if (process.argv.includes('--compass-cli')) {
  app.disableHardwareAcceleration(); // 无窗口 CLI 无需 GPU，同时消除 GPU cache 抢锁噪音（多实例并发写 log 时）
  app.commandLine.appendSwitch('disable-http-cache'); // CLI 无页面请求，避免与 GUI 实例抢 net cache 锁
  import('./cli.js').then((m) => m.runCliUpdate());
} else {
  app.whenReady().then(() => {
    const store = registerIpc();
    const win = createWindow();
    app.setLoginItemSettings({ openAtLogin: store.getSettings().launchAtLogin });
    createTray(win, store);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const w = createWindow();
        createTray(w, store);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
