import { createApp } from 'vue';
import { router } from './router';
import './styles.css';
import App from './App.vue';

const app = createApp(App);
app.use(router);
// 等待初始导航（'/' → '/dash' redirect）完成后再挂载，避免 router-view 首帧空渲染
router.isReady().then(() => app.mount('#app'));
