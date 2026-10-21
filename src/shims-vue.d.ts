// 对纯 `tsc` 的 .vue 垫片（vue-tsc 会自己做完整类型检查）
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, any>, Record<string, any>, any>;
  export default component;
}
