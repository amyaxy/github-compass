/**
 * 应用图标生成（B 方案：渐变方·白罗盘）——全尺寸统一完整字形（主人 2026-09-25 定稿：
 * 细环+针+深色中心点的任务栏观感最佳，托盘/品牌位对齐，不用简化粗环版）：
 *  - icon.ico：16/24/32/48/64/128/256 七帧（Windows 任务栏/快捷方式/资源管理器各取所需）
 *  - tray.png：32px 完整字形
 * 用法：node scripts/gen-icons.mjs
 */
import { _electron } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, '..');
const electronPath = require(path.join(ROOT, 'packages/client/node_modules/electron'));
const RES = path.join(ROOT, 'packages/client/resources');

const grad = (id) => `<defs><linearGradient id="gb${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4c93ff"/><stop offset="1" stop-color="#1b9c82"/></linearGradient></defs>`;
/** 完整字形（≥48px） */
const FULL = (id) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${grad(id)}
<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#gb${id})"/>
<circle cx="32" cy="32" r="19" fill="none" stroke="#fff" stroke-width="3.6"/>
<path d="M41 23 L36.4 35.4 L23 41 L27.6 28.6 Z" fill="#fff"/>
<circle cx="32" cy="32" r="2.8" fill="#0d1117"/></svg>`;

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512].map((px) => ({ px, svg: FULL }));

// 每尺寸独立 gradient id，避免同页多 svg 引用冲突
const cells = SIZES.map((s) => `<div id="s${s.px}" style="width:${s.px}px;height:${s.px}px">${s.svg(s.px)}</div>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:transparent;}div{display:inline-block;line-height:0;}svg{width:100%;height:100%;}
</style></head><body>${cells}</body></html>`;

const htmlPath = path.join(tmpdir(), 'gc-gen-icons.html');
writeFileSync(htmlPath, html, 'utf8');
const userData = path.join(tmpdir(), 'gc-gen-icons-user');
mkdirSync(userData, { recursive: true });

const app = await _electron.launch({
  executablePath: electronPath,
  args: [path.join(ROOT, 'packages/client'), `--user-data-dir=${userData}`, '--no-sandbox'],
  env: {
    ...process.env,
    COMPASS_HOSTS_PATH: path.join(tmpdir(), 'gc-gen-icons-hosts'),
    COMPASS_SKIP_FLUSHDNS: '1',
    COMPASS_E2E_FAKE_PROBE: '1',
  },
});
const win = await app.firstWindow();
await win.goto('file:///' + htmlPath.replace(/\\/g, '/'));
await win.waitForTimeout(300);

mkdirSync(RES, { recursive: true });
const pngs = {};
for (const s of SIZES) {
  const out = path.join(tmpdir(), `gc-icon-${s.px}.png`);
  await win.locator(`#s${s.px}`).screenshot({ path: out, omitBackground: true });
  pngs[s.px] = readFileSync(out);
}
await app.close();

writeFileSync(path.join(RES, 'icon.png'), pngs[512]); // mac icns 需 ≥512；win 也兼容
writeFileSync(path.join(RES, 'tray.png'), pngs[32]);

// 多帧 ICO
const frames = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type=icon
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((px, i) => {
  const e = 6 + 16 * i;
  header[e] = px === 256 ? 0 : px; // width（0=256）
  header[e + 1] = px === 256 ? 0 : px;
  header[e + 2] = 0; // palette
  header[e + 3] = 0; // reserved
  header.writeUInt16LE(1, e + 4); // planes
  header.writeUInt16LE(32, e + 6); // bpp
  header.writeUInt32LE(pngs[px].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += pngs[px].length;
});
writeFileSync(path.join(RES, 'icon.ico'), Buffer.concat([header, ...frames.map((px) => pngs[px])]));

console.log('icons written: icon.png(512, mac 要求) / tray.png(32) / icon.ico(7 frames 16~256) — 全尺寸完整字形');
