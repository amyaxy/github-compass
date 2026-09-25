import dns from 'node:dns';
import type { ProbeResult, ProbePair } from './prober.js';
import { probeAll } from './prober.js';

/**
 * Runtime 候选池扩容（本地闭环兜底）：
 * 快照候选池可能枯竭（如 github.com 仅 1 个候选且已被区域性网络阻断），
 * 此时本地多源 DNS 解析 + 官方段抽样 → 全量探测，产出新鲜可用 IP。
 * 纯 node 实现，GUI/CLI/数据管道均可复用。
 */

/** 多源公共 DNS（直连 UDP 53）：不同 anycast 出口解析出不同地区 IP，合并去重 */
export const EXPAND_RESOLVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];

/** github.com 官方主服务段 /24 抽样（140.82.112.0/20）+ 亚太任播段 */
export const EXPAND_GITHUB_SNIPPETS = [
  ...Array.from({ length: 8 }, (_, i) => `140.82.${112 + i}.10`),
  '20.205.243.166',
  '20.27.177.113',
  '20.200.245.247',
  '20.26.156.215',
];

function resolveVia(server: string, domain: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve) => {
    const r = new dns.Resolver({ timeout: timeoutMs, tries: 2 });
    r.setServers([server]);
    r.resolve4(domain, (err, addrs) => resolve(err ? [] : addrs));
  });
}

/** 多源 DNS 解析结果（去重），与官方段抽样合并为待测集 */
export async function expandPoolPairs(domain: string, timeoutMs = 4000): Promise<ProbePair[]> {
  const resolved = await Promise.all(EXPAND_RESOLVERS.map((s) => resolveVia(s, domain, timeoutMs)));
  const ips = new Set<string>(resolved.flat());
  if (domain === 'github.com') for (const ip of EXPAND_GITHUB_SNIPPETS) ips.add(ip);
  return [...ips].map((ip) => ({ domain, ip }));
}

/**
 * 扩池：多源 DNS + 段抽样 → probeAll（含波动复测）→ 仅返回通过项（按质量升序）。
 * 与快照候选池互补：结果由调用方持久化（expandedPools）并在下轮劣化时优先复用。
 */
export async function expandPool(
  domain: string,
  concurrency: number,
  timeoutMs: number,
): Promise<ProbeResult[]> {
  const pairs = await expandPoolPairs(domain, timeoutMs);
  if (pairs.length === 0) return [];
  const results = await probeAll(pairs, concurrency, undefined, timeoutMs);
  const ok = results.filter((r) => r.ok && r.latencyMs !== undefined);
  ok.sort((a, b) => (a.ttfbMs ?? a.latencyMs as number) - (b.ttfbMs ?? b.latencyMs as number));
  return ok;
}
