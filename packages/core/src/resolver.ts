import { Resolver } from 'node:dns/promises';

/** 用指定 DNS 服务器解析 A 记录（IPv4 only，MVP 范围限定） */
export async function resolveA(domain: string, server: string): Promise<string[]> {
  const resolver = new Resolver();
  resolver.setServers([server]);
  try {
    return await resolver.resolve4(domain);
  } catch {
    return [];
  }
}

/** 多 DNS 交叉解析，合并去重排序 */
export async function crossResolve(domain: string, servers: string[]): Promise<string[]> {
  const results = await Promise.all(servers.map((s) => resolveA(domain, s)));
  return [...new Set(results.flat())].sort();
}
