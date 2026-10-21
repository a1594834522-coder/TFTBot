<script setup lang="ts">
import type {ShoppingTactics} from '../decision/shopping-tactics';
import {dataset} from '../game/tft-data';
defineProps<{advice?:ShoppingTactics}>();
const name=(id:string)=>dataset.characterById(id)?.display_name??'待更新';
const percent=(n:number)=>Math.round(n*100)+'%';
</script>
<template><section class="shopping-tactics" data-shopping-tactics :data-ready="advice?.ready??false">
  <header><h2>当前商店</h2><small v-if="advice?.ready" :title="`比较 ${advice.searchedPlans} 套合法购买组合、${advice.searchedBoards} 个场上棋盘；最多换下 ${advice.maxSwaps} 张牌。`">{{ advice.provisional?'常规规则参考':'本地模型' }}</small></header>
  <div v-if="advice?.ready" class="tactical-grid">
    <article v-for="choice in advice.choices" :key="choice.id" :data-tactical-choice="choice.id">
      <header><strong>{{ choice.title }}</strong><span>余 <b>{{ choice.goldAfter }}</b> 金</span></header>
      <div class="tactical-purchases"><template v-if="choice.buy.length"><span v-for="buy in choice.buy" :key="buy.id" :title="name(buy.id)+' · 商店第 '+buy.slots.map(s=>s+1).join('、')+' 格'"><img :src="dataset.characterById(buy.id)?.image_path" :alt="name(buy.id)"/><b>×{{ buy.quantity }}</b></span></template><small v-else>无需购买</small></div>
      <footer><span :title="'同一对手分布下的单场模型估计；不是最终名次或前四率。'+advice.gaps.join(' · ')">{{ advice.weightSource==='uniform'?'全场':'下场' }} <b>{{ choice.winRate===null?'待补齐':percent(choice.winRate) }}{{ advice.gaps.length?'*':'' }}</b><i v-if="choice.delta!==null">{{ choice.delta>=0?'+':'' }}{{ (choice.delta*100).toFixed(1) }}pt</i></span><small :title="'利息分支：落败 '+choice.interestIfLose+'，获胜 '+choice.interestIfWin">息 {{ choice.interestIfLose }}{{ choice.interestIfWin!==choice.interestIfLose?'–'+choice.interestIfWin:'' }}</small></footer>
      <details><summary>看上场</summary><div class="tactical-lineup"><span v-for="(id,i) in choice.onBoard" :key="id+i" :title="name(id)+' · '+choice.onBoardStars[i]+'星'"><img :src="dataset.characterById(id)?.image_path" :alt="name(id)"/><small>{{ '★'.repeat(choice.onBoardStars[i]) }}</small></span></div></details>
    </article>
  </div>
  <p v-else>{{ advice?.reason??'等待金币与场上棋盘' }}</p>
</section></template>
<style scoped>
.tactical-lineup>span{display:flex;flex-direction:column;align-items:center;gap:3px}.tactical-lineup>span>small{font-size:7px;color:#bba66d;line-height:1}
.shopping-tactics{margin:0 0 28px;padding:18px 20px;background:#141b22;border:1px solid #2e3740;border-radius:8px}.shopping-tactics>header,.tactical-grid article>header,.tactical-grid footer{display:flex;justify-content:space-between;align-items:center}.shopping-tactics h2{font-size:14px;font-weight:500;color:#cbd1cb;margin:0}.shopping-tactics>header>small{font-size:9px;color:#667b87}.tactical-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:16px}.tactical-grid article{background:#111820;border:1px solid #293641;border-radius:5px;padding:13px}.tactical-grid article strong{font-size:11px;font-weight:500;color:#b7c4b6}.tactical-grid article header>span{font-size:10px;color:#70808f}.tactical-grid article header b{color:#cfbea0;font-weight:500}.tactical-purchases{display:flex;align-items:center;gap:8px;min-height:45px;margin:12px 0}.tactical-purchases>span{position:relative;display:block;width:32px;height:32px}.tactical-purchases img{width:100%;height:100%;object-fit:cover;border-radius:3px;border:1px solid #8e8b68}.tactical-purchases b{position:absolute;bottom:-4px;right:-6px;font-size:8px;line-height:13px;background:#b1a37b;color:#0f1820;padding:0 3px;border-radius:2px}.tactical-purchases>small{font-size:10px;color:#637889}.tactical-grid footer{font-size:10px;color:#6e8495}.tactical-grid footer b{font-size:13px;font-weight:500;color:#bbccb6;margin-left:5px}.tactical-grid footer i{font-size:9px;font-style:normal;color:#8ea792;margin-left:8px}.tactical-grid footer small{font-size:9px;color:#a39274}.tactical-grid details{font-size:9px;color:#5f7382;margin-top:12px}.tactical-grid summary{cursor:pointer}.tactical-lineup{display:flex;gap:5px;margin-top:10px;flex-wrap:wrap}.tactical-lineup img{width:25px;height:25px;object-fit:cover;border:1px solid #4a5664;border-radius:3px}.shopping-tactics>p{font-size:10px;color:#617587;margin:12px 0 0}
</style>
