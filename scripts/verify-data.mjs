/**
 * 数据契约校验：data/ 三个文件结构、时间戳格式、跨文件一致性。
 * 运行：node scripts/verify-data.mjs
 */
import { readFileSync } from 'node:fs';

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? 'ok' : 'FAIL'}: ${name}`);
  if (!cond) failed++;
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const CST = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;

const hostsTxt = readFileSync('data/hosts.txt', 'utf8');
const hosts = JSON.parse(readFileSync('data/hosts.json', 'utf8'));
const candidates = JSON.parse(readFileSync('data/candidates.json', 'utf8'));

// hosts.txt
check('hosts.txt 含 Start/End 标记块', hostsTxt.includes('# GitHubCompass Host Start') && hostsTxt.includes('# GitHubCompass Host End'));
const updateTime = hostsTxt.match(/# Update time: (.+)/)?.[1] ?? '';
check(`Update time 为东八区格式 (${updateTime})`, CST.test(updateTime));
const txtLines = hostsTxt.split('\n').filter((l) => l && !l.startsWith('#'));
check(`hosts.txt 条目数(${txtLines.length}) = hosts.json entries 数(${hosts.entries.length})`, txtLines.length === hosts.entries.length);
check('hosts.txt 每行均为合法 "ip domain"', txtLines.every((l) => {
  const [ip, domain] = l.trim().split(/\s+/);
  return IPV4.test(ip ?? '') && !!domain;
}));

// hosts.json
check('hosts.json version 为正整数', Number.isInteger(hosts.version) && hosts.version > 0);
check('hosts.json family=v4', hosts.family === 'v4');
check('hosts.json generatedAt 为 UTC ISO', /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(hosts.generatedAt));
check('entries 字段完整(domain/ip/latencyMs/tlsVerified/checkedAt)', hosts.entries.every((e) =>
  e.domain && IPV4.test(e.ip) && typeof e.latencyMs === 'number' && e.tlsVerified === true && e.checkedAt));

// candidates.json
check('candidates.json version 与 hosts.json 一致', candidates.version === hosts.version);
check('candidates.json family=v4', candidates.family === 'v4');
check('groups 结构合法(domain + IPv4 candidates)', candidates.groups.every((g) => g.domain && Array.isArray(g.candidates) && g.candidates.every((ip) => IPV4.test(ip))));

// 跨文件一致性：hosts.json 每个 entry 的 IP 必须在其域名对应的候选池内
const gmap = new Map(candidates.groups.map((g) => [g.domain, g.candidates]));
check('hosts.json entries ⊆ candidates 候选池', hosts.entries.every((e) => gmap.get(e.domain)?.includes(e.ip)));
check('候选池域名数 >= hosts 条目数（允许个别域名全失败）', candidates.groups.length >= hosts.entries.length);

console.log(failed === 0 ? `\nDATA CONTRACT PASSED (v${hosts.version})` : `\nDATA CONTRACT FAILED: ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
