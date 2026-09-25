/** 数据契约 schema v1 */

export interface HostsEntry {
  domain: string;
  ip: string;
  /** 探测端机房实测握手耗时，仅参考 */
  latencyMs: number;
  tlsVerified: true;
  checkedAt: string;
}

export interface HostsFile {
  version: number;
  generatedAt: string;
  probeSource: string;
  family: 'v4';
  entries: HostsEntry[];
}

export interface CandidatesGroup {
  domain: string;
  candidates: string[];
}

export interface CandidatesFile {
  version: number;
  generatedAt: string;
  family: 'v4';
  groups: CandidatesGroup[];
}
