/**
 * core 纯函数自测（node + tsx，无网络依赖）。
 * 运行：pnpm core:selftest
 */
import { formatCst, selectBest, classifyFailure } from '../src/index.js';
import type { ProbeResult } from '../src/index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

// 1) formatCst：UTC → 东八区
assert(
  formatCst(new Date('2026-09-24T05:32:14.445Z')) === '2026-09-24T13:32:14+08:00',
  'formatCst 基本换算 +08:00',
);
assert(
  formatCst(new Date('2026-09-24T16:00:00Z')) === '2026-09-25T00:00:00+08:00',
  'formatCst 跨日进位',
);

// 2) selectBest：每域名取最低延迟
const R = (domain: string, ip: string, ok: boolean, latencyMs?: number, error?: string): ProbeResult => ({
  domain, ip, ok, latencyMs, error,
});
const best = selectBest([
  R('github.com', '1.1.1.1', true, 100),
  R('github.com', '2.2.2.2', true, 50),
  R('github.com', '3.3.3.3', false, undefined, 'timeout'),
  R('api.github.com', '4.4.4.4', true, 80),
  R('raw.githubusercontent.com', '5.5.5.5', false, undefined, 'timeout'),
], new Date('2026-09-24T00:00:00Z'));
assert(best.length === 2, 'selectBest 仅保留有通过项的域名');
assert(best[0].domain === 'api.github.com' && best[0].ip === '4.4.4.4', 'selectBest 按域名排序');
assert(best[1].ip === '2.2.2.2' && best[1].latencyMs === 50, 'selectBest 取最低延迟 IP');
assert(best[1].tlsVerified === true && best[1].checkedAt === '2026-09-24T00:00:00.000Z', 'selectBest 字段完整');

// 3) classifyFailure：三类场景
const allCert = [
  R('a.com', '1.1.1.1', false, undefined, 'unable to verify the first certificate'),
  R('a.com', '2.2.2.2', false, undefined, 'self-signed certificate in certificate chain'),
  R('b.com', '3.3.3.3', false, undefined, 'UNABLE_TO_GET_ISSUER_CERT'),
];
assert(classifyFailure(allCert) === 'SSL_INSPECTION_SUSPECTED', '全证书错误 → SSL_INSPECTION_SUSPECTED');

const allTimeout = [
  R('a.com', '1.1.1.1', false, undefined, 'timeout'),
  R('b.com', '2.2.2.2', false, undefined, 'ECONNREFUSED'),
];
assert(classifyFailure(allTimeout) === 'NO_USABLE_IP', '全非证书错误 → NO_USABLE_IP');

const hasOk = [R('a.com', '1.1.1.1', true, 30), R('b.com', '2.2.2.2', false, undefined, 'timeout')];
assert(classifyFailure(hasOk) === null, '存在通过项 → 不判定失败');
assert(classifyFailure([]) === 'NO_USABLE_IP', '空结果 → NO_USABLE_IP');

console.log('CORE SELFTEST PASSED');
