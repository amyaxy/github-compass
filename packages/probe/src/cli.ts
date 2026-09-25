import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  TARGET_DOMAINS,
  DNS_SERVERS,
  PROBE_CONCURRENCY,
  crossResolve,
  fetchMetaCidrs,
  makeBelongFilter,
  probeAll,
  buildFiles,
  fingerprint,
} from '@github-compass/core';
import type { CandidatesFile, HostsFile, ProbePair } from '@github-compass/core';

async function main(): Promise<void> {
  const dataDir = path.join(process.cwd(), 'data');

  // ① 多 DNS 交叉解析
  const pairs: ProbePair[] = [];
  for (const { domain } of TARGET_DOMAINS) {
    const ips = await crossResolve(domain, DNS_SERVERS);
    for (const ip of ips) pairs.push({ domain, ip });
  }
  console.log(`[1/4] resolved ${pairs.length} (domain, ip) pairs from ${TARGET_DOMAINS.length} domains`);

  // ② 归属预过滤（meta 官方段 ∪ Fastly 段）
  const metaCidrs = await fetchMetaCidrs();
  const belong = makeBelongFilter(metaCidrs);
  const filtered = pairs.filter((p) => belong(p.ip));
  console.log(`[2/4] belong filter: ${pairs.length} -> ${filtered.length} (meta cidrs: ${metaCidrs.length})`);

  // ③ TLS 终判（SNI + 证书链 + SAN，通过即采信）
  const results = await probeAll(filtered, PROBE_CONCURRENCY);
  const okCount = results.filter((r) => r.ok).length;
  console.log(`[3/4] tls verified: ${okCount}/${results.length}`);
  for (const r of results) {
    console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.domain.padEnd(32)} ${r.ip.padEnd(16)} ${r.ok ? `${r.latencyMs}ms` : r.error}`);
  }

  // ④ 版本与变更判断，写 data/
  const hostsPath = path.join(dataDir, 'hosts.json');
  const candidatesPath = path.join(dataDir, 'candidates.json');
  let version = 1;
  let oldFingerprint = '';
  if (existsSync(hostsPath) && existsSync(candidatesPath)) {
    const oldHosts = JSON.parse(readFileSync(hostsPath, 'utf8')) as HostsFile;
    const oldCandidates = JSON.parse(readFileSync(candidatesPath, 'utf8')) as CandidatesFile;
    version = oldHosts.version + 1;
    oldFingerprint = fingerprint(oldHosts, oldCandidates);
  }

  const { hostsTxt, hostsJson, candidatesJson } = buildFiles(results, version, new Date());
  if (fingerprint(hostsJson, candidatesJson) === oldFingerprint) {
    console.log('[4/4] no change, skip writing (heartbeat.yml keeps the schedule alive)');
    return;
  }

  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, 'hosts.txt'), hostsTxt);
  writeFileSync(hostsPath, JSON.stringify(hostsJson, null, 2) + '\n');
  writeFileSync(candidatesPath, JSON.stringify(candidatesJson, null, 2) + '\n');
  console.log(`[4/4] data files written, version v${version}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
