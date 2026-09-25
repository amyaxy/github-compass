import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runUpdateCycle } from '../src/main/updater.ts';
import { ConfigStore } from '../src/main/config.ts';
import { HostsWriter } from '../src/main/hostsWriter.ts';
import type { ProbePair, ProbeResult } from '@github-compass/core';

process.env.COMPASS_SKIP_FLUSHDNS = '1';

/** 快照候选池（github.com 仅 1 个已死候选 → 枯竭场景）；经 COMPASS_LOCAL_DATA 本地通道注入，测试离网 */
const CAND = {
  version: 7,
  generatedAt: '2026-09-25T00:00:00Z',
  family: 'v4' as const,
  groups: [{ domain: 'github.com', candidates: ['9.9.9.9'] }],
};

/** 隔离环境：临时 hosts 文件（COMPASS_HOSTS_PATH）+ 临时 userData + 本地数据通道，绝不碰真实系统/网络 */
function mkEnv(currentBlock: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gc-upd-'));
  const hostsPath = path.join(dir, 'hosts');
  writeFileSync(hostsPath, `1.2.3.4 user.example.com\n${currentBlock}`);
  process.env.COMPASS_HOSTS_PATH = hostsPath;
  const localData = mkdtempSync(path.join(tmpdir(), 'gc-upd-data-'));
  writeFileSync(path.join(localData, 'candidates.json'), JSON.stringify(CAND));
  process.env.COMPASS_LOCAL_DATA = localData;
  const store = new ConfigStore(mkdtempSync(path.join(tmpdir(), 'gc-upd-user-')));
  const logs: string[] = [];
  const writer = new HostsWriter(hostsPath, path.join(dir, 'backups'), (l) => logs.push(l));
  return { store, writer, hostsPath, logs };
}

const P = (domain: string, ip: string, ok: boolean, extra: Partial<ProbeResult> = {}): ProbeResult => ({
  domain,
  ip,
  ok,
  ...(ok ? { latencyMs: 100 } : { error: 'timeout' }),
  ...extra,
});

const BLOCK = '# GitHubCompass Host Start\n140.82.112.4 github.com\n# GitHubCompass Host End\n';

afterAll(() => {
  delete process.env.COMPASS_HOSTS_PATH;
  delete process.env.COMPASS_LOCAL_DATA;
});

describe('runUpdateCycle 候选池枯竭 → 扩池兜底', () => {
  it('快照候选全灭时走 expandPoolImpl，扩出好 IP 并切换写入 + 持久化 expandedPools', async () => {
    const env = mkEnv(BLOCK);
    const calls: string[] = [];
    // 健康检查的当前 IP 与快照候选 9.9.9.9 全部失败（模拟区域性网络阻断）；扩池重探的新 IP 通过
    const probeAllImpl = async (pairs: ProbePair[]): Promise<ProbeResult[]> =>
      pairs.map(({ domain, ip }) => (ip === '140.82.112.4' || ip === '9.9.9.9' ? P(domain, ip, false) : P(domain, ip, true)));
    const probeHttpImpl = async (domain: string, ip: string): Promise<ProbeResult> =>
      ip === '20.27.177.113' ? P(domain, ip, true, { ttfbMs: 113 }) : P(domain, ip, true, { ttfbMs: 500 });
    const expandPoolImpl = async (domain: string): Promise<ProbeResult[]> => {
      calls.push(`expand:${domain}`);
      return [
        P(domain, '20.27.177.113', true),
        P(domain, '20.205.243.166', true),
        P(domain, '140.82.112.4', false), // 当前死 IP 也会出现在扩池里，应被过滤
      ];
    };

    const r = await runUpdateCycle({
      store: env.store,
      writer: env.writer,
      log: (l) => env.logs.push(l),
      probeAllImpl,
      probeHttpImpl,
      expandPoolImpl,
    });

    expect(calls).toContain('expand:github.com');
    expect(r.action).toBe('write');
    expect(r.switched?.[0]).toMatchObject({ domain: 'github.com', to: '20.27.177.113' }); // ttfb 113 最快者胜出
    const hosts = readFileSync(env.hostsPath, 'utf8');
    expect(hosts).toContain('20.27.177.113 github.com');
    expect(hosts).toContain('1.2.3.4 user.example.com'); // 用户内容保留
    const pool = env.store.get().expandedPools['github.com'];
    expect(pool).toContain('20.205.243.166');
    expect(pool).not.toContain('140.82.112.4'); // 死 IP 不进扩池缓存
    expect(env.store.get().backups.length).toBe(1);
  });

  it('扩池结果已持久化时直接用缓存，不再触发本地扩池', async () => {
    const env = mkEnv(BLOCK);
    env.store.update({ expandedPools: { 'github.com': ['20.27.177.113', '20.200.245.247'] } });
    const calls: string[] = [];
    // 快照候选与当前 IP 全灭（枯竭），仅扩池缓存的 IP 探测通过
    const probeAllImpl = async (pairs: ProbePair[]): Promise<ProbeResult[]> =>
      pairs.map(({ domain, ip }) =>
        ip === '140.82.112.4' || ip === '9.9.9.9' ? P(domain, ip, false) : P(domain, ip, true),
      );
    const probeHttpImpl = async (domain: string, ip: string): Promise<ProbeResult> =>
      P(domain, ip, true, { ttfbMs: ip === '20.27.177.113' ? 113 : 400 });

    const r = await runUpdateCycle({
      store: env.store,
      writer: env.writer,
      log: (l) => env.logs.push(l),
      probeAllImpl,
      probeHttpImpl,
      expandPoolImpl: async (domain) => {
        calls.push(`expand:${domain}`);
        return [];
      },
    });

    expect(calls).toHaveLength(0); // 用了扩池缓存
    expect(r.action).toBe('write');
    expect(r.switched?.[0]).toMatchObject({ to: '20.27.177.113' });
  });

  it('扩池也全灭 → 保留原 IP（宁挂勿断），action=none', async () => {
    const env = mkEnv(BLOCK);
    const r = await runUpdateCycle({
      store: env.store,
      writer: env.writer,
      log: (l) => env.logs.push(l),
      probeAllImpl: async (pairs: ProbePair[]) => pairs.map(({ domain, ip }) => P(domain, ip, false)),
      probeHttpImpl: async (domain, ip) => P(domain, ip, false),
      expandPoolImpl: async () => [],
    });
    expect(r.action).toBe('none');
    expect(r.reason).toContain('保留原 IP');
    expect(readFileSync(env.hostsPath, 'utf8')).toContain('140.82.112.4 github.com');
  });

  it('健康检查全通过 → 不拉数据不探测，直接返回', async () => {
    const env = mkEnv(BLOCK);
    let httpCalls = 0;
    const r = await runUpdateCycle({
      store: env.store,
      writer: env.writer,
      log: (l) => env.logs.push(l),
      probeAllImpl: async (pairs: ProbePair[]) => pairs.map(({ domain, ip }) => P(domain, ip, true)),
      probeHttpImpl: async (domain, ip) => {
        httpCalls++;
        return P(domain, ip, true, { ttfbMs: 100 });
      },
    });
    expect(r.action).toBe('none');
    expect(r.reason).toContain('健康');
    expect(httpCalls).toBe(1); // 健康检查含 HTTP 质量轮
  });

  it('劣化冷却：冷却期内计划任务跳过全量重探，force（手动检查）不受限', async () => {
    const env = mkEnv(BLOCK);
    const probeAllImpl = async (pairs: ProbePair[]): Promise<ProbeResult[]> =>
      pairs.map(({ domain, ip }) => (ip === '140.82.112.4' ? P(domain, ip, false) : P(domain, ip, true)));
    const probeHttpImpl = async (domain: string, ip: string): Promise<ProbeResult> => P(domain, ip, true, { ttfbMs: 100 });
    const deps = {
      store: env.store,
      writer: env.writer,
      log: (l: string) => env.logs.push(l),
      probeAllImpl,
      probeHttpImpl,
      expandPoolImpl: async () => [],
    };
    // 第一轮：快照候选 9.9.9.9 通过 → 正常切换（无劣化），不触发冷却
    const r1 = await runUpdateCycle(deps);
    expect(r1.action).toBe('write');
    expect(env.store.get().lastDegradedAt).toBeNull();
    // 写回冷却时间戳模拟"上一轮劣化无替代"，并把 hosts 改回死 IP 使健康检查失败
    env.store.update({ lastDegradedAt: new Date().toISOString() });
    writeFileSync(env.hostsPath, `1.2.3.4 user.example.com\n${BLOCK}`);
    const r2 = await runUpdateCycle(deps);
    expect(r2.action).toBe('none');
    expect(r2.reason).toContain('冷却');
    const r3 = await runUpdateCycle({ ...deps, force: true });
    expect(r3.action).toBe('write'); // force 全量执行
  });

  it('慢而半死的当前 IP（ttfb>1.5s）按劣化触发重探，切到更快候选', async () => {
    const env = mkEnv(BLOCK);
    const r = await runUpdateCycle({
      store: env.store,
      writer: env.writer,
      log: (l) => env.logs.push(l),
      probeAllImpl: async (pairs: ProbePair[]) => pairs.map(({ domain, ip }) => P(domain, ip, true)),
      probeHttpImpl: async (domain, ip) =>
        P(domain, ip, true, { ttfbMs: ip === '140.82.112.4' ? 3000 : 113 }),
    });
    expect(r.action).toBe('write');
    expect(r.switched?.[0]).toMatchObject({ to: '9.9.9.9' }); // 当前 3000ms > 候选 113ms → 值得换
  });

  it('候选不比当前慢 IP 更快时不换（防抖动护栏）', async () => {
    const env = mkEnv(BLOCK);
    const r = await runUpdateCycle({
      store: env.store,
      writer: env.writer,
      log: (l) => env.logs.push(l),
      probeAllImpl: async (pairs: ProbePair[]) => pairs.map(({ domain, ip }) => P(domain, ip, true)),
      probeHttpImpl: async (domain, ip) =>
        P(domain, ip, true, { ttfbMs: ip === '140.82.112.4' ? 1600 : 4000 }), // 当前已判慢，但候选更慢
    });
    expect(r.action).toBe('none');
    expect(env.store.get().lastDegradedAt).not.toBeNull(); // 启动冷却
    expect(readFileSync(env.hostsPath, 'utf8')).toContain('140.82.112.4 github.com');
  });

  it('守护域缺失自愈：块内丢失的域名从候选/lastGood 探测恢复补回', async () => {
    // 块里只剩 api.github.com（github.com 被 GUI 事故整条顶掉）
    const env = mkEnv('# GitHubCompass Host Start\n20.205.243.168 api.github.com\n# GitHubCompass Host End\n');
    env.store.update({ lastGoodIps: { 'github.com': '20.27.177.113' } });
    const r = await runUpdateCycle({
      store: env.store,
      writer: env.writer,
      log: (l) => env.logs.push(l),
      // 全部探测通过（健康 + 恢复候选都 ok），质量轮让 lastGood 的 20.27 胜出
      probeAllImpl: async (pairs: ProbePair[]) => pairs.map(({ domain, ip }) => P(domain, ip, true)),
      probeHttpImpl: async (domain, ip) => P(domain, ip, true, { ttfbMs: ip === '20.27.177.113' ? 113 : 500 }),
    });
    expect(r.action).toBe('write');
    expect(r.reason).toContain('恢复缺失域名');
    const hosts = readFileSync(env.hostsPath, 'utf8');
    expect(hosts).toContain('20.27.177.113 github.com'); // lastGoodIps 候选恢复
    expect(hosts).toContain('20.205.243.168 api.github.com'); // 原条目保留
  });

  it('缺失域候选全灭时不强行恢复（下轮重试），其余条目不动', async () => {
    const env = mkEnv('# GitHubCompass Host Start\n20.205.243.168 api.github.com\n# GitHubCompass Host End\n');
    const r = await runUpdateCycle({
      store: env.store,
      writer: env.writer,
      log: (l) => env.logs.push(l),
      probeAllImpl: async (pairs: ProbePair[]) =>
        pairs.map(({ domain, ip }) => (domain === 'api.github.com' ? P(domain, ip, true) : P(domain, ip, false))),
      probeHttpImpl: async (domain, ip) => P(domain, ip, false),
    });
    expect(r.action).toBe('none');
    expect(readFileSync(env.hostsPath, 'utf8')).not.toContain(' github.com');
  });
});
