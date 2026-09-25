/**
 * 传输质量诊断：对 hosts 里的域名 IP 实测三层指标——
 *   tlsMs    = TCP+TLS 握手耗时（现有探测唯一看的指标）
 *   ttfbMs   = HTTP GET 首字节（服务端响应）
 *   kbps     = 下载吞吐（KB/s，传输质量的关键指标）
 * 用途：验证"握手快 ≠ 传输快"，为选优指标升级提供数据。
 * 用法：node scripts/diag-transport.mjs
 */
import { readFileSync } from 'node:fs';
import tls from 'node:tls';

const HOSTS = process.env.SystemRoot + '\\System32\\drivers\\etc\\hosts';

function readBlock() {
  const content = readFileSync(HOSTS, 'utf8');
  const m = content.match(/# GitHubCompass Host Start[\s\S]*?# GitHubCompass Host End/);
  if (!m) return [];
  const out = [];
  for (const line of m[0].split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [ip, domain] = t.split(/\s+/);
    if (ip && domain) out.push({ domain, ip });
  }
  return out;
}

/** 对 (domain, ip) 做 TLS + GET path 全链路测量 */
function measure(domain, ip, path, budgetMs = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let tlsDoneAt = null, ttfb = null, bytes = 0;
    const finish = (ok, why) => {
      const total = Date.now() - t0;
      resolve({
        domain, ip, ok, why: why ?? '',
        tlsMs: tlsDoneAt ? tlsDoneAt - t0 : null,
        ttfbMs: ttfb ? ttfb - t0 : null,
        totalMs: total,
        kbps: ok && ttfb && bytes > 0 ? Math.round(bytes / 1024 / Math.max(total - (ttfb - t0), 1) * 1000) : 0,
        bytes,
      });
    };
    const sock = tls.connect(
      { host: ip, servername: domain, port: 443, rejectUnauthorized: true, timeout: budgetMs },
      () => { tlsDoneAt = Date.now(); sock.write(`GET ${path} HTTP/1.1\r\nHost: ${domain}\r\nUser-Agent: GitHubCompass-diag\r\nAccept: */*\r\nConnection: close\r\n\r\n`); },
    );
    sock.setEncoding('latin1');
    sock.on('data', (d) => { if (ttfb === null) ttfb = Date.now(); bytes += d.length; });
    sock.on('end', () => finish(true));
    sock.on('error', (e) => finish(false, e.message));
    sock.on('timeout', () => { sock.destroy(); finish(false, 'timeout'); });
    setTimeout(() => { if (!sock.destroyed) { sock.destroy(); finish(false, 'budget'); } }, budgetMs);
  });
}

const TEST_PATHS = {
  'github.com': '/robots.txt',
  'api.github.com': '/robots.txt',
  'raw.githubusercontent.com': '/facebook/react/main/README.md',
  'gist.githubusercontent.com': '/facebook/react/main/README.md',
  'codeload.github.com': '/facebook/react/tar.gz/refs/tags/v0.0.1', // 大点，测吞吐
  'objects.githubusercontent.com': '/facebook/react/main/README.md',
  'avatars.githubusercontent.com': '/u/69631?s=40&v=4',
  'collector.github.com': '/github/collect',
  'github.githubassets.com': '/favicon.ico',
};

const block = readBlock();
console.log(`hosts 标记块 ${block.length} 条，开始测量（每条最多 8s）…\n`);
const rows = [];
for (const { domain, ip } of block) {
  const path = TEST_PATHS[domain] ?? '/';
  const r = await measure(domain, ip, path);
  rows.push(r);
  const pad = (v, w = 7) => String(v ?? '—').padStart(w);
  console.log(
    `${pad(domain, 30)} ${pad(ip, 16)} ${r.ok ? 'ok ' : 'FAIL'} tls=${pad(r.tlsMs)}ms ttfb=${pad(r.ttfbMs)}ms total=${pad(r.totalMs)}ms 速率=${pad(r.kbps)}KB/s ${r.why}`,
  );
}

// 与"现有探测的结论"对照：哪些 IP 握手最快（旧指标会选谁）
const withTls = rows.filter((r) => r.ok && r.tlsMs !== null);
if (withTls.length) {
  const bestByOld = [...withTls].sort((a, b) => a.tlsMs - b.tlsMs)[0];
  const bestByNew = [...withTls].sort((a, b) => (b.kbps || 0) - (a.kbps || 0))[0];
  console.log(`\n旧指标（握手最快会选）: ${bestByOld.ip} ${bestByOld.tlsMs}ms / 速率 ${bestByOld.kbps}KB/s`);
  console.log(`新指标（传输最快应选）: ${bestByNew.ip} 速率 ${bestByNew.kbps}KB/s / 握手 ${bestByNew.tlsMs}ms`);
}
