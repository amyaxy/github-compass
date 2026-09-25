/**
 * UI 截图自检（隔离 userData/hosts + fakeProbe 确定性数据，不碰系统）：
 * node scripts/ui-shots.mjs → shots/*.png
 */
import { _electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, '..');
const electronPath = require(path.join(ROOT, 'packages/client/node_modules/electron'));

const FIXTURE = {
  version: 1,
  generatedAt: '2026-09-25T08:00:00Z',
  family: 'v4',
  groups: [
    { domain: 'github.com', candidates: ['140.82.121.4', '20.205.243.166'] },
    { domain: 'api.github.com', candidates: ['20.205.243.168', '140.82.121.9'] },
    { domain: 'raw.githubusercontent.com', candidates: ['185.199.110.133', '185.199.108.133'] },
    { domain: 'codeload.github.com', candidates: ['140.82.121.10'] },
  ],
};

const userData = mkdtempSync(path.join(tmpdir(), 'gc-ui-user-'));
const localData = mkdtempSync(path.join(tmpdir(), 'gc-ui-data-'));
const hostsDir = mkdtempSync(path.join(tmpdir(), 'gc-ui-hosts-'));
const hostsPath = path.join(hostsDir, 'hosts');
writeFileSync(hostsPath, '127.0.0.1 localhost\n');
writeFileSync(path.join(localData, 'candidates.json'), JSON.stringify(FIXTURE));

const shots = path.join(ROOT, 'shots');
mkdirSync(shots, { recursive: true });

const app = await _electron.launch({
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
await win.waitForSelector('.wizard');
await win.screenshot({ path: path.join(shots, '1-wizard.png') });

// 关向导 → 仪表盘（等探测出卡片）
await win.locator('.wizard').click({ position: { x: 5, y: 5 } });
await win.waitForSelector('.dcard', { timeout: 90000 });
await win.waitForTimeout(600);
await win.screenshot({ path: path.join(shots, '2-dash.png') });

await win.getByRole('button', { name: '探测详情' }).click();
await win.waitForSelector('table', { timeout: 30000 });
await win.waitForTimeout(400);
await win.screenshot({ path: path.join(shots, '3-probe.png') });

await win.getByRole('button', { name: '备份回滚' }).click();
await win.waitForTimeout(400);
await win.screenshot({ path: path.join(shots, '4-backup.png') });

await win.getByRole('button', { name: '设置' }).click();
await win.waitForTimeout(400);
await win.screenshot({ path: path.join(shots, '5-settings.png') });

await app.close();
console.log('shots saved →', shots);
