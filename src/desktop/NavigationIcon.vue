<script setup lang="ts">
defineProps<{name:string}>();
const paths:Record<string,string>={
  comps:'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  advisor:'m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z',
  augments:'m13 2-8 12h6l-1 8 9-13h-6l1-7Z',
  board:'M4 4h16v16H4z M4 12h16 M12 4v16',
  settings:'M4 7h16 M4 17h16 M9 4v6 M16 14v6',
  pin:'m9 3 6 0-1 5 4 4v2H6v-2l4-4-1-5Z M12 14v7',
  overlay:'M4 5h16v14H4z M4 9h16 M14 13h3 M14 16h3',
};
</script>
<template><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]??paths.advisor"/></svg></template>
