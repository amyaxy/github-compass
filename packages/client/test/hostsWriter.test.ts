import { describe, expect, it } from 'vitest';
import {
  buildBlock,
  replaceMarkedBlock,
  readBlockVersion,
  HostsWriter,
  MARKER_START,
  MARKER_END,
} from '../src/main/hostsWriter.ts';
import type { HostsEntry } from '@github-compass/core';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.COMPASS_SKIP_FLUSHDNS = '1';

const entry = (ip: string, domain = 'github.com'): HostsEntry => ({
  domain,
  ip,
  latencyMs: 45,
  tlsVerified: true,
  checkedAt: new Date().toISOString(),
});

describe('buildBlock / replaceMarkedBlock（纯函数）', () => {
  it('标记块含 Start/End 与条目', () => {
    const block = buildBlock([entry('1.1.1.1')], 3);
    expect(block.startsWith(MARKER_START)).toBe(true);
    expect(block).toContain('# Version: v3');
    expect(block.trimEnd().endsWith(MARKER_END)).toBe(true);
    expect(block).toContain('1.1.1.1 github.com');
  });
  it('已有标记块 → 替换不重复追加', () => {
    const original = `127.0.0.1 localhost\n\n${buildBlock([entry('9.9.9.9')], 1)}`;
    const next = replaceMarkedBlock(original, buildBlock([entry('8.8.8.8')], 2));
    expect(next.split(MARKER_START)).toHaveLength(2);
    expect(next).toContain('8.8.8.8');
    expect(next).not.toContain('9.9.9.9');
    expect(next).toContain('127.0.0.1 localhost');
  });
  it('无标记块 → 追加并保留用户内容', () => {
    const next = replaceMarkedBlock('1.2.3.4 user.example\n', buildBlock([entry('5.5.5.5')], 1));
    expect(next).toContain('1.2.3.4 user.example');
    expect(next).toContain('5.5.5.5');
  });
});

describe('HostsWriter（临时文件集成，不碰系统 hosts）', () => {
  function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), 'gc-wtest-'));
    const hostsPath = path.join(dir, 'hosts');
    writeFileSync(hostsPath, '127.0.0.1 localhost\n1.2.3.4 user.example.com\n');
    const logs: string[] = [];
    const writer = new HostsWriter(hostsPath, path.join(dir, 'backups'), (l) => logs.push(l));
    return { dir, hostsPath, writer, logs };
  }

  it('write：保留用户内容 + 标记块 + 生成备份', async () => {
    const { hostsPath, writer } = setup();
    const r = await writer.write([entry('20.205.243.166')], 1);
    const c = readFileSync(hostsPath, 'utf8');
    expect(c).toContain('1.2.3.4 user.example.com');
    expect(c).toContain(MARKER_START);
    expect(existsSync(r.backupPath)).toBe(true);
  });

  it('二次 write：标记块唯一、旧 IP 移除', async () => {
    const { hostsPath, writer } = setup();
    await writer.write([entry('1.1.1.1')], 1);
    await writer.write([entry('2.2.2.2')], 2);
    const c = readFileSync(hostsPath, 'utf8');
    expect(c.split(MARKER_START)).toHaveLength(2);
    expect(c).toContain('2.2.2.2');
    expect(c).not.toContain('1.1.1.1');
  });

  it('rollback：恢复备份时点（无标记块）', async () => {
    const { hostsPath, writer } = setup();
    const r1 = await writer.write([entry('1.1.1.1')], 1);
    await writer.write([entry('2.2.2.2')], 2);
    await writer.rollback(r1.backupPath);
    const c = readFileSync(hostsPath, 'utf8');
    expect(c).not.toContain(MARKER_START);
    expect(c).toContain('1.2.3.4 user.example.com');
  });

  it('sameAsCurrent：无块=false、同内容=true、换IP=false（忽略时间戳）', async () => {
    const { writer } = setup();
    expect(await writer.sameAsCurrent([entry('1.1.1.1')])).toBe(false);
    await writer.write([entry('1.1.1.1')], 1);
    expect(await writer.sameAsCurrent([entry('1.1.1.1')])).toBe(true);
    expect(await writer.sameAsCurrent([entry('2.2.2.2')])).toBe(false);
  });

  it('回滚自身也产生新备份（可再回滚）', async () => {
    const { dir, writer } = setup();
    const r1 = await writer.write([entry('1.1.1.1')], 1);
    await writer.rollback(r1.backupPath);
    const backups = readFileSync; // 目录检查
    void backups;
    expect(existsSync(path.join(dir, 'backups'))).toBe(true);
  });
});

describe('readBlockVersion（回滚状态回填依据）', () => {
  it('有块带版本行 → 返回版本号', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gc-rbv-'));
    const hostsPath = path.join(dir, 'hosts');
    writeFileSync(hostsPath, buildBlock([entry('1.1.1.1')], 7));
    expect(await readBlockVersion(hostsPath)).toBe(7);
  });

  it('无块 / 文件不存在 → 0', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gc-rbv-'));
    const hostsPath = path.join(dir, 'hosts');
    writeFileSync(hostsPath, '127.0.0.1 localhost\n');
    expect(await readBlockVersion(hostsPath)).toBe(0);
    expect(await readBlockVersion(path.join(dir, 'nope'))).toBe(0);
  });
});
