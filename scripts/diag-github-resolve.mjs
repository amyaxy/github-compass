/**
 * 应急扩池：多源 DNS 解析 github.com + 官方 IP 段抽样，全量 HTTP 传输实测。
 * 用法：node scripts/diag-github-resolve.mjs
 */
import dns from 'node:dns';
import tls from 'node:tls';

const RESOLVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];
const SNIPPETS = [
  // 140.82.112.0/20 每 /24 抽 .10
  ...Array.from({ length: 8 }, (_, i) => `140.82.${112 + i}.10`),
  '20.205.243.166', // 新加坡
  '20.27.177.113', '20.200.245.247', '20.26.156.215', // 亚太其他
];

function resolveVia(server, name) {
  return new Promise((resolve) => {
    const r = new dns.Resolver({ timeout: 4000, tries: 2 });
    r.setServers([server]);
    r.resolve4(name, (err, addrs) => resolve(err ? [] : addrs));
  });
}

function measure(ip, path = '/robots.txt', budgetMs = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let tlsDoneAt = null, ttfb = null, bytes = 0;
    const finish = (ok, why) => {
      const total = Date.now() - t0;
      resolve({
        ip, ok, why: why ?? '',
        tlsMs: tlsDoneAt ? tlsDoneAt - t0 : null,
        ttfbMs: ttfb ? ttfb - t0 : null,
        totalMs: total,
        kbps: ok && ttfb && bytes > 0 ? Math.round(bytes / 1024 / Math.max(total - (ttfb - t0), 1) * 1000) : 0,
      });
    };
    const sock = tls.connect(
      { host: ip, servername: 'github.com', port: 443, rejectUnauthorized: true, timeout: budgetMs },
      () => { tlsDoneAt = Date.now(); sock.write(`GET ${path} HTTP/1.1\r\nHost: github.com\r\nUser-Agent: GitHubCompass-diag\r\nAccept: */*\r\nConnection: close\r\n\r\n`); },
    );
    sock.setEncoding('latin1');
    sock.on('data', (d) => { if (ttfb === null) ttfb = Date.now(); bytes += d.length; });
    sock.on('end', () => finish(true));
    sock.on('error', (e) => finish(false, e.message));
    sock.on('timeout', () => { sock.destroy(); finish(false, 'timeout'); });
    setTimeout(() => { if (!sock.destroyed) { sock.destroy(); finish(false, 'budget'); } }, budgetMs);
  });
}

const dnsResults = await Promise.all(RESOLVERS.map((s) => resolveVia(s, 'github.com')));
const dnsIps = [...new Set(dnsResults.flat())];
console.log(`多源 DNS 解析 github.com: ${dnsIps.join(', ') || '全部失败'}`);
const candidates = [...new Set([...dnsIps, ...SNIPPETS])];
console.log(`待测 ${candidates.length} 个 IP（DNS ${dnsIps.length} + 段抽样 ${SNIPPETS.length}）…\n`);

const rows = await Promise.all(candidates.map((ip) => measure(ip)));
rows.sort((a, b) => (b.kbps || 0) - (a.kbps || 0));
for (const r of rows) {
  const pad = (v, w = 7) => String(v ?? '—').padStart(w);
  console.log(`  ${r.ip.padEnd(16)} ${r.ok ? 'ok ' : 'FAIL'} tls=${pad(r.tlsMs)}ms ttfb=${pad(r.ttfbMs)}ms total=${pad(r.totalMs)}ms 速率=${pad(r.kbps)}KB/s ${r.why}`);
}
const alive = rows.filter((r) => r.ok && r.ttfbMs !== null);
console.log(`\n存活 ${alive.length}/${rows.length}；传输最快: ${alive.slice(0, 5).map((r) => `${r.ip}(${r.kbps}KB/s)`).join(' ') || '无'}`);
