import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HostsEntry } from '@github-compass/core';
import { formatCst, formatCstFileStamp } from '@github-compass/core';

export const MARKER_START = '# GitHubCompass Host Start';
export const MARKER_END = '# GitHubCompass Host End';
const BLOCK_RE = /# GitHubCompass Host Start[\s\S]*?# GitHubCompass Host End\r?\n?/;

export function defaultHostsPath(): string {
  // 测试/E2E 隔离：COMPASS_HOSTS_PATH 覆盖真实系统 hosts
  if (process.env.COMPASS_HOSTS_PATH) return process.env.COMPASS_HOSTS_PATH;
  if (process.platform === 'win32') {
    return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
  }
  return '/etc/hosts';
}

export function buildBlock(entries: HostsEntry[], version: number): string {
  const lines = [
    MARKER_START,
    `# Update time: ${formatCst(new Date())}`,
    `# Version: v${version}`,
    ...entries.map((e) => `${e.ip} ${e.domain}`),
    MARKER_END,
  ];
  return lines.join('\n') + '\n';
}

/** 只替换标记块；不存在则追加到文件末尾。用户其余内容原样保留 */
export function replaceMarkedBlock(content: string, block: string): string {
  if (BLOCK_RE.test(content)) return content.replace(BLOCK_RE, block);
  const trimmed = content.trimEnd();
  return (trimmed ? trimmed + '\n\n' : '') + block;
}

/** 解析当前 hosts 标记块为条目（ip domain 行；无块/无文件返回空数组），供闭环自动更新读取 */
export async function readMarkedBlock(hostsPath: string = defaultHostsPath()): Promise<HostsEntry[]> {
  let content = '';
  try {
    content = await readFile(hostsPath, 'utf8');
  } catch {
    return [];
  }
  const m = content.match(BLOCK_RE);
  if (!m) return [];
  const entries: HostsEntry[] = [];
  for (const line of m[0].split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [ip, domain] = t.split(/\s+/);
    if (ip && domain) {
      entries.push({ domain, ip, latencyMs: 0, tlsVerified: true, checkedAt: '' });
    }
  }
  return entries;
}

/** 读取当前 hosts 标记块内的数据版本号（# Version: vN）；无块/无版本行返回 0 */
export async function readBlockVersion(hostsPath: string = defaultHostsPath()): Promise<number> {
  let content = '';
  try {
    content = await readFile(hostsPath, 'utf8');
  } catch {
    return 0;
  }
  const m = content.match(BLOCK_RE);
  if (!m) return 0;
  const v = m[0].match(/# Version: v(\d+)/);
  return v ? Number(v[1]) : 0;
}

export class HostsWriter {
  constructor(
    private hostsPath: string = defaultHostsPath(),
    private backupDir: string,
    private log: (line: string) => void,
  ) {
    mkdirSync(backupDir, { recursive: true });
  }

  private backup(): { id: string; path: string } {
    // 东八区毫秒时间戳 + 4 位随机后缀：高速机器同一毫秒多次备份不撞名
    const id = formatCstFileStamp(new Date()) + '-' + Math.random().toString(36).slice(2, 6);
    const dest = path.join(this.backupDir, `hosts.${id}.bak`);
    if (existsSync(this.hostsPath)) copyFileSync(this.hostsPath, dest);
    else writeFileSync(dest, '', 'utf8');
    this.log(`备份 hosts → ${dest}`);
    return { id, path: dest };
  }

  /** 当前 hosts 标记块的实质内容（ip domain 行集合，忽略注释/时间戳）是否与给定 entries 一致 */
  async sameAsCurrent(entries: HostsEntry[]): Promise<boolean> {
    let content = '';
    try {
      content = await readFile(this.hostsPath, 'utf8');
    } catch {
      return false;
    }
    const m = content.match(BLOCK_RE);
    if (!m) return false;
    const cur = m[0]
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .sort()
      .join('|');
    const next = entries
      .map((e) => `${e.ip} ${e.domain}`)
      .sort()
      .join('|');
    return cur === next;
  }

  async write(entries: HostsEntry[], version: number): Promise<{ backupId: string; backupPath: string }> {
    this.log(`[write] 开始：${entries.length} 条 v${version} → ${this.hostsPath}`);
    const block = buildBlock(entries, version);
    const current = existsSync(this.hostsPath) ? readFileSync(this.hostsPath, 'utf8') : '';
    const next = replaceMarkedBlock(current, block);
    const backup = this.backup();
    await this.writeElevated(next);
    this.log(`已写入 ${entries.length} 条（v${version}）→ ${this.hostsPath}`);
    return { backupId: backup.id, backupPath: backup.path };
  }

  async rollback(backupPath: string): Promise<void> {
    if (!existsSync(backupPath)) throw new Error(`备份不存在：${backupPath}`);
    const content = readFileSync(backupPath, 'utf8');
    this.backup();
    await this.writeElevated(content);
    this.log(`已回滚到 ${backupPath}`);
  }

  /**
   * 写 hosts + 刷新 DNS。优先直接写；无权限时走提权流程：
   * Windows → 临时 .bat + PowerShell Start-Process -Verb RunAs（UAC）
   * macOS   → osascript with administrator privileges（系统密码框）
   */
  private async writeElevated(content: string): Promise<void> {
    try {
      await writeFile(this.hostsPath, content, 'utf8');
      this.log('[writeElevated] 直接写入成功');
      await this.flushDns();
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES') throw err;
      this.log(`[writeElevated] 直接写入被拒（${code}），进入提权流程…`);
    }

    const ts = Date.now();
    const tmp = path.join(tmpdir(), `github-compass-hosts-${ts}.tmp`);
    await writeFile(tmp, content, 'utf8');

    if (process.platform === 'win32') {
      const bat = path.join(tmpdir(), `github-compass-apply-${ts}.bat`);
      await writeFile(
        bat,
        `@echo off\r\ncopy /y "${tmp}" "${this.hostsPath}"\r\nipconfig /flushdns\r\ndel /q "${tmp}"\r\n`,
        'utf8',
      );
      await execFileP('powershell', [
        '-NoProfile',
        '-Command',
        `Start-Process -FilePath "${bat}" -Verb RunAs -Wait -WindowStyle Hidden`,
      ]);
      this.log('[writeElevated] UAC 授权流程已返回，验证写入结果…');
      const after = readFileSync(this.hostsPath, 'utf8');
      if (!after.includes(MARKER_START)) {
        throw new Error('提权写入未生效（可能取消了 UAC 授权）');
      }
      await unlink(bat).catch(() => undefined);
    } else {
      const sh = `cp '${tmp}' '${this.hostsPath}' && dscacheutil -flushcache && killall -HUP mDNSResponder; rm -f '${tmp}'`;
      await execFileP('osascript', [
        '-e',
        `do shell script "${sh.replace(/"/g, '\\"')}" with administrator privileges`,
      ]);
    }
    this.log('提权写入完成，DNS 缓存已刷新');
  }

  private async flushDns(): Promise<void> {
    if (process.env.COMPASS_SKIP_FLUSHDNS) return;
    try {
      if (process.platform === 'win32') {
        await execFileP('ipconfig', ['/flushdns']);
      } else {
        await execFileP('sh', ['-c', 'dscacheutil -flushcache; killall -HUP mDNSResponder 2>/dev/null || true']);
      }
      this.log('DNS 缓存已刷新');
    } catch {
      this.log('刷新 DNS 缓存失败（可手动执行）');
    }
  }
}

function execFileP(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()));
  });
}
