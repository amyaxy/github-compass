import type { HostsEntry } from './schema.js';
import type { ProbeResult } from './prober.js';
import { formatCst } from './time.js';

/** 失败原因码 */
export type FailureReason = 'NO_USABLE_IP' | 'SSL_INSPECTION_SUSPECTED' | null;

/** 本地探测选优：每域名取 TLS 通过项，稳定性优先——首轮直通者先于复测才通过的波动 IP；
 *  同档按传输质量排序：ttfbMs（HTTP 首字节）优先，缺失时退回 TLS 握手 latencyMs */
export function selectBest(results: ProbeResult[], now = new Date()): HostsEntry[] {
  const byDomain = new Map<string, ProbeResult[]>();
  for (const r of results) {
    if (!r.ok || r.latencyMs === undefined) continue;
    const arr = byDomain.get(r.domain) ?? [];
    arr.push(r);
    byDomain.set(r.domain, arr);
  }
  const qualityMs = (r: ProbeResult): number => r.ttfbMs ?? (r.latencyMs as number);
  const checkedAt = formatCst(now);
  const entries: HostsEntry[] = [];
  for (const [domain, rs] of byDomain) {
    const best = rs.reduce((a, b) => {
      const wa = a.passedRetry ? 1 : 0;
      const wb = b.passedRetry ? 1 : 0;
      if (wa !== wb) return wa < wb ? a : b;
      return qualityMs(a) <= qualityMs(b) ? a : b;
    });
    entries.push({
      domain,
      ip: best.ip,
      latencyMs: qualityMs(best),
      tlsVerified: true,
      checkedAt,
    });
  }
  return entries.sort((a, b) => a.domain.localeCompare(b.domain));
}

const CERT_ERROR_RE =
  /certificate|cert_|self[- ]signed|unable to (verify|get local issuer)|issuer|hostname|altnames/i;

/**
 * 全体失败时的原因判定（有部分通过时不判定，可正常写入通过项）：
 * >80% 失败为证书链类错误 → 企业网 SSL 检查（SSL_INSPECTION_SUSPECTED），否则 NO_USABLE_IP。
 */
export function classifyFailure(results: ProbeResult[]): FailureReason {
  if (results.length === 0) return 'NO_USABLE_IP';
  if (results.some((r) => r.ok)) return null;
  const certFails = results.filter((r) => CERT_ERROR_RE.test(r.error ?? '')).length;
  if (certFails / results.length > 0.8) return 'SSL_INSPECTION_SUSPECTED';
  return 'NO_USABLE_IP';
}
