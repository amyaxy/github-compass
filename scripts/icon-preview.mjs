/**
 * 图标预览生成：A 区=应用图标候选（含现版与托盘小尺寸对照），B 区=UI 描边图标全集。
 * 数据直接提取自 Icon.vue 的 ICONS 表，保证预览与产品一致。
 * 用法：node scripts/icon-preview.mjs → shots/icons-preview.png
 */
import { _electron } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, '..');
const electronPath = require(path.join(ROOT, 'packages/client/node_modules/electron'));

/* ---- 从 Icon.vue 提取 ICONS 对象 ---- */
const vueSrc = readFileSync(path.join(ROOT, 'packages/client/src/renderer/src/Icon.vue'), 'utf8');
const start = vueSrc.indexOf('const ICONS: Record<string, Shape[]> = {');
const end = vueSrc.indexOf('\n};', start);
const iconsObj = eval(`(${vueSrc.slice(start + 'const ICONS: Record<string, Shape[]> = '.length, end + 2)})`);

function shapesToSvg(shapes, color, sw = 1.9) {
  const body = shapes
    .map((s) => {
      if (s.t === 'p') return `<path d="${s.d}"/>`;
      if (s.t === 'c') return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`;
      if (s.t === 'r') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx ?? 2}"/>`;
      return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/* ---- 应用图标候选（SVG，viewBox 64） ---- */
const GRAD = `
<defs>
  <linearGradient id="gb" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4c93ff"/><stop offset="1" stop-color="#1b9c82"/>
  </linearGradient>
  <linearGradient id="gd" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#161b22"/><stop offset="1" stop-color="#0b0f16"/>
  </linearGradient>
</defs>`;

const APP_CANDIDATES = [
  {
    name: 'A 现版·像素罗盘',
    note: '当前安装包图标（make-icons.py 生成）',
    svg: `<svg viewBox="0 0 64 64">${GRAD}<circle cx="32" cy="32" r="30" fill="#0d1117"/><circle cx="32" cy="32" r="26" fill="none" stroke="#30363d" stroke-width="5"/><path d="M32 8 L36 32 L28 32 Z" fill="#da3633"/><path d="M32 56 L36 32 L28 32 Z" fill="#3fb950"/><path d="M8 32 L32 28 L32 36 Z" fill="#58a6ff"/><path d="M56 32 L32 28 L32 36 Z" fill="#58a6ff"/><circle cx="32" cy="32" r="4" fill="#e6edf3"/></svg>`,
  },
  {
    name: 'B 渐变方·白罗盘',
    note: '现代应用图标风格，高识别度',
    svg: `<svg viewBox="0 0 64 64">${GRAD}<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#gb)"/><circle cx="32" cy="32" r="19" fill="none" stroke="#fff" stroke-width="3.4"/><path d="M41 23 L36.4 35.4 L23 41 L27.6 28.6 Z" fill="#fff"/><circle cx="32" cy="32" r="2.6" fill="#0d1117"/></svg>`,
  },
  {
    name: 'C 暗底·光环罗盘',
    note: '深色主题一致，蓝绿渐变环',
    svg: `<svg viewBox="0 0 64 64">${GRAD}<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#gd)"/><circle cx="32" cy="32" r="20" fill="none" stroke="url(#gb)" stroke-width="3.6"/><path d="M41.5 22.5 L36.6 35.6 L22.5 41.5 L27.4 28.4 Z" fill="url(#gb)"/><circle cx="32" cy="32" r="2.4" fill="#2dd4bf"/><path d="M32 6v5M32 53v5M6 32h5M53 32h5" stroke="#3d4654" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  },
  {
    name: 'D 盾徽·守护罗盘',
    note: '强调"守护"语义',
    svg: `<svg viewBox="0 0 64 64">${GRAD}<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#gd)"/><path d="M32 7 L52 15 v14 c0 13-8.5 22.5-20 28 C20.5 51.5 12 42 12 29 V15 Z" fill="none" stroke="url(#gb)" stroke-width="3.4" stroke-linejoin="round"/><circle cx="32" cy="29" r="10.5" fill="none" stroke="#e6edf3" stroke-width="2.6"/><path d="M37 24 L34.4 31.4 L27 34 L29.6 26.6 Z" fill="#e6edf3"/></svg>`,
  },
  {
    name: 'E 经纬地球·北针',
    note: '强调 DNS/解析语义',
    svg: `<svg viewBox="0 0 64 64">${GRAD}<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#gd)"/><circle cx="32" cy="32" r="20" fill="none" stroke="url(#gb)" stroke-width="3.2"/><ellipse cx="32" cy="32" rx="9" ry="20" fill="none" stroke="url(#gb)" stroke-width="2.2"/><path d="M12 32h40" stroke="url(#gb)" stroke-width="2.2"/><path d="M32 14 L37 30 L32 27.5 L27 30 Z" fill="#f85149"/><path d="M32 50 L27 34 L32 36.5 L37 34 Z" fill="#e6edf3"/></svg>`,
  },
  {
    name: 'F 极简·双色北针',
    note: '最小元素，小尺寸最清晰',
    svg: `<svg viewBox="0 0 64 64">${GRAD}<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#gb)"/><path d="M32 10 L41 36 L32 31 L23 36 Z" fill="#fff"/><path d="M32 54 L23 28 L32 33 L41 28 Z" fill="rgba(13,17,23,0.55)"/></svg>`,
  },
];

/* ---- 组装 HTML ---- */
const candCards = APP_CANDIDATES.map(
  (c) => `<div class="cand">
    <div class="row"><div class="big">${c.svg}</div><div class="sm">${c.svg}</div><div class="sm2">${c.svg}</div></div>
    <b>${c.name}</b><small>${c.note}</small><small class="sz">128 / 48 / 24 px</small>
  </div>`,
).join('');

const uiCards = Object.entries(iconsObj)
  .map(([name, shapes]) => `<div class="uic">${shapesToSvg(shapes, '#9fb6d4')}<span>${name}</span></div>`)
  .join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{background:#0b0f16;color:#e6edf3;font:14px/1.5 system-ui,'Microsoft YaHei',sans-serif;margin:0;padding:28px 32px;}
  h2{font-size:17px;margin:6px 0 4px;} h2 .tag{color:#4c93ff;font-size:12px;font-weight:400;margin-left:8px;}
  p.sub{color:#8d96a5;font-size:12.5px;margin:0 0 16px;}
  .cands{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:30px;}
  .cand{background:#141a22;border:1px solid #262d38;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:6px;align-items:flex-start;}
  .cand .row{display:flex;align-items:flex-end;gap:14px;width:100%;}
  .cand .big svg{width:128px;height:128px;} .cand .sm svg{width:48px;height:48px;} .cand .sm2 svg{width:24px;height:24px;}
  .cand b{font-size:14px;} .cand small{color:#8d96a5;font-size:12px;} .cand .sz{opacity:.6;font-size:11px;}
  .uis{display:grid;grid-template-columns:repeat(8,1fr);gap:10px;}
  .uic{background:#141a22;border:1px solid #262d38;border-radius:10px;padding:14px 6px 10px;display:flex;flex-direction:column;align-items:center;gap:8px;}
  .uic svg{width:26px;height:26px;} .uic span{font-size:11px;color:#8d96a5;font-family:Consolas,monospace;}
</style></head><body>
  <h2>A · 应用图标候选<span class="tag">含 128/48/24px 三档尺寸对照（24px 模拟托盘）</span></h2>
  <p class="sub">选定后将重新生成 icon.png / icon.ico / tray.png 并替换 UI 品牌位</p>
  <div class="cands">${candCards}</div>
  <h2>B · UI 描边图标全集<span class="tag">Icon.vue · ${Object.keys(iconsObj).length} 个 · 24px 网格 currentColor</span></h2>
  <p class="sub">导航 / 状态 / 操作 / 空态共用；如需替换单个风格请指名</p>
  <div class="uis">${uiCards}</div>
</body></html>`;

const htmlPath = path.join(tmpdir(), 'gc-icon-preview.html');
writeFileSync(htmlPath, html, 'utf8');

// 复用产品入口启动（隔离 env），再把窗口导航到预览页（已验证的可靠启动路径）
const userData = path.join(tmpdir(), 'gc-icon-prev-user');
mkdirSync(userData, { recursive: true });
const app = await _electron.launch({
  executablePath: electronPath,
  args: [path.join(ROOT, 'packages/client'), `--user-data-dir=${userData}`, '--no-sandbox'],
  env: {
    ...process.env,
    COMPASS_HOSTS_PATH: path.join(tmpdir(), 'gc-icon-prev-hosts'),
    COMPASS_SKIP_FLUSHDNS: '1',
    COMPASS_E2E_FAKE_PROBE: '1',
  },
});
const win = await app.firstWindow();
await win.setViewportSize({ width: 1180, height: 1500 });
await win.goto('file:///' + htmlPath.replace(/\\/g, '/'));
await win.waitForTimeout(500);
const shots = path.join(ROOT, 'shots');
mkdirSync(shots, { recursive: true });
await win.screenshot({ path: path.join(shots, 'icons-preview.png'), fullPage: true });
await app.close();
console.log('preview saved →', path.join(shots, 'icons-preview.png'));
