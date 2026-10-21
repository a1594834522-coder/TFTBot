import {expect,it} from 'vitest';
import {createSSRApp,h} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {overlayModel} from '../src/game/overlay-model';
import {buildSnapshot} from '../src/game/roster';
import {resolveSelectedComp} from '../src/game/selected-comp';
import type {ReaderStatus} from '../src/recognition/status';
import CompanionOverlay from '../src/desktop/CompanionOverlay.vue';
function status():ReaderStatus{return {phase:'receiving',message:'test',transport:'original-native',testMode:true,frames:1,lastFrameAt:1,cards:{shop:[],augments:[],pickedAugment:null,shopReady:true,augmentsReady:false,level:6},tracker:{revision:1,snapshot:buildSnapshot([{summoner:'A',health:100}],[{summoner:'A',champions:[{name:'DA_18_Kayle',level:2}]}])}};}
it('头像剩余数与全场牌池一致，金币使用真实等级；无等级不假设8级',()=>{
  const s=status(),m=overlayModel(s),card=m.card('DA_18_Kayle');
  expect(m.complete).toBe(true);expect(card.remaining).toBe(22);expect(card.result?.meanGold).toBeGreaterThan(0);
  s.cards.level=null;expect(overlayModel(s).card(card.id).result).toBeNull();
});
it('明细不完整和未知单位时不显示精确剩余数或金币',()=>{
  const s=status();s.tracker!.snapshot!.players[0].coverage='partial';
  expect(overlayModel(s).card('DA_18_Kayle')).toMatchObject({remaining:undefined,result:null});
  s.tracker!.snapshot!.players[0].coverage='full';s.tracker!.snapshot!.players[0].champions[0].name='unknown';
  expect(overlayModel(s).complete).toBe(false);expect(overlayModel(null).complete).toBe(false);
});
it('默认浮窗只有主线，主动选择后才增加过渡，不重复商店或常驻金币说明',async()=>{
  const comp=resolveSelectedComp('metatft:metatft:426:426021')!;
  const html=await renderToString(createSSRApp({render:()=>h(CompanionOverlay,{comp,status:status(),state:{visible:true,collapsed:false,locked:false}})}));
  expect((html.match(/data-overlay-unit=/g)??[]).length).toBe(comp.units.length);
  const chosen=resolveSelectedComp(comp.key,comp.transitions![0].id)!;
  const selectedHtml=await renderToString(createSSRApp({render:()=>h(CompanionOverlay,{comp:chosen,status:status(),state:{visible:true,collapsed:false,locked:false}})}));
  expect((selectedHtml.match(/data-overlay-unit=/g)??[]).length).toBe(chosen.units.length+chosen.transitions![0].units.length);
  expect(html).not.toContain('data-mini-shop');expect(html).not.toContain('data-overlay-budget');expect(html).not.toContain('<footer');
});
