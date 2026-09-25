import { describe, expect, it } from 'vitest';
import { ConfigStore, DEFAULT_SETTINGS } from '../src/main/config.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function tmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'gc-ctest-'));
}

describe('ConfigStore', () => {
  it('全新目录 → 默认值（含 M3.1 新字段）', () => {
    const s = new ConfigStore(tmpDir());
    expect(s.get().appliedVersion).toBe(0);
    expect(s.get().firstRunDone).toBe(false);
    expect(s.get().lastGoodIps).toEqual({});
    expect(s.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('updateSettings 局部合并并持久化（重载可见）', () => {
    const dir = tmpDir();
    const s = new ConfigStore(dir);
    s.updateSettings({ autoUpdate: true, probeConcurrency: 20 });
    const re = new ConfigStore(dir);
    expect(re.getSettings().autoUpdate).toBe(true);
    expect(re.getSettings().probeConcurrency).toBe(20);
    expect(re.getSettings().intervalHours).toBe(6); // 未传的保留默认
  });

  it('旧版本配置（无新字段）自动补齐默认值', () => {
    const dir = tmpDir();
    writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ appliedVersion: 2, appliedAt: 'x', backups: [] }),
    );
    const re = new ConfigStore(dir);
    expect(re.get().appliedVersion).toBe(2);
    expect(re.get().firstRunDone).toBe(false);
    expect(re.getSettings().channelOrder).toEqual(DEFAULT_SETTINGS.channelOrder);
  });

  it('损坏 JSON → 重置默认不崩溃', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'config.json'), '{broken');
    const re = new ConfigStore(dir);
    expect(re.get().appliedVersion).toBe(0);
  });

  it('addBackup 按 settings.backupKeep 截断（新在头）', () => {
    const s = new ConfigStore(tmpDir());
    s.updateSettings({ backupKeep: 2 });
    for (let i = 1; i <= 5; i++) {
      s.addBackup({ id: `b${i}`, path: `/p/${i}`, createdAt: `t${i}`, trigger: 'update', version: i });
    }
    const list = s.get().backups;
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe('b5');
  });

  it('通道迁移：已下线通道（jsdelivr/raw）从旧配置中过滤，保留剩余顺序', () => {
    const dir = tmpDir();
    writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ settings: { channelOrder: ['raw', 'raw-pinned', 'snapshot'] } }),
    );
    const re = new ConfigStore(dir);
    expect(re.getSettings().channelOrder).toEqual(['raw-pinned', 'snapshot']);
  });

  it('通道迁移：全部为已下线通道时回退默认顺序', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ settings: { channelOrder: ['jsdelivr'] } }));
    const re = new ConfigStore(dir);
    expect(re.getSettings().channelOrder).toEqual(['raw-pinned', 'snapshot']);
  });

  it('语言字段迁移：仅中文，旧配置 language 残留自动清除', () => {
    const dir = tmpDir();
    writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ settings: { language: 'en-US' } }));
    const re = new ConfigStore(dir);
    expect('language' in re.getSettings()).toBe(false);
  });
});
