/**
 * 拉取通道：local(dev) → raw-pinned → snapshot（永不失败兜底）。
 * 通道精简（2026-09-25 评估）：jsdelivr 在部分区域网络不可用、raw 与 raw-pinned 同走 hosts 钉的
 * 185.199.x 属冗余通道，且数据仓库未发布前远程全部 404——远程价值已由本地 runtime 扩池替代，
 * 仅保留 raw-pinned 作为"数据仓库发布后的可选新鲜种子"。
 */
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import type { CandidatesFile } from '@github-compass/core';
import snapshot from '../../resources/candidates.snapshot.json';

const RAW_HOST = 'raw.githubusercontent.com';
const RAW_PATH = '/amyaxy/github-compass/main/data/candidates.json';

export const DEFAULT_CHANNEL_ORDER = ['raw-pinned', 'snapshot'];

/** UI 展示名（Settings 页通道列表用）；顺序不参与逻辑 */
export const CHANNEL_LABELS: Record<string, string> = {
  'raw-pinned': ['raw 缓存 IP 直连', `https://${RAW_HOST}${RAW_PATH}（直连上次可用 IP）`],
  snapshot: ['内置兜底数据', '随安装包打包，永不失败'],
};

export interface FetchResult {
  data: CandidatesFile;
  channel: string;
}

export type LogFn = (line: string) => void;

/** 用缓存 IP 直连 raw：连 IP:443，SNI/证书校验仍用真实域名（rejectUnauthorized 不跳过） */
function fetchPinnedText(ip: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: ip,
        servername: RAW_HOST,
        port: 443,
        path: RAW_PATH,
        method: 'GET',
        headers: { Host: RAW_HOST, 'User-Agent': 'github-compass-client' },
        rejectUnauthorized: true,
        timeout: 8000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

export async function fetchCandidatesJson(
  log: LogFn,
  pinnedIp?: string,
  order: string[] = DEFAULT_CHANNEL_ORDER,
): Promise<FetchResult> {
  // dev 通道：COMPASS_LOCAL_DATA 指向含 candidates.json 的本地目录
  const localDir = process.env.COMPASS_LOCAL_DATA;
  if (localDir) {
    try {
      const raw = await readFile(path.join(localDir, 'candidates.json'), 'utf8');
      log(`channel local ok (${localDir})`);
      return { data: JSON.parse(raw) as CandidatesFile, channel: 'local' };
    } catch (err) {
      log(`channel local failed: ${(err as Error).message}`);
    }
  }

  const channels: Record<string, () => Promise<FetchResult>> = {
    'raw-pinned': async () => {
      if (!pinnedIp) throw new Error('无缓存 IP，跳过');
      return { data: JSON.parse(await fetchPinnedText(pinnedIp)) as CandidatesFile, channel: 'raw-pinned' };
    },
    snapshot: async () => ({ data: snapshot as CandidatesFile, channel: 'snapshot' }),
  };

  for (const name of order) {
    const ch = channels[name];
    if (!ch) continue;
    try {
      const r = await ch();
      log(`channel ${name} ok`);
      return r;
    } catch (err) {
      log(`channel ${name} failed: ${(err as Error).message}`);
    }
  }
  throw new Error('所有拉取通道均失败');
}
