import { describe, expect, it } from 'vitest';
import {
  formatCst,
  selectBest,
  classifyFailure,
  decideAutoUpdate,
  ipToLong,
  cidrContains,
  buildFiles,
  fingerprint,
} from '../src/index.ts';
import type { ProbeResult } from '../src/index.ts';

const R = (domain: string, ip: string, ok: boolean, latencyMs?: number, error?: string): ProbeResult => ({
  domain,
  ip,
  ok,
  latencyMs,
  error,
});

describe('time.formatCst', () => {
  it('UTC → 东八区无毫秒', () => {
    expect(formatCst(new Date('2026-09-24T05:32:14.445Z'))).toBe('2026-09-24T13:32:14+08:00');
  });
  it('跨日进位', () => {
    expect(formatCst(new Date('2026-09-24T16:00:00Z'))).toBe('2026-09-25T00:00:00+08:00');
  });
});

describe('select.selectBest', () => {
  it('每域名取最低延迟且仅保留有通过项的域名', () => {
    const best = selectBest(
      [
        R('github.com', '1.1.1.1', true, 100),
        R('github.com', '2.2.2.2', true, 50),
        R('github.com', '3.3.3.3', false, undefined, 'timeout'),
        R('api.github.com', '4.4.4.4', true, 80),
        R('dead.example.com', '5.5.5.5', false, undefined, 'timeout'),
      ],
      new Date('2026-09-24T00:00:00Z'),
    );
    expect(best).toHaveLength(2);
    expect(best[0].domain).toBe('api.github.com');
    expect(best[1]).toMatchObject({ domain: 'github.com', ip: '2.2.2.2', latencyMs: 50, tlsVerified: true });
  });

  it('稳定性优先：复测才通过的波动 IP 降权于首轮直通者（即使更快）', () => {
    const best = selectBest([
      { domain: 'github.com', ip: '1.1.1.1', ok: true, latencyMs: 80, passedRetry: true },
      { domain: 'github.com', ip: '2.2.2.2', ok: true, latencyMs: 200 },
    ]);
    expect(best[0]).toMatchObject({ domain: 'github.com', ip: '2.2.2.2', latencyMs: 200 });
    // 只有波动 IP 可用时仍应选中（而不是丢弃）
    const only = selectBest([
      { domain: 'github.com', ip: '3.3.3.3', ok: true, latencyMs: 90, passedRetry: true },
      { domain: 'github.com', ip: '4.4.4.4', ok: true, latencyMs: 120, passedRetry: true },
    ]);
    expect(only[0]).toMatchObject({ ip: '3.3.3.3' });
  });

  it('传输质量优先：ttfbMs 低于握手更快的对手时按 ttfb 胜出（握手快 ≠ 传输快）', () => {
    const best = selectBest([
      { domain: 'github.com', ip: '1.1.1.1', ok: true, latencyMs: 105, ttfbMs: 851 }, // 握手快但 TTFB 慢
      { domain: 'github.com', ip: '2.2.2.2', ok: true, latencyMs: 124, ttfbMs: 113 }, // 握手稍慢但 TTFB 快
    ]);
    expect(best[0]).toMatchObject({ ip: '2.2.2.2' });
  });

  it('无 ttfbMs 的结果按 latencyMs 回退排序（兼容旧数据/纯 TLS 探测）', () => {
    const best = selectBest([
      { domain: 'github.com', ip: '1.1.1.1', ok: true, latencyMs: 90 },
      { domain: 'github.com', ip: '2.2.2.2', ok: true, latencyMs: 60 },
    ]);
    expect(best[0]).toMatchObject({ ip: '2.2.2.2', latencyMs: 60 });
  });
});

describe('autoupdate.decideAutoUpdate', () => {
  const E = (domain: string, ip: string): { domain: string; ip: string; latencyMs: number; tlsVerified: true; checkedAt: string } => ({
    domain,
    ip,
    latencyMs: 100,
    tlsVerified: true,
    checkedAt: '2026-09-24T00:00:00Z',
  });

  it('空标记块 → none 且提示先完成首次写入', () => {
    const d = decideAutoUpdate([], [], new Map());
    expect(d.action).toBe('none');
    expect(d.reason).toContain('首次写入');
  });

  it('全部健康 → none 不折腾', () => {
    const cur = [E('github.com', '1.1.1.1'), E('api.github.com', '2.2.2.2')];
    const d = decideAutoUpdate(cur, [
      { domain: 'github.com', ip: '1.1.1.1', ok: true, latencyMs: 90 },
      { domain: 'api.github.com', ip: '2.2.2.2', ok: true, latencyMs: 80 },
    ], new Map());
    expect(d.action).toBe('none');
  });

  it('劣化且有替代 → write：健康域名保留原 IP，劣化域名切换（稳定性优先）', () => {
    const cur = [E('github.com', '1.1.1.1'), E('api.github.com', '2.2.2.2')];
    const pool = new Map([
      ['github.com', [
        { domain: 'github.com', ip: '3.3.3.3', ok: true, latencyMs: 50, passedRetry: true },
        { domain: 'github.com', ip: '4.4.4.4', ok: true, latencyMs: 120 },
      ] as ProbeResult[]],
    ]);
    const d = decideAutoUpdate(cur, [
      { domain: 'github.com', ip: '1.1.1.1', ok: false, error: 'timeout' },
      { domain: 'api.github.com', ip: '2.2.2.2', ok: true, latencyMs: 80 },
    ], pool);
    expect(d.action).toBe('write');
    expect(d.switched).toEqual([{ domain: 'github.com', from: '1.1.1.1', to: '4.4.4.4', latencyMs: 120 }]);
    expect(d.entries).toContainEqual(cur[1]); // 健康域名原样保留
  });

  it('劣化且无替代 → none 保留原 IP（宁挂勿断），记入 degraded', () => {
    const cur = [E('github.com', '1.1.1.1')];
    const d = decideAutoUpdate(
      cur,
      [{ domain: 'github.com', ip: '1.1.1.1', ok: false, error: 'timeout' }],
      new Map([['github.com', [{ domain: 'github.com', ip: '2.2.2.2', ok: false, error: 'timeout' }] as ProbeResult[]]]),
    );
    expect(d.action).toBe('none');
    expect(d.degraded).toEqual(['github.com']);
  });

  it('防抖动护栏：当前半死（有 ttfb 实测）而候选更慢 → 不换', () => {
    const cur = [E('github.com', '1.1.1.1')];
    const slowCurrent: ProbeResult = { domain: 'github.com', ip: '1.1.1.1', ok: false, error: '传输慢(ttfb 1600ms)', latencyMs: 200, ttfbMs: 1600 };
    const slowerPool = new Map<string, ProbeResult[]>([
      ['github.com', [{ domain: 'github.com', ip: '2.2.2.2', ok: true, latencyMs: 300, ttfbMs: 4000 }]],
    ]);
    const d = decideAutoUpdate(cur, [slowCurrent], slowerPool);
    expect(d.action).toBe('none');
    expect(d.degraded).toEqual(['github.com']);
  });

  it('护栏放行：候选更快 → 照常切换（半死 IP 换优路径）', () => {
    const cur = [E('github.com', '1.1.1.1')];
    const slowCurrent: ProbeResult = { domain: 'github.com', ip: '1.1.1.1', ok: false, error: '传输慢(ttfb 3000ms)', latencyMs: 100, ttfbMs: 3000 };
    const fasterPool = new Map<string, ProbeResult[]>([
      ['github.com', [{ domain: 'github.com', ip: '2.2.2.2', ok: true, latencyMs: 150, ttfbMs: 113 }]],
    ]);
    const d = decideAutoUpdate(cur, [slowCurrent], fasterPool);
    expect(d.action).toBe('write');
    expect(d.switched[0]).toMatchObject({ to: '2.2.2.2', latencyMs: 113 });
  });
});

describe('select.classifyFailure', () => {
  it('全证书错误 → SSL_INSPECTION_SUSPECTED', () => {
    expect(
      classifyFailure([
        R('a', '1.1.1.1', false, undefined, 'unable to verify the first certificate'),
        R('a', '2.2.2.2', false, undefined, 'self-signed certificate in chain'),
        R('b', '3.3.3.3', false, undefined, 'UNABLE_TO_GET_ISSUER_CERT'),
      ]),
    ).toBe('SSL_INSPECTION_SUSPECTED');
  });
  it('全非证书错误 → NO_USABLE_IP；有通过 → null；空 → NO_USABLE_IP', () => {
    expect(classifyFailure([R('a', '1.1.1.1', false, undefined, 'timeout')])).toBe('NO_USABLE_IP');
    expect(classifyFailure([R('a', '1.1.1.1', true, 30), R('b', '2.2.2.2', false, undefined, 'x')])).toBeNull();
    expect(classifyFailure([])).toBe('NO_USABLE_IP');
  });
});

describe('belong.cidr', () => {
  it('ipToLong 合法/非法', () => {
    expect(ipToLong('0.0.0.0')).toBe(0);
    expect(ipToLong('255.255.255.255')).toBe(4294967295);
    expect(ipToLong('10.20.30.40')).toBe(((10 << 24) | (20 << 16) | (30 << 8) | 40) >>> 0);
    expect(ipToLong('999.1.1.1')).toBe(-1);
    expect(ipToLong('1.2.3')).toBe(-1);
  });
  it('cidrContains 边界', () => {
    expect(cidrContains('185.199.108.0/22', '185.199.108.133')).toBe(true);
    expect(cidrContains('185.199.108.0/22', '185.199.111.255')).toBe(true);
    expect(cidrContains('185.199.108.0/22', '185.199.112.0')).toBe(false);
    expect(cidrContains('140.82.112.0/20', '140.82.116.3')).toBe(true);
    expect(cidrContains('140.82.112.0/20', '140.82.128.1')).toBe(false);
    expect(cidrContains('bad-cidr', '1.1.1.1')).toBe(false);
  });
});

describe('emit.buildFiles / fingerprint', () => {
  const results = [
    R('github.com', '20.205.243.166', true, 184),
    R('github.com', '140.82.116.3', true, 400),
    R('api.github.com', '20.205.243.168', true, 174),
    R('raw.githubusercontent.com', '185.199.111.133', false, undefined, 'timeout'),
  ];
  const { hostsTxt, hostsJson, candidatesJson } = buildFiles(results, 7, new Date('2026-09-24T05:00:00Z'));

  it('hosts.txt 标记块 + 东八区时间 + 仅最优', () => {
    expect(hostsTxt).toContain('# GitHubCompass Host Start');
    expect(hostsTxt).toMatch(/# Update time: 2026-09-24T13:00:00\+08:00/);
    expect(hostsTxt).toContain('20.205.243.166 github.com');
    expect(hostsTxt).not.toContain('140.82.116.3');
    expect(hostsTxt).not.toContain('raw.githubusercontent.com');
  });
  it('candidates.json 含全部通过项、排除失败项', () => {
    const g = candidatesJson.groups.find((x) => x.domain === 'github.com');
    expect(g?.candidates).toEqual(['20.205.243.166', '140.82.116.3']);
    expect(candidatesJson.groups.find((x) => x.domain === 'raw.githubusercontent.com')?.candidates).toEqual([]);
    expect(hostsJson.version).toBe(7);
  });
  it('fingerprint 忽略 version/时间、对实质变化敏感', () => {
    const again = buildFiles(results, 99, new Date());
    expect(fingerprint(again.hostsJson, again.candidatesJson)).toBe(fingerprint(hostsJson, candidatesJson));
    const changed = buildFiles([...results, R('z.github.com', '9.9.9.9', true, 10)], 7, new Date('2026-09-24T05:00:00Z'));
    expect(fingerprint(changed.hostsJson, changed.candidatesJson)).not.toBe(fingerprint(hostsJson, candidatesJson));
  });
});
