import tls from 'node:tls';
import { PROBE_RETRIES, PROBE_RETRY_DELAY_MS, PROBE_TIMEOUT_MS } from './domains.js';

export interface ProbePair {
  domain: string;
  ip: string;
}

export interface ProbeResult extends ProbePair {
  ok: boolean;
  latencyMs?: number;
  /** HTTP GET 首字节耗时（传输质量指标）；TLS 握手快 ≠ 传输快，选优时 ttfbMs 优先 */
  ttfbMs?: number;
  error?: string;
  /** 复测才通过 = 波动 IP（区域性网络动态限速），选优时降权 */
  passedRetry?: boolean;
}

/** 每域名 HTTP 探测路径：只要收到响应头+适量字节即可测 TTFB，状态码不判定（404 页也反映服务可达性） */
export const PROBE_HTTP_PATHS: Record<string, string> = {
  'github.com': '/robots.txt',
  'api.github.com': '/robots.txt',
  'raw.githubusercontent.com': '/facebook/react/main/README.md',
  'gist.githubusercontent.com': '/facebook/react/main/README.md',
  'codeload.github.com': '/robots.txt',
  'objects.githubusercontent.com': '/robots.txt',
  'avatars.githubusercontent.com': '/robots.txt',
  'collector.github.com': '/robots.txt',
  'github.githubassets.com': '/robots.txt',
};

const HTTP_READ_CAP = 64 * 1024;

/**
 * HTTP 质量探测：TLS（同 probeTls 校验）→ GET 路径 → 首字节计时。
 * "TLS 通但 HTTP 无响应/极慢"的 IP（区域性网络针对性限速）在此被淘汰；
 * 收到 HTTP_READ_CAP 字节或连接关闭即完成，不追求完整响应体。
 */
export function probeHttp(domain: string, ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let ttfb: number | undefined;
    let received = 0;
    const socket = tls.connect({
      host: ip,
      port: 443,
      servername: domain,
      rejectUnauthorized: true,
      timeout: timeoutMs,
    });
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ domain, ip, ok, latencyMs: ok ? Date.now() - started : undefined, ttfbMs: ok ? ttfb : undefined, error });
    };
    socket.once('secureConnect', () => {
      socket.write(
        `GET ${PROBE_HTTP_PATHS[domain] ?? '/'} HTTP/1.1\r\nHost: ${domain}\r\nUser-Agent: github-compass-probe\r\nAccept: */*\r\nConnection: close\r\n\r\n`,
      );
      socket.setEncoding('latin1');
      socket.on('data', () => {
        if (ttfb === undefined) ttfb = Date.now() - started;
        received += 1;
        if (received >= HTTP_READ_CAP) done(true);
      });
      socket.once('end', () => done(true));
    });
    socket.once('timeout', () => done(false, 'timeout'));
    socket.once('error', (err) => done(false, err.message));
  });
}

/**
 * 终判探测：TCP 443 → TLS（SNI=真实域名，证书链+SAN 校验，永不跳过）。
 * 握手通过即采信；HTTP 状态码仅参考，不在此层判定。
 */
export function probeTls(domain: string, ip: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const socket = tls.connect({
      host: ip,
      port: 443,
      servername: domain,
      rejectUnauthorized: true,
      timeout: timeoutMs,
    });
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ domain, ip, ok, latencyMs: ok ? Date.now() - started : undefined, error });
    };
    socket.once('secureConnect', () => done(true));
    socket.once('timeout', () => done(false, 'timeout'));
    socket.once('error', (err) => done(false, err.message));
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 简单并发池；onResult 仅在首轮逐个回报完成项（用于进度推送，复测轮不推避免 done 超 total）。
 * 波动复测：首轮失败项整体延迟 PROBE_RETRY_DELAY_MS 后重测，单次 timeout/reset 不判死——
 * 实测同一 IP 相邻两轮可能一通一断（区域性网络动态限速），复测取通过结果，仍失败才判"本地未通"。
 */
export async function probeAll(
  pairs: ProbePair[],
  concurrency: number,
  onResult?: (result: ProbeResult, done: number, total: number) => void,
  timeoutMs: number = PROBE_TIMEOUT_MS,
  retries: number = PROBE_RETRIES,
  retryDelayMs: number = PROBE_RETRY_DELAY_MS,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const run = async (list: ProbePair[], report: boolean): Promise<ProbeResult[]> => {
    const out: ProbeResult[] = [];
    let cursor = 0;
    const workerCount = Math.min(concurrency, list.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < list.length) {
        const pair = list[cursor++];
        const r = await probeTls(pair.domain, pair.ip, timeoutMs);
        out.push(r);
        if (report) onResult?.(r, results.length + out.length, pairs.length);
      }
    });
    await Promise.all(workers);
    return out;
  };

  results.push(...(await run(pairs, true)));
  for (let i = 0; i < retries; i++) {
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) break;
    await sleep(retryDelayMs);
    const retried = await run(
      failed.map(({ domain, ip }) => ({ domain, ip })),
      false,
    );
    const better = new Map(retried.map((r) => [`${r.domain}|${r.ip}`, r] as const));
    for (let j = 0; j < results.length; j++) {
      if (!results[j].ok) {
        const nr = better.get(`${results[j].domain}|${results[j].ip}`);
        if (nr) results[j] = { ...nr, passedRetry: true };
      }
    }
  }
  return results;
}
