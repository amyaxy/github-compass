<script setup lang="ts">
/**
 * 内置描边图标（Lucide 风格 24px 网格，currentColor，零第三方依赖）。
 * 用法：<Icon name="radar" :size="18" />
 */
type Shape =
  | { t: 'p'; d: string }
  | { t: 'pf'; d: string }
  | { t: 'c'; cx: number; cy: number; r: number }
  | { t: 'r'; x: number; y: number; w: number; h: number; rx?: number }
  | { t: 'e'; cx: number; cy: number; rx: number; ry: number };

const ICONS: Record<string, Shape[]> = {
  compass: [
    { t: 'c', cx: 12, cy: 12, r: 9 },
    { t: 'pf', d: 'M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z' },
  ],
  dashboard: [
    { t: 'r', x: 3, y: 3, w: 8, h: 8, rx: 2 },
    { t: 'r', x: 14, y: 3, w: 7, h: 4.5, rx: 1.6 },
    { t: 'r', x: 14, y: 10.5, w: 7, h: 10.5, rx: 1.6 },
    { t: 'r', x: 3, y: 14, w: 8, h: 7, rx: 2 },
  ],
  radar: [
    { t: 'c', cx: 12, cy: 12, r: 9 },
    { t: 'c', cx: 12, cy: 12, r: 1.4 },
    { t: 'p', d: 'M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21' },
    { t: 'p', d: 'M12.9 11.1l4.4-4.4' },
  ],
  history: [
    { t: 'p', d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' },
    { t: 'p', d: 'M3 3v5h5' },
    { t: 'p', d: 'M12 7.5V12l3 2' },
  ],
  settings: [
    { t: 'p', d: 'M4 7h10.5M19.5 7H21M4 17h4.5M14 17h6' },
    { t: 'c', cx: 17, cy: 7, r: 2.2 },
    { t: 'c', cx: 11.5, cy: 17, r: 2.2 },
  ],
  sparkles: [
    { t: 'p', d: 'M11.5 4.5l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z' },
    { t: 'p', d: 'M18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z' },
  ],
  shield: [
    { t: 'p', d: 'M12 3l7 2.8V11c0 4.6-3 7.9-7 10-4-2.1-7-5.4-7-10V5.8z' },
    { t: 'p', d: 'M9 11.6l2.1 2.1 4-4.1' },
  ],
  activity: [{ t: 'p', d: 'M3 12h4l2.5-6.5 4 13L16.5 12H21' }],
  refresh: [
    { t: 'p', d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' },
    { t: 'p', d: 'M21 3v5h-5' },
    { t: 'p', d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' },
    { t: 'p', d: 'M3 21v-5h5' },
  ],
  zap: [{ t: 'p', d: 'M13 2L4.7 13.2h5.6L11 22l8.3-11.2h-5.6z' }],
  check: [{ t: 'p', d: 'M20 6L9.2 16.8 4 11.6' }],
  cross: [{ t: 'p', d: 'M18 6L6 18M6 6l12 12' }],
  alert: [
    { t: 'p', d: 'M13.7 4L21 17a2 2 0 0 1-1.7 3H4.7A2 2 0 0 1 3 17L10.3 4a2 2 0 0 1 3.4 0z' },
    { t: 'p', d: 'M12 9.5v4M12 17h.01' },
  ],
  globe: [
    { t: 'c', cx: 12, cy: 12, r: 9 },
    { t: 'p', d: 'M3 12h18' },
    { t: 'e', cx: 12, cy: 12, rx: 4.2, ry: 9 },
  ],
  database: [
    { t: 'e', cx: 12, cy: 5.5, rx: 8, ry: 3 },
    { t: 'p', d: 'M4 5.5v13c0 1.66 3.58 3 8 3s8-1.34 8-3v-13' },
    { t: 'p', d: 'M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3' },
  ],
  clock: [{ t: 'c', cx: 12, cy: 12, r: 9 }, { t: 'p', d: 'M12 7v5l3.2 2' }],
  download: [{ t: 'p', d: 'M12 3.5v11M7 10l5 5 5-5M4.5 20h15' }],
  filetext: [
    { t: 'p', d: 'M7 3h7l4.5 4.5V21H7z' },
    { t: 'p', d: 'M14 3v5h4.5' },
    { t: 'p', d: 'M10 13h7.5M10 17h5.5' },
  ],
  play: [{ t: 'p', d: 'M7 4.6l12 7.4-12 7.4z' }],
  copy: [
    { t: 'r', x: 9, y: 9, w: 12, h: 12, rx: 2.5 },
    { t: 'p', d: 'M5.5 15H4.6A1.6 1.6 0 0 1 3 13.4V4.6C3 3.7 3.7 3 4.6 3h8.8C14.3 3 15 3.7 15 4.6v.9' },
  ],
  pin: [
    { t: 'p', d: 'M12 21.5S5.5 15.4 5.5 10.5a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z' },
    { t: 'c', cx: 12, cy: 10.4, r: 2.4 },
  ],
  info: [{ t: 'c', cx: 12, cy: 12, r: 9 }, { t: 'p', d: 'M12 11.2v5M12 7.8h.01' }],
  min: [{ t: 'p', d: 'M5 12.5h14' }],
  max: [{ t: 'r', x: 5, y: 5.5, w: 14, h: 13, rx: 2 }],
  x: [{ t: 'p', d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' }],
};

const props = withDefaults(defineProps<{ name: keyof typeof ICONS | string; size?: number; weight?: number }>(), {
  size: 16,
  weight: 1.9,
});
</script>

<template>
  <svg
    class="ic"
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    :stroke-width="props.weight"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-for="(s, i) in ICONS[props.name] ?? []" :key="i">
      <path v-if="s.t === 'p'" :d="s.d" />
      <path v-else-if="s.t === 'pf'" :d="s.d" fill="currentColor" stroke="none" />
      <circle v-else-if="s.t === 'c'" :cx="s.cx" :cy="s.cy" :r="s.r" />
      <rect v-else-if="s.t === 'r'" :x="s.x" :y="s.y" :width="s.w" :height="s.h" :rx="s.rx ?? 2" />
      <ellipse v-else :cx="s.cx" :cy="s.cy" :rx="s.rx" :ry="s.ry" />
    </template>
  </svg>
</template>

<style scoped>
.ic {
  display: inline-block;
  vertical-align: -3px;
  flex: none;
}
</style>
