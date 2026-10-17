<script setup lang="ts">
defineProps<{error?:Error}>();
const emit=defineEmits<{exit:[];close:[]}>();
function back(){emit('exit');emit('close');}
</script>
<template>
  <div class="deferred-tool-status" role="status" aria-live="polite">
    <section>
      <h2>{{error?'工具加载失败':'正在加载工具…'}}</h2>
      <p>{{error?'请返回地图，刷新页面后重试。':'首次进入需要下载相关代码，请稍候。'}}</p>
      <button type="button" @click="back">返回地图</button>
    </section>
  </div>
</template>
<style scoped>
.deferred-tool-status{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:#edf8ffed;padding:24px}
section{max-width:360px;padding:24px;border:1px solid #c8e3f6;border-radius:14px;background:white;color:#173b57;box-shadow:0 12px 40px #163c5520}
h2{font-size:20px;margin:0 0 12px}p{line-height:1.6}button{padding:10px 16px;border:1px solid #b7daee;border-radius:8px;background:#edf8ff;color:#185881;cursor:pointer}
</style>
