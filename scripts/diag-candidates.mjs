/**
 * 对 data/candidates.json 里指定域名的候选 IP 做传输质量实测。
 * 用法：node scripts/diag-candidates.mjs github.com [api.github.com ...]
 */
import { readFileSync } from 'node:fs';
import tls from 'node:tls';

const DATA = JSON.parse(readFileSync(new URL('../data/candidates.json', import.meta.url), 'utf8'));
const TEST_PATHS = {
  'github.com': '/robots.txt',
  'api.github.com': '/robots.txt',
  'raw.githubusercontent.com': '/facebook/react/main/README.md',
  'gist.githubusercontent.com': '/facebook/react/main/README.md',
  'codeload.github.com': '/facebook/react/tar.gz/refs/tags/v0.0.1',
  'objects.githubusercontent.com': '/facebook/react/main/README.md',
  'avatars.githubusercontent.com': '/u/69631?s=40&v=4',
  'collector.github.com': '/github/collect',
  'github.githubassets.com': '/favicon.ico',
};

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

const domains = process.argv.slice(2);
for (const domain of domains) {
  const g = DATA.groups.find((x) => x.domain === domain);
  if (!g) { console.log(`${domain}: 数据里无此域名`); continue; }
  console.log(`\n== ${domain} 候选池 ${g.candidates.length} 个 ==`);
  const rows = await Promise.all(g.candidates.map((ip) => measure(domain, ip, TEST_PATHS[domain] ?? '/')));
  rows.sort((a, b) => (b.kbps || 0) - (a.kbps || 0));
  for (const r of rows) {
    const pad = (v, w = 7) => String(v ?? '—').padStart(w);
    console.log(
      `  ${r.ip.padEnd(16)} ${r.ok ? 'ok ' : 'FAIL'} tls=${pad(r.tlsMs)}ms ttfb=${pad(r.ttfbMs)}ms total=${pad(r.totalMs)}ms 速率=${pad(r.kbps)}KB/s ${r.why}`,
    );
  }
  const alive = rows.filter((r) => r.ok && r.ttfbMs !== null);
  if (alive.length) {
    const best = alive[0];
    console.log(`  → 传输最快: ${best.ip} (${best.kbps}KB/s, ttfb ${best.ttfbMs}ms)`);
  } else {
    console.log('  → 候选池全军覆没');
  }
}
