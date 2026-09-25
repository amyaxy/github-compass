/**
 * 东八区 ISO 格式（带 +08:00 偏移，机器可直接 parse）。
 * 例：2026-09-24T13:32:14+08:00
 * 项目规范：所有时间（含日志与机器字段）统一中国时间，不再使用 UTC Z 格式。
 */
export function formatCst(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 3600_000);
  return shifted.toISOString().slice(0, 19) + '+08:00';
}

/**
 * 东八区紧凑时间戳（毫秒精度），专用于文件名/ID：
 * 例：2026-09-25T23-11-43-521（无冒号/点/加号，文件系统安全）
 */
export function formatCstFileStamp(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 3600_000);
  return shifted.toISOString().slice(0, 23).replace(/[:.]/g, '-');
}
