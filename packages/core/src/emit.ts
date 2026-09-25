import type { CandidatesFile, HostsEntry, HostsFile } from './schema.js';
import type { ProbeResult } from './prober.js';
import { formatCst } from './time.js';

export interface EmitResult {
  hostsTxt: string;
  hostsJson: HostsFile;
  candidatesJson: CandidatesFile;
}

/** 由探测结果生成三个数据文件内容（每域名最优 1 条入 hosts，全部通过项入候选池） */
export function buildFiles(results: ProbeResult[], version: number, now: Date): EmitResult {
  const checkedAt = formatCst(now);
  const ok = results.filter((r) => r.ok && r.latencyMs !== undefined);
  const domains = [...new Set(results.map((r) => r.domain))].sort();

  const entries: HostsEntry[] = [];
  const groups = domains.map((domain) => {
    const passed = ok
      .filter((r) => r.domain === domain)
      .sort((a, b) => (a.latencyMs as number) - (b.latencyMs as number));
    if (passed.length > 0) {
      const best = passed[0];
      entries.push({
        domain,
        ip: best.ip,
        latencyMs: best.latencyMs as number,
        tlsVerified: true,
        checkedAt,
      });
    }
    return { domain, candidates: passed.map((r) => r.ip) };
  });
  entries.sort((a, b) => a.domain.localeCompare(b.domain));

  const hostsJson: HostsFile = {
    version,
    generatedAt: checkedAt,
    probeSource: 'github-actions',
    family: 'v4',
    entries,
  };
  const candidatesJson: CandidatesFile = { version, generatedAt: checkedAt, family: 'v4', groups };

  const lines = [
    '# GitHubCompass Host Start',
    `# Update time: ${formatCst(now)}`,
    `# Version: v${version}`,
    '# Star me: https://github.com/amyaxy/github-compass',
    ...entries.map((e) => `${e.ip} ${e.domain}`),
    '# GitHubCompass Host End',
    '',
  ];
  return { hostsTxt: lines.join('\n'), hostsJson, candidatesJson };
}

/** 实质内容指纹：比较新旧数据是否变化（忽略 version / 时间戳），无变化则跳过提交 */
export function fingerprint(
  hosts: Pick<HostsFile, 'entries'>,
  candidates: Pick<CandidatesFile, 'groups'>,
): string {
  const e = hosts.entries.map((x) => `${x.domain}=${x.ip}`).sort().join('|');
  const g = candidates.groups
    .map((x) => `${x.domain}=${[...x.candidates].sort().join(',')}`)
    .sort()
    .join('|');
  return `${e}#${g}`;
}
