import { probeAll, selectBest, classifyFailure, PROBE_CONCURRENCY, PROBE_TIMEOUT_MS } from '@github-compass/core';
import type { CandidatesFile, FailureReason, HostsEntry, ProbeResult } from '@github-compass/core';

export interface ProbeProgress {
  done: number;
  total: number;
  result: ProbeResult;
}

export interface ProbeOpts {
  concurrency?: number;
  timeoutMs?: number;
}

export interface ProbeOutcome {
  /** 本地选优后的最优集（域名→最低延迟且 TLS 通过的 IP） */
  entries: HostsEntry[];
  /** 全部探测明细（供"探测详情"视图展示） */
  results: ProbeResult[];
  /** 全体失败时的原因码；有通过项时为 null */
  failureReason: FailureReason;
}

/** E2E 假探测（COMPASS_E2E_FAKE_PROBE=1）：全候选通过、延迟递增，测试确定化不依赖网络 */
export function fakeProbe(candidates: CandidatesFile): ProbeOutcome {
  const results: ProbeResult[] = candidates.groups.flatMap((g) =>
    g.candidates.map((ip, i) => ({ domain: g.domain, ip, ok: true, latencyMs: 100 + i * 50 })),
  );
  return { entries: selectBest(results), results, failureReason: null };
}

/** 本地探测选优（国内实测，解决"海外探测 ≠ 国内可达"） */
export async function runLocalProbe(
  candidates: CandidatesFile,
  onProgress: (p: ProbeProgress) => void,
  opts: ProbeOpts = {},
): Promise<ProbeOutcome> {
  const pairs = candidates.groups.flatMap((g) => g.candidates.map((ip) => ({ domain: g.domain, ip })));
  const results = await probeAll(
    pairs,
    opts.concurrency ?? PROBE_CONCURRENCY,
    (r, done, total) => onProgress({ done, total, result: r }),
    opts.timeoutMs ?? PROBE_TIMEOUT_MS,
  );
  const entries = selectBest(results);
  const failureReason = entries.length === 0 ? classifyFailure(results) : null;
  return { entries, results, failureReason };
}
