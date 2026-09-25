/** 目标域名与探测常量 */

export interface DomainGroup {
  domain: string;
  /** github = GitHub 自有段（meta API 覆盖）；fastly = CDN 段（meta.pages / 185.199.108.0/22） */
  cdn: 'github' | 'fastly';
}

/**
 * 注意：*.github.io 为泛域名，hosts 不支持通配符，明确不做。
 */
export const TARGET_DOMAINS: DomainGroup[] = [
  { domain: 'github.com', cdn: 'github' },
  { domain: 'api.github.com', cdn: 'github' },
  { domain: 'codeload.github.com', cdn: 'github' },
  { domain: 'collector.github.com', cdn: 'github' },
  { domain: 'raw.githubusercontent.com', cdn: 'fastly' },
  { domain: 'gist.githubusercontent.com', cdn: 'fastly' },
  { domain: 'objects.githubusercontent.com', cdn: 'fastly' },
  { domain: 'avatars.githubusercontent.com', cdn: 'fastly' },
  { domain: 'github.githubassets.com', cdn: 'fastly' },
];

/** 交叉解析用公共 DNS（国内三家 + 国际两家） */
export const DNS_SERVERS = [
  '223.5.5.5',        // 阿里
  '119.29.29.29',     // 腾讯
  '114.114.114.114',  // 114
  '8.8.8.8',          // Google
  '1.1.1.1',          // Cloudflare
];

/** GitHub Pages / Fastly 公布段（meta.pages 通常也含，作兜底） */
export const FASTLY_CIDRS = ['185.199.108.0/22'];

export const PROBE_CONCURRENCY = 10;
export const PROBE_TIMEOUT_MS = 4000;
/** 波动复测：失败项整体延迟后重测的轮数与间隔（区域性网络动态限速/丢包会让同一 IP 相邻两轮一通一断） */
export const PROBE_RETRIES = 1;
export const PROBE_RETRY_DELAY_MS = 1500;
