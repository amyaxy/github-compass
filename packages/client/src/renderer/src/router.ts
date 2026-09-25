import { createRouter, createWebHashHistory } from 'vue-router';
import Dashboard from './Dashboard.vue';
import ProbeView from './Probe.vue';
import Backup from './Backup.vue';
import SettingsView from './Settings.vue';

export const NAV_ITEMS = [
  { path: '/dash', ico: 'dashboard', label: '仪表盘' },
  { path: '/probe', ico: 'radar', label: '探测详情' },
  { path: '/backup', ico: 'history', label: '备份回滚' },
  { path: '/settings', ico: 'settings', label: '设置' },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dash' },
    { path: '/dash', component: Dashboard },
    { path: '/probe', component: ProbeView },
    { path: '/backup', component: Backup },
    { path: '/settings', component: SettingsView },
  ],
});
