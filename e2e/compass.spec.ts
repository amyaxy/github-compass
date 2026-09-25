/**
 * E2E：Playwright 驱动真实 Electron 应用。
 * 隔离保证：独立 --user-data-dir + COMPASS_HOSTS_PATH 临时文件 + 跳过 flushdns，
 * 绝不触碰真实系统 hosts / 用户配置。
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electronPath = require(path.join(ROOT, 'packages/client/node_modules/electron')) as string;

const FIXTURE_CANDIDATES = {
  version: 1,
  generatedAt: '2026-09-24T09:00:00Z',
  family: 'v4',
  groups: [
    { domain: 'github.com', candidates: ['140.82.121.4', '20.205.243.166'] },
    { domain: 'raw.githubusercontent.com', candidates: ['185.199.110.133', '185.199.108.133'] },
  ],
};

interface AppEnv {
  app: ElectronApplication;
  win: Page;
  hostsPath: string;
  userData: string;
}

async function launchApp(): Promise<AppEnv> {
  const userData = mkdtempSync(path.join(tmpdir(), 'gc-e2e-user-'));
  const localData = mkdtempSync(path.join(tmpdir(), 'gc-e2e-data-'));
  const hostsDir = mkdtempSync(path.join(tmpdir(), 'gc-e2e-hosts-'));
  const hostsPath = path.join(hostsDir, 'hosts');
  writeFileSync(hostsPath, '127.0.0.1 localhost\n1.2.3.4 user.example.com\n');
  writeFileSync(path.join(localData, 'candidates.json'), JSON.stringify(FIXTURE_CANDIDATES));

  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(ROOT, 'packages/client'), `--user-data-dir=${userData}`, '--no-sandbox'],
    env: {
      ...process.env,
      COMPASS_LOCAL_DATA: localData,
      COMPASS_HOSTS_PATH: hostsPath,
      COMPASS_SKIP_FLUSHDNS: '1',
      COMPASS_E2E_FAKE_PROBE: '1',
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('load');
  return { app, win, hostsPath, userData };
}

async function dismissWizard(win: Page): Promise<void> {
  const overlay = win.locator('.wizard');
  if (await overlay.isVisible().catch(() => false)) {
    await overlay.click({ position: { x: 5, y: 5 } }); // 遮罩空白 → close
  }
}

test('首启向导：5 步流转 → 只读导出片段含标记块', async () => {
  const { app, win } = await launchApp();
  await expect(win.locator('.wz-side')).toContainText('首启向导');
  await expect(win.getByText('本工具仅将 GitHub 官方域名指向其官方真实 IP')).toBeVisible();

  await win.getByRole('button', { name: '开始配置' }).click();
  await expect(win.getByText('hosts 路径')).toBeVisible();

  await win.getByRole('button', { name: /下一步：拉取数据/ }).click();
  await expect(win.getByRole('button', { name: /下一步：应用/ })).toBeVisible({ timeout: 90000 });
  await win.getByRole('button', { name: /下一步：应用/ }).click();

  await win.getByRole('button', { name: /只读导出/ }).click();
  const snippet = win.locator('textarea.snippet');
  await expect(snippet).toBeVisible();
  const text = await snippet.inputValue();
  expect(text).toContain('# GitHubCompass Host Start');
  expect(text).toMatch(/# Update time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00/);

  await win.getByRole('button', { name: '进入主界面' }).click();
  await expect(win.getByRole('heading', { name: '仪表盘' })).toBeVisible();
  await app.close();
});

test('路由：侧边菜单各自独立页面', async () => {
  const { app, win } = await launchApp();
  await dismissWizard(win);
  await expect(win.getByRole('heading', { name: '仪表盘' })).toBeVisible();
  for (const name of ['探测详情', '备份回滚', '设置']) {
    await win.getByRole('button', { name }).click();
    await expect(win.getByRole('heading', { name })).toBeVisible();
  }
  await app.close();
});

test('探测选优 → 按所选写入 hosts → diff 回滚 → 设置持久化（全隔离）', async () => {
  const { app, win, hostsPath, userData } = await launchApp();
  await dismissWizard(win);

  // ---- 探测详情：仅本地通过项可选（远程备选不可写入），每域名单选 ----
  await win.getByRole('button', { name: '探测详情' }).click();
  const updateBtn = win.getByRole('button', { name: /按所选更新 hosts/ });
  await expect(updateBtn).toBeVisible({ timeout: 90000 });
  await expect(win.locator('input[type=radio]')).toHaveCount(4);
  // 至少 1 个域名有通过项（网络波动容错：全挂的域名无 checked）
  await expect
    .poll(async () => win.locator('input[type=radio]:checked').count(), { timeout: 30000 })
    .toBeGreaterThanOrEqual(1);

  // 可切换项（存在第二个通过候选时）
  const switchable = win.locator('input[type=radio]:not(:checked):not([disabled])');
  const canSwitch = (await switchable.count()) > 0;

  // ---- 写入：临时 hosts 文件出现标记块，用户内容保留，备份生成 ----
  await updateBtn.click();
  await expect
    .poll(() => readFileSync(hostsPath, 'utf8'), { timeout: 60000 })
    .toContain('# GitHubCompass Host Start');
  const written = readFileSync(hostsPath, 'utf8');
  expect(written).toContain('1.2.3.4 user.example.com');
  const backupsCount = () =>
    readdirSync(path.join(userData, 'backups')).filter((f) => f.endsWith('.bak')).length;
  expect(backupsCount()).toBe(1);

  // ---- 手动重复点击：每次必写（备份递增，不做版本/内容拦截）----
  await updateBtn.click();
  await expect.poll(backupsCount, { timeout: 30000 }).toBe(2);

  // ---- 换选另一通过候选：同样必写 ----
  if (canSwitch) {
    await switchable.first().check();
    await updateBtn.click();
    await expect.poll(backupsCount, { timeout: 30000 }).toBe(3);
  }

  // ---- 备份回滚页：diff 预览 + 二次确认回滚 → hosts 恢复原样（回滚最早备份=无块原始态）----
  await win.getByRole('button', { name: '备份回滚' }).click();
  await win.getByRole('button', { name: '预览 diff' }).last().click();
  await expect(win.getByText('// 备份时内容')).toBeVisible();
  await expect(win.getByText('// 当前 hosts')).toBeVisible();

  await win.getByRole('button', { name: /↺ 回滚/ }).last().click();
  await expect(win.getByRole('button', { name: /再次点击确认/ })).toBeVisible();
  await win.getByRole('button', { name: /再次点击确认/ }).first().click();
  await expect
    .poll(() => readFileSync(hostsPath, 'utf8'), { timeout: 60000 })
    .not.toContain('# GitHubCompass Host Start');

  // ---- 设置持久化：toggle 写入独立 userData 的 config.json ----
  await win.getByRole('button', { name: '设置' }).click();
  await win.locator('.toggle').first().click();
  const configPath = path.join(userData, 'config.json');
  await expect
    .poll(() => (existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')).settings?.autoUpdate : undefined), {
      timeout: 15000,
    })
    .toBe(true);

  await app.close();
});

test('全功能巡检：仪表盘写入 → 重探 → 设置项持久化 → 立即检查 → 窗口控制 → 托盘隐藏', async () => {
  const { app, win, hostsPath, userData } = await launchApp();
  await dismissWizard(win);

  // ---- 仪表盘：探测完成后"立即更新"写入 hosts ----
  await expect(win.locator('.dcard').first()).toBeVisible({ timeout: 90000 });
  await win.getByRole('button', { name: /立即更新/ }).click();
  await expect
    .poll(() => readFileSync(hostsPath, 'utf8'), { timeout: 60000 })
    .toContain('# GitHubCompass Host Start');
  expect(readFileSync(hostsPath, 'utf8')).toContain('1.2.3.4 user.example.com'); // 用户内容保留

  // ---- 探测详情：重新探测 → 按所选写入（备份递增）----
  await win.getByRole('button', { name: '探测详情' }).click();
  await win.getByRole('button', { name: /重新探测/ }).click();
  await expect(win.locator('input[type=radio]')).toHaveCount(4, { timeout: 90000 });
  await win.getByRole('button', { name: /按所选更新 hosts/ }).click();
  const backupsCount = () =>
    readdirSync(path.join(userData, 'backups')).filter((f) => f.endsWith('.bak')).length;
  await expect.poll(backupsCount, { timeout: 30000 }).toBeGreaterThanOrEqual(2);

  // ---- 设置：自动保活开关（FAKE 模式跳过真实注册）、间隔、通道开关 全量持久化 ----
  await win.getByRole('button', { name: '设置' }).click();
  await win.locator('.toggle').first().click(); // autoUpdate on
  await win.locator('select').first().selectOption('5'); // 检查间隔 5 分钟
  const snapshotRow = win.locator('.chan', { hasText: '内置兜底池' });
  await snapshotRow.locator('.toggle').click(); // 关闭 snapshot 通道
  const configPath = path.join(userData, 'config.json');
  await expect
    .poll(
      () => {
        const c = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
        return c?.settings?.autoUpdate === true &&
          c?.settings?.autoUpdateIntervalMin === 5 &&
          Array.isArray(c?.settings?.channelOrder) &&
          !c.settings.channelOrder.includes('snapshot');
      },
      { timeout: 15000 },
    )
    .toBe(true);

  // ---- 立即检查：闭环一轮（FAKE 探测，确定性）→ 日志回流主界面 ----
  await win.getByRole('button', { name: '立即检查' }).click();
  await win.getByRole('button', { name: '仪表盘' }).click();
  await expect(win.locator('.timeline').last()).toContainText('自动检查：', { timeout: 30000 });

  // ---- 窗口控制：最小化→恢复、最大化→还原（CI 的 Linux/Xvfb 无窗口管理器，isMinimized 不可靠，跳过）----
  if (process.platform !== 'linux') {
    const winState = () =>
      app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        return { min: w.isMinimized(), max: w.isMaximized(), visible: w.isVisible() };
      });
    await win.locator('.wbtn').first().click(); // 最小化
    await expect.poll(async () => (await winState()).min, { timeout: 10000 }).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    await win.locator('.wbtn').nth(1).click(); // 最大化
    await expect.poll(async () => (await winState()).max, { timeout: 10000 }).toBe(true);
    await win.locator('.wbtn').nth(1).click(); // 还原
    await expect.poll(async () => (await winState()).max, { timeout: 10000 }).toBe(false);
  } else {
    // Linux CI：仅验证按钮可点击不抛错（行为降级为冒烟）
    await win.locator('.wbtn').first().click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  }

  // ---- 关闭 → 托盘隐藏（minimizeToTray 默认开；hide 不依赖窗口管理器，Linux 可测）----
  await win.locator('.wbtn.close').click();
  await expect
    .poll(
      () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false),
      { timeout: 10000 },
    )
    .toBe(false);

  await app.close();
});
