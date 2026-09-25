import { FASTLY_CIDRS } from './domains.js';

export function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return -1;
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

export function cidrContains(cidr: string, ip: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const ipLong = ipToLong(ip);
  const baseLong = ipToLong(base ?? '');
  if (ipLong < 0 || baseLong < 0 || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipLong & mask) === (baseLong & mask);
}

type MetaResponse = Record<string, unknown>;

const META_KEYS = ['web', 'api', 'git', 'packages', 'pages', 'importer', 'actions', 'dependabot'];

/** 拉取 GitHub 官方 CIDR（免认证，仅取 IPv4 段） */
export async function fetchMetaCidrs(metaUrl = 'https://api.github.com/meta'): Promise<string[]> {
  const res = await fetch(metaUrl, { headers: { 'user-agent': 'github-compass-probe' } });
  if (!res.ok) throw new Error(`meta API responded ${res.status}`);
  const data = (await res.json()) as MetaResponse;
  const cidrs = new Set<string>();
  for (const key of META_KEYS) {
    const arr = data[key];
    if (Array.isArray(arr)) {
      for (const c of arr) {
        if (typeof c === 'string' && !c.includes(':')) cidrs.add(c);
      }
    }
  }
  return [...cidrs];
}

/** 归属预过滤器：IP ∈（meta 段 ∪ Fastly 段）才采信（防 DNS 污染；终判靠 TLS 证书） */
export function makeBelongFilter(metaCidrs: string[]): (ip: string) => boolean {
  const all = [...metaCidrs, ...FASTLY_CIDRS];
  return (ip) => all.some((c) => cidrContains(c, ip));
}
