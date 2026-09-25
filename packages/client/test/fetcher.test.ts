import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCandidatesJson } from '../src/main/fetcher.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CAND = {
  version: 42,
  generatedAt: '2026-09-24T00:00:00Z',
  family: 'v4' as const,
  groups: [{ domain: 'github.com', candidates: ['20.205.243.166'] }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COMPASS_LOCAL_DATA;
});

describe('fetchCandidatesJson 通道策略（2026-09-25 精简后：raw-pinned → snapshot）', () => {
  it('raw-pinned 无缓存 IP 时自动跳过 → snapshot 兜底（永不抛）', async () => {
    const r = await fetchCandidatesJson(() => undefined, undefined, ['raw-pinned', 'snapshot']);
    expect(r.channel).toBe('snapshot');
    expect(r.data.groups.length).toBeGreaterThan(0);
  });

  it('snapshot 可独立成序（用户只保留兜底也合法）', async () => {
    const r = await fetchCandidatesJson(() => undefined, '185.199.111.133', ['snapshot']);
    expect(r.channel).toBe('snapshot');
  });

  it('channelOrder 不含的通道不被尝试', async () => {
    const spy = vi.fn(async () => {
      throw new Error('should not reach network');
    });
    vi.stubGlobal('fetch', spy);
    const r = await fetchCandidatesJson(() => undefined, undefined, ['snapshot']);
    expect(r.channel).toBe('snapshot');
    expect(spy).not.toHaveBeenCalled();
  });

  it('已下线通道名残留在 order 中时被忽略（迁移兼容）', async () => {
    const r = await fetchCandidatesJson(() => undefined, undefined, ['jsdelivr', 'raw', 'raw-pinned', 'snapshot']);
    expect(r.channel).toBe('snapshot'); // jsdelivr/raw 已从 channels 表移除，直接落到 snapshot
  });

  it('COMPASS_LOCAL_DATA 本地通道优先（dev/E2E）', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gc-fdata-'));
    writeFileSync(path.join(dir, 'candidates.json'), JSON.stringify(CAND));
    process.env.COMPASS_LOCAL_DATA = dir;
    const r = await fetchCandidatesJson(() => undefined);
    expect(r.channel).toBe('local');
    expect(r.data.version).toBe(42);
  });
});
