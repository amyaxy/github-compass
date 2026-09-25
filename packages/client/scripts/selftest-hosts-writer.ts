/**
 * HostsWriter 自测（node + tsx，使用临时 hosts 文件，不动系统配置）。
 * 运行：pnpm -C packages/client selftest
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HostsWriter } from '../src/main/hostsWriter.js';
import type { HostsEntry } from '@github-compass/core';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

const dir = mkdtempSync(path.join(tmpdir(), 'compass-selftest-'));
const hostsPath = path.join(dir, 'hosts');
const backupDir = path.join(dir, 'backups');
const logs: string[] = [];
const writer = new HostsWriter(hostsPath, backupDir, (l) => logs.push(l));

// 模拟用户已有自定义 hosts
writeFileSync(hostsPath, '127.0.0.1 localhost\n# user custom\n1.2.3.4 my.example.com\n');

const entry = (ip: string, domain = 'github.com'): HostsEntry => ({
  domain,
  ip,
  latencyMs: 45,
  tlsVerified: true,
  checkedAt: new Date().toISOString(),
});

// 1) 首次写入 v1：保留用户内容 + 追加标记块
const w1 = await writer.write([entry('20.205.243.166'), entry('20.205.243.168', 'api.github.com')], 1);
const c1 = readFileSync(hostsPath, 'utf8');
assert(c1.includes('1.2.3.4 my.example.com'), '用户原有内容保留');
assert(c1.includes('# GitHubCompass Host Start'), '标记块已追加');
assert(c1.includes('20.205.243.166 github.com'), 'v1 条目写入');

// 2) 二次写入 v2：替换标记块（不重复追加、不动用户内容）
await writer.write([entry('140.82.116.3')], 2);
const c2 = readFileSync(hostsPath, 'utf8');
assert((c2.match(/# GitHubCompass Host Start/g) ?? []).length === 1, '标记块唯一（替换而非追加）');
assert(!c2.includes('20.205.243.166'), '旧 IP 已移除');
assert(c2.includes('140.82.116.3 github.com'), 'v2 新 IP 写入');
assert(c2.includes('1.2.3.4 my.example.com'), '二次写入用户内容仍保留');

// 3) 回滚到 w1 备份：恢复到首次写入前的原始内容（备份语义 = 恢复备份时点）
await writer.rollback(w1.backupPath);
const c3 = readFileSync(hostsPath, 'utf8');
assert(!c3.includes('# GitHubCompass Host Start'), '回滚恢复原始内容（标记块已移除）');
assert(c3.includes('1.2.3.4 my.example.com'), '回滚保留用户自定义内容');

// 4) 本地探测选优端到端（真实网络，用内置兜底池快照）
const { runLocalProbe } = await import('../src/main/proberRunner.js');
const snapshotCandidates = JSON.parse(
  readFileSync(new URL('../resources/candidates.snapshot.json', import.meta.url), 'utf8'),
);
const outcome = await runLocalProbe(snapshotCandidates, () => undefined);
assert(
  outcome.entries.length > 0,
  `本地探测选优：${outcome.entries.length} 个域名通过（failureReason=${outcome.failureReason}）`,
);
assert(outcome.entries.every((e) => e.tlsVerified), '选优条目均 TLS 验证通过');
const gh = outcome.entries.find((e) => e.domain === 'github.com');
assert(!!gh && gh.latencyMs > 0, `github.com 本地实测延迟 ${gh?.latencyMs}ms`);

console.log('--- logs ---');
logs.forEach((l) => console.log(`  ${l}`));
console.log('SELFTEST PASSED');
