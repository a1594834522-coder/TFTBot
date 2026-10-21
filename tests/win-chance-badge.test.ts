import {describe,it,expect} from 'vitest';
import {createSSRApp,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import WinChanceBadge from '../src/desktop/WinChanceBadge.vue';
import {emptyBattleForecast,type BattleForecast} from '../src/game/battle-forecast';
const render=(forecast?:BattleForecast)=>renderToString(createSSRApp({render:()=>h(WinChanceBadge,{forecast})}));
describe('next-fight HUD evidence',()=>{
  it('does not present an all-opponent average as next-fight chance',async()=>{
    const html=await render({...emptyBattleForecast(),phase:'ready',weightSource:'uniform',winRate:.76,coverage:1,lower:.76,upper:.76});
    expect(html).toContain('对手待识别');expect(html).toMatch(/<b\b[^>]*>—<\/b>/);expect(html).not.toContain('76%');
    expect(html).toContain('展开查看全场参考');
  });
  it('shows native candidate chance and keeps missing candidate mass as an interval',async()=>{
    const base={...emptyBattleForecast(),phase:'ready' as const,weightSource:'native' as const};
    expect(await render({...base,winRate:.76,coverage:1})).toMatch(/<b\b[^>]*>76%<\/b>/);
    const partial=await render({...base,winRate:null,coverage:.75,lower:.6,upper:.85});
    expect(partial).toContain('下场');expect(partial).toMatch(/<b\b[^>]*>60%–85%<\/b>/);
  });
  it('distinguishes manual opponents and never claims candidates while waiting',async()=>{
    expect(await render({...emptyBattleForecast(),phase:'ready',weightSource:'manual',winRate:.5})).toContain('手选');
    expect(await render()).toContain('对手待识别');
  });
});
