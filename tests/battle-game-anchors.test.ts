import {it,expect} from 'vitest';
import {createSSRApp,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import BattleGameAnchors from '../src/desktop/BattleGameAnchors.vue';
import {emptyBattleForecast} from '../src/game/battle-forecast';
import type {ReaderStatus} from '../src/recognition/status';
it('keeps per-opponent predictions separate from a candidate-weighted headline and uses identified rows',async()=>{
  const status={cards:{round:'4-1'},opponentVision:{round:'4-1',at:Date.now(),message:'test',rows:[{id:'b',y:.25},{id:'a',y:.5}],candidates:['a']}} as ReaderStatus;
  const forecast={...emptyBattleForecast(),phase:'ready' as const,round:'4-1',weightSource:'vision' as const,winRate:.8,opponents:[{id:'a',name:'甲',weight:1,winRate:.8,gaps:[]},{id:'b',name:'乙',weight:0,winRate:.2,gaps:[]}]};
  const render=()=>renderToString(createSSRApp({render:()=>h(BattleGameAnchors,{status,forecast})}));
  const html=await render();expect(html).toContain('80%');expect(html).toContain('20%');expect(html).toContain('top:25%');
  forecast.weightSource='uniform' as any;forecast.winRate=.5;
  const fallback=await render();expect(fallback).not.toMatch(/<b\b[^>]*>50%<\/b>/);expect(fallback).toContain('20%');
});
