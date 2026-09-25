<script setup lang="ts">
import { cstDateTime } from './time';
import { ref } from 'vue';
import { compass } from './api';
import { actions, store } from './store';
import Icon from './Icon.vue';

const selected = ref('');
const confirming = ref('');
const diff = ref<{ prefix: string[]; removed: string[]; added: string[]; suffix: string[] } | null>(null);
const loading = ref(false);

/** 朴素行级 diff：公共前缀/后缀之外视为删增块（hosts 仅标记块变化，足够） */
function diffLines(before: string, after: string) {
  const a = before.split('\n');
  const b = after.split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return {
    prefix: a.slice(0, s),
    removed: a.slice(s, a.length - e),
    added: b.slice(s, b.length - e),
    suffix: a.slice(a.length - e),
  };
}

async function preview(path: string): Promise<void> {
  loading.value = true;
  try {
    const d = await compass.diffBackup(path);
    diff.value = diffLines(d.before, d.after);
    selected.value = path;
  } finally {
    loading.value = false;
  }
}

async function doRollback(path: string): Promise<void> {
  if (confirming.value !== path) {
    confirming.value = path;
    setTimeout(() => (confirming.value === path ? (confirming.value = '') : null), 4000);
    return;
  }
  confirming.value = '';
  await actions.rollback(path);
}
</script>

<template>
  <div>
  <h2 class="view-title"><Icon name="history" :size="19" />备份回滚</h2>
  <p class="view-sub">每次写入前自动备份 hosts 原文 · 回滚同样先备份当前内容</p>

  <section class="card tablewrap">
    <table>
      <thead>
        <tr><th>备份时间</th><th>触发</th><th>写入版本</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="b in store.backups" :key="b.id">
          <td class="mono">{{ cstDateTime(b.createdAt) }}</td>
          <td>
            <span class="badge" :class="b.trigger === 'rollback' ? 'warn' : 'ok'">
              <Icon :name="b.trigger === 'rollback' ? 'refresh' : 'play'" :size="12" />{{ b.trigger }}
            </span>
          </td>
          <td>{{ b.version ? `v${b.version}` : '—' }}</td>
          <td>
            <button class="btn sm" @click="preview(b.path)"><Icon name="filetext" :size="13" />预览 diff</button>
            <button
              class="btn sm"
              :class="{ primary: confirming === b.path }"
              :disabled="store.busy"
              style="margin-left: 6px"
              @click="doRollback(b.path)"
            >
              {{ confirming === b.path ? '再次点击确认' : '↺ 回滚' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="store.backups.length === 0" class="empty">
      <Icon name="shield" :size="30" :weight="1.4" />
      暂无备份
      <small>首次更新 hosts 前会自动留档，此处即是你的后悔药</small>
    </div>
  </section>

  <section v-if="diff" class="card">
    <h3><Icon name="filetext" :size="15" />diff 预览 · <span class="mono" style="font-size: 12px">{{ selected.split(/[\\/]/).pop() }}</span></h3>
    <div class="diff">
      <pre>// 备份时内容
<template v-for="(l, i) in diff.prefix" :key="'p'+i">{{ l }}
</template><span v-for="(l, i) in diff.removed" :key="'r'+i" class="del">- {{ l }}
</span><template v-for="(l, i) in diff.suffix" :key="'s'+i">{{ l }}
</template></pre>
      <pre>// 当前 hosts
<template v-for="(l, i) in diff.prefix" :key="'p2'+i">{{ l }}
</template><span v-for="(l, i) in diff.added" :key="'a'+i" class="add">+ {{ l }}
</span><template v-for="(l, i) in diff.suffix" :key="'s2'+i">{{ l }}
</template></pre>
    </div>
    <p style="margin-top: 12px">
      <span class="muted" style="font-size: 12.5px">
        <Icon name="info" :size="13" /> 回滚需系统授权（UAC / 密码框），执行前会再备份当前内容
      </span>
    </p>
  </section>
  <p v-else-if="loading" class="muted"><Icon name="refresh" :size="14" /> 读取 diff…</p>
  </div>
</template>
