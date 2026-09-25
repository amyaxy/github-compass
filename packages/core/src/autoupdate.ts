import type { HostsEntry } from './schema.js';
import type { ProbeResult } from './prober.js';
import { selectBest } from './select.js';
import { formatCst } from './time.js';

export interface HostsSwitch {
  domain: string;
  from: string;
  to: string;
  latencyMs: number;
}

export interface UpdateDecision {
  /** none = 无需变更；write = 需要重写标记块 */
  action: 'none' | 'write';
  reason: string;
  /** write 时的全量条目：健康域名保留现 IP（避免无谓跳动），劣化域名换新 IP，无替代的劣化域名保留原 IP（宁挂勿断 DNS） */
  entries: HostsEntry[];
  switched: HostsSwitch[];
  /** 劣化但候选池无可用替代的域名 */
  degraded: string[];
}

/**
 * 闭环自动切换决策（纯函数）：
 * - 当前 IP 健康 → 保留，不折腾
 * - 当前 IP 劣化 → 该域名候选池探测结果中按"稳定性优先"选替代
 * - 劣化且无替代 → 保留原条目，记入 degraded
 * - 存在任一切换 → write
 *
 * @param currentEntries  当前 hosts 标记块解析出的条目
 * @param healthResults   对当前条目的健康探测结果（含复测防抖）
 * @param candidateProbe  劣化域名的候选池探测结果，key = domain
 */
export function decideAutoUpdate(
  currentEntries: HostsEntry[],
  healthResults: ProbeResult[],
  candidateProbe: Map<string, ProbeResult[]>,
): UpdateDecision {
  const empty: UpdateDecision = { action: 'none', reason: '', entries: [], switched: [], degraded: [] };
  if (currentEntries.length === 0) {
    return { ...empty, reason: '当前 hosts 无标记块，请先在应用内完成首次写入' };
  }
  const healthByKey = new Map(healthResults.map((r) => [`${r.domain}|${r.ip}`, r]));
  const checkedAt = formatCst(new Date());
  const entries: HostsEntry[] = [];
  const switched: HostsSwitch[] = [];
  const degraded: string[] = [];
  for (const cur of currentEntries) {
    const h = healthByKey.get(`${cur.domain}|${cur.ip}`);
    if (h?.ok) {
      entries.push(cur);
      continue;
    }
    const pool = (candidateProbe.get(cur.domain) ?? []).filter(
      (r) => r.ok && r.ip !== cur.ip && r.latencyMs !== undefined,
    );
    const best = selectBest(pool)[0];
    // 防抖动护栏：当前 IP 有 ttfb 实测（劣化但活着）而候选质量值（ttfb 优先）不比它快 → 不换
    // （切过去更慢=体验倒退+来回翻烧饼）；完全断流（无 ttfb）时任何候选都算改善
    const worthwhile = best && !(h?.ttfbMs !== undefined && best.latencyMs > h.ttfbMs);
    if (worthwhile) {
      entries.push({
        domain: cur.domain,
        ip: best.ip,
        latencyMs: best.latencyMs as number,
        tlsVerified: true,
        checkedAt,
      });
      switched.push({ domain: cur.domain, from: cur.ip, to: best.ip, latencyMs: best.latencyMs as number });
    } else {
      entries.push(cur);
      degraded.push(cur.domain);
    }
  }
  if (switched.length === 0) {
    const why =
      degraded.length > 0
        ? `${degraded.join('、')} 劣化但候选池无可用替代，保留原 IP`
        : `全部 ${currentEntries.length} 条当前 IP 健康`;
    return { ...empty, reason: why, degraded };
  }
  const reason =
    `切换 ${switched.map((s) => `${s.domain}: ${s.from}→${s.to}`).join('、')}` +
    (degraded.length > 0 ? `；${degraded.join('、')} 无替代保留原 IP` : '');
  return { action: 'write', reason, entries, switched, degraded };
}
