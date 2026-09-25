import type { HostsEntry, ProbePair, ProbeResult } from '@github-compass/core';
import {
  decideAutoUpdate,
  expandPool,
  probeAll,
  probeHttp,
  selectBest,
  TARGET_DOMAINS,
  PROBE_CONCURRENCY,
  PROBE_RETRIES,
  PROBE_RETRY_DELAY_MS,
  PROBE_TIMEOUT_MS,
} from '@github-compass/core';
import { formatCst } from '@github-compass/core';
import type { ConfigStore } from './config.js';
import { fetchCandidatesJson } from './fetcher.js';
import { HostsWriter, readMarkedBlock } from './hostsWriter.js';

export interface UpdateCycleResult {
  action: 'none' | 'write' | 'error';
  reason: string;
  switched?: Array<{ domain: string; from: string; to: string }>;
  version?: number;
}

export interface UpdaterDeps {
  store: ConfigStore;
  writer: HostsWriter;
  log: (line: string) => void;
  /** 测试注入假探测（E2E）；默认真实 probeAll */
  probeAllImpl?: typeof probeAll;
  /** 测试注入；默认真实 probeHttp（HTTP 质量轮：淘汰"握手通但不回 HTTP"的 IP） */
  probeHttpImpl?: typeof probeHttp;
  /** 测试注入；默认真实 expandPool（候选池枯竭时的本地扩池兜底） */
  expandPoolImpl?: typeof expandPool;
  /** 手动触发（GUI"立即检查"）跳过劣化冷却，总是全量执行 */
  force?: boolean;
}

const EXPANDED_POOL_LIMIT = 12;
/** 劣化冷却：候选池无替代后的全量重探最小间隔（限速时段每 5 分钟重探 13+ IP 纯空转） */
const DEGRADED_COOLDOWN_MS = 15 * 60 * 1000;

/** E2E 假探测（COMPASS_E2E_FAKE_PROBE=1）：闭环全链路确定性，不依赖真实网络 */
const fakeProbeAll = async (pairs: ProbePair[]): Promise<ProbeResult[]> =>
  pairs.map((p, i) => ({ ...p, ok: true, latencyMs: 100 + i * 10 }));
const fakeProbeHttp = async (domain: string, ip: string): Promise<ProbeResult> => ({
  domain,
  ip,
  ok: true,
  latencyMs: 60,
  ttfbMs: 60,
});
const fakeExpandPool = async (): Promise<ProbeResult[]> => [];
/** 传输慢阈值：TLS/HTTP 都通但 ttfb 超此值 → 半死 IP（区域性网络限速典型态），按劣化触发重探换优
 *  （护栏在 decideAutoUpdate：候选不比现 IP 快则不换） */
const SLOW_TTFB_MS = 1500;

/** HTTP 质量轮：对 TLS 通过项补测 HTTP GET，ttfb 记入结果；HTTP 无响应者降为不通过 */
async function addHttpQuality(
  results: ProbeResult[],
  probeHttpImpl: typeof probeHttp,
  timeoutMs: number,
): Promise<ProbeResult[]> {
  const okOnes = results.filter((r) => r.ok);
  if (okOnes.length === 0) return results;
  const httpResults = await Promise.all(okOnes.map((r) => probeHttpImpl(r.domain, r.ip, timeoutMs)));
  const byKey = new Map(httpResults.map((r) => [`${r.domain}|${r.ip}`, r] as const));
  return results.map((r) => {
    const h = byKey.get(`${r.domain}|${r.ip}`);
    if (!h) return r;
    return h.ok ? { ...r, ok: true, ttfbMs: h.ttfbMs } : { ...r, ok: false, error: h.error ?? 'http-probe-failed' };
  });
}

/**
 * 闭环自动更新一轮：健康检查当前 hosts 条目（TLS + HTTP 质量）→ 劣化域名重探候选池
 * （池枯竭时先查 expandedPools 缓存、再本地扩池兜底）→ 决策切换 → 写入。
 * GUI"立即检查"与计划任务 CLI（--compass-cli）共用。
 */
export async function runUpdateCycle(deps: UpdaterDeps): Promise<UpdateCycleResult> {
  const { store, writer, log } = deps;
  const FAKE = process.env.COMPASS_E2E_FAKE_PROBE === '1';
  const doProbe = deps.probeAllImpl ?? (FAKE ? fakeProbeAll : probeAll);
  const doProbeHttp = deps.probeHttpImpl ?? (FAKE ? fakeProbeHttp : probeHttp);
  const doExpandPool = deps.expandPoolImpl ?? (FAKE ? fakeExpandPool : expandPool);
  try {
    const settings = store.getSettings();
    const timeoutMs = settings.probeTimeoutMs || PROBE_TIMEOUT_MS;
    const concurrency = settings.probeConcurrency || PROBE_CONCURRENCY;

    // 1. 当前标记块（未写过 hosts 时无从守护）
    const current = await readMarkedBlock();
    if (current.length === 0) {
      return { action: 'none', reason: 'hosts 无标记块（尚未写入），跳过' };
    }

    // 2. 健康检查当前条目（probeAll 自带失败复测防抖动误切；HTTP 轮淘汰传输层劣化）
    log(`[auto] 健康检查 ${current.length} 条…`);
    let health = await doProbe(
      current.map(({ domain, ip }) => ({ domain, ip }) as ProbePair),
      concurrency,
      undefined,
      timeoutMs,
      PROBE_RETRIES,
      PROBE_RETRY_DELAY_MS,
    );
    health = await addHttpQuality(health, doProbeHttp, timeoutMs);
    // 慢而半死的 IP（可达但 ttfb 超阈，区域性网络限速典型态）按劣化处理触发重探换优；
    // ttfbMs 保留在结果里供 decideAutoUpdate 护栏比对（候选不更快则不换）
    const judged = health.map((r) =>
      r.ok && r.ttfbMs !== undefined && r.ttfbMs > SLOW_TTFB_MS
        ? { ...r, ok: false, error: `传输慢(ttfb ${r.ttfbMs}ms)` }
        : r,
    );
    const unhealthy = judged.filter((r) => !r.ok);
    // 守护域缺失自检：标记块丢了守护集里的域名（如 GUI 手动更新时该域名无通过候选被整条写出块）→ 需自愈
    const missingDomains = TARGET_DOMAINS.map((t) => t.domain).filter(
      (d) => !current.some((e) => e.domain === d),
    );
    if (unhealthy.length === 0 && missingDomains.length === 0) {
      return { action: 'none', reason: `全部 ${current.length} 条当前 IP 健康` };
    }
    if (unhealthy.length > 0) {
      log(
        `[auto] 劣化 ${unhealthy.length} 条：${unhealthy
          .map((r) => `${r.domain}(${r.ip}) ${r.error ?? ''}`.trim())
          .join('、')}`,
      );
    }

    // 3. 拉候选池（健康且无缺失时连拉取都省掉）；冷却期仅拦"劣化无替代"重探——
    //    缺失域若在 cfg 中有候选来源（扩池缓存/lastGood）则可即时自愈，不受冷却；手动 force 全量不受限
    const cfg = store.get();
    const healableMissing = missingDomains.filter(
      (d) => (cfg.expandedPools[d]?.length ?? 0) > 0 || Boolean(cfg.lastGoodIps[d]),
    );
    const sinceDegraded = cfg.lastDegradedAt ? Date.now() - Date.parse(cfg.lastDegradedAt) : Infinity;
    if (!deps.force && healableMissing.length === 0 && sinceDegraded < DEGRADED_COOLDOWN_MS) {
      const left = Math.ceil((DEGRADED_COOLDOWN_MS - sinceDegraded) / 60000);
      return {
        action: 'none',
        reason: `候选池暂无替代（劣化冷却中，约 ${left} 分钟后重探；手动"立即检查"不受限），保留原 IP`,
      };
    }
    const { data } = await fetchCandidatesJson(
      log,
      cfg.lastGoodIps['raw.githubusercontent.com'],
      cfg.settings.channelOrder,
    );

    // 4. 劣化域名候选池探测（排除当前 IP；数据里没有的域名进入 4.5 扩池兜底）
    const degradedDomains = [...new Set(unhealthy.map((r) => r.domain))];
    const pairs: ProbePair[] = [];
    for (const d of degradedDomains) {
      const g = data.groups.find((x) => x.domain === d);
      if (!g) continue;
      const curIp = current.find((e) => e.domain === d)?.ip;
      for (const ip of g.candidates) {
        if (ip !== curIp) pairs.push({ domain: d, ip });
      }
    }
    log(`[auto] 重探候选池：${degradedDomains.join('、')} 共 ${pairs.length} 个候选…`);
    let candidateResults: ProbeResult[] = pairs.length
      ? await doProbe(pairs, concurrency, undefined, timeoutMs, PROBE_RETRIES, PROBE_RETRY_DELAY_MS)
      : [];

    // 4.5 候选池枯竭兜底：TLS 全灭/无候选 → expandedPools 缓存 → 本地扩池（DNS 多源 + 官方段抽样）
    const mergedExpanded: Record<string, string[]> = { ...cfg.expandedPools };
    const byDomain = new Map<string, ProbeResult[]>();
    for (const r of candidateResults) {
      const arr = byDomain.get(r.domain) ?? [];
      arr.push(r);
      byDomain.set(r.domain, arr);
    }
    for (const d of degradedDomains) {
      const curIp = current.find((e) => e.domain === d)?.ip;
      let rs = (byDomain.get(d) ?? []).filter((r) => r.ip !== curIp);
      const exhausted = !rs.some((r) => r.ok);
      if (exhausted) {
        const cached = cfg.expandedPools[d] ?? [];
        let expandPairs: ProbePair[] = cached.map((ip) => ({ domain: d, ip }));
        let source = '扩池缓存';
        if (expandPairs.length === 0) {
          expandPairs = await doExpandPool(d, concurrency, timeoutMs).then((ok) =>
            ok.map((r) => ({ domain: d, ip: r.ip }) as ProbePair),
          );
          source = '本地扩池';
        }
        if (expandPairs.length === 0) {
          log(`[auto] ${d} 候选池枯竭，${source}也无候选，保留原 IP`);
          continue;
        }
        log(`[auto] ${d} 候选池枯竭，${source}重探 ${expandPairs.length} 个 IP…`);
        let exRes = await doProbe(expandPairs, concurrency, undefined, timeoutMs, PROBE_RETRIES, PROBE_RETRY_DELAY_MS);
        exRes = await addHttpQuality(exRes, doProbeHttp, timeoutMs);
        rs = exRes.filter((r) => r.ip !== curIp);
        const okIps = rs.filter((r) => r.ok).map((r) => r.ip);
        if (okIps.length > 0) {
          mergedExpanded[d] = okIps.slice(0, EXPANDED_POOL_LIMIT);
          byDomain.set(d, [...(byDomain.get(d) ?? []), ...rs]);
          log(`[auto] ${d} ${source}补充 ${okIps.length} 个可用 IP`);
        } else {
          log(`[auto] ${d} ${source}重探仍无可用 IP，保留原 IP`);
          continue;
        }
      } else {
        // 候选池有通过项：补 HTTP 质量轮供选优
        const quality = await addHttpQuality(rs, doProbeHttp, timeoutMs);
        byDomain.set(d, [...(byDomain.get(d) ?? []).filter((r) => r.ip === curIp), ...quality]);
      }
    }
    candidateResults = [...byDomain.values()].flat();
    store.update({ expandedPools: mergedExpanded });

    // 4.6 守护域缺失自愈：候选来源 expandedPools ∪ 数据候选 ∪ lastGoodIps，探通者补回块
    const healed: HostsEntry[] = [];
    if (missingDomains.length > 0) {
      log(`[auto] 守护块缺失 ${missingDomains.length} 个域名：${missingDomains.join('、')}，探候选恢复…`);
      for (const d of missingDomains) {
        const ips = new Set<string>();
        for (const ip of cfg.expandedPools[d] ?? []) ips.add(ip);
        const g = data.groups.find((x) => x.domain === d);
        if (g) for (const ip of g.candidates) ips.add(ip);
        const lg = cfg.lastGoodIps[d];
        if (lg) ips.add(lg);
        if (ips.size === 0) {
          log(`[auto] ${d} 缺失且无任何候选 IP 可试（扩池/数据/lastGood 均空）`);
          continue;
        }
        let hr = await doProbe(
          [...ips].map((ip) => ({ domain: d, ip }) as ProbePair),
          concurrency,
          undefined,
          timeoutMs,
          PROBE_RETRIES,
          PROBE_RETRY_DELAY_MS,
        );
        hr = await addHttpQuality(hr, doProbeHttp, timeoutMs);
        const best = selectBest(hr);
        if (best.length > 0) {
          healed.push(...best);
          log(`[auto] ${d} 恢复 → ${best[0].ip}（${best[0].latencyMs}ms）`);
        } else {
          log(`[auto] ${d} 候选全部探测失败，本轮放弃恢复（下轮重试）`);
        }
      }
    }

    // 5. 决策 + 写入（切换决策 ∪ 自愈补回条目）
    const decision = decideAutoUpdate(current, judged, byDomain);
    log(`[auto] 决策：${decision.action} —— ${decision.reason}`);
    const finalEntries: HostsEntry[] = decision.action === 'write' ? [...decision.entries] : [...current];
    for (const h of healed) {
      if (!finalEntries.some((e) => e.domain === h.domain)) finalEntries.push(h);
    }
    const changed = decision.action === 'write' || finalEntries.length > current.length;
    if (!changed) {
      if (decision.degraded.length > 0) {
        store.update({ lastDegradedAt: formatCst(new Date()) }); // 启动冷却
      }
      return { action: 'none', reason: decision.reason, version: data.version };
    }
    store.update({ lastDegradedAt: null }); // 有实际修复动作，恢复正常节奏
    if (await writer.sameAsCurrent(finalEntries)) {
      log('[auto] 决策条目与当前 hosts 一致，跳过写入');
      return { action: 'none', reason: '内容一致', version: data.version };
    }
    const { backupId, backupPath } = await writer.write(finalEntries, data.version);
    store.addBackup({
      id: backupId,
      path: backupPath,
      createdAt: formatCst(new Date()),
      trigger: 'update',
      version: data.version,
    });
    const mergedIps = { ...cfg.lastGoodIps };
    for (const e of finalEntries) mergedIps[e.domain] = e.ip;
    store.update({
      appliedVersion: data.version,
      appliedAt: formatCst(new Date()),
      lastGoodIps: mergedIps,
    });
    log(`[auto] 已切换写入 ${finalEntries.length} 条（v${data.version}）`);
    return {
      action: 'write',
      reason:
        decision.reason +
        (healed.length > 0 ? `；恢复缺失域名 ${healed.map((h) => `${h.domain}→${h.ip}`).join('、')}` : ''),
      switched: decision.switched.map(({ domain, from, to }) => ({ domain, from, to })),
      version: data.version,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[auto] 出错：${msg}`);
    return { action: 'error', reason: msg };
  }
}
