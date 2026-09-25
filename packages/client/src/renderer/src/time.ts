/** 渲染层时间显示统一东八区（中国时间），不依赖系统时区 */
const TZ = 'Asia/Shanghai';
const timeFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateTimeFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** HH:MM:SS（当前时刻，东八区） */
export function cstTime(d: Date = new Date()): string {
  return timeFmt.format(d);
}
/** 年/月/日 HH:MM:SS（东八区） */
export function cstDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}
/** 年/月/日（东八区） */
export function cstDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}
