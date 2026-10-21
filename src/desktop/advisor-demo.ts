import {buildSnapshot} from '../game/roster';
import type {ReaderStatus} from '../recognition/status';
export type AdvisorScenario='ap'|'ad'|'contested'|'partial';
/** Explicit synthetic assets for preview/regression; never used by the desktop reader. */
export function advisorDemo(scenario:AdvisorScenario):ReaderStatus {
  const magical=scenario==='ap'||scenario==='partial';
  const roster=Array.from({length:8},(_,i)=>({summoner:'示例玩家'+i,tag_line:'demo',health:80-i*5,index:i,is_locale:i===0}));
  const own=magical?[
    {name:'DA_18_Kayle',level:2,items:['DA_GuinsoosRageblade','DA_RabadonsDeathcap']},
    {name:'DA_18_Leona',level:1,items:[]},{name:'DA_18_Shen',level:1,items:[]},{name:'DA_18_Varus',level:1,items:[]},
  ]:[
    {name:'DA_18_Rengar',level:2,items:['DA_InfinityEdge','DA_LastWhisper']},
    {name:'DA_18_Cassiopeia',level:1,items:[]},{name:'DA_18_Shen',level:1,items:[]},{name:'DA_18_Rammus',level:1,items:[]},
  ];
  const players=roster.map((r,i)=>({summoner:r.summoner,tag_line:r.tag_line,is_locale:i===0,coverage:scenario==='partial'&&i===7?'partial' as const:'full' as const,champions:i===0?own:scenario==='contested'&&i===1?[{name:'DA_18_Rengar',level:3,items:[]},{name:'DA_18_Rengar',level:3,items:[]}]:[]}));
  const shop=['DA_18_Rakan','DA_18_Shen','DA_18_Xayah','DA_18_Varus','DA_18_LostTravelers'].map((id,i)=>({id,name:i===4?'迷路的游客':'示例英雄',known:true,...(i===4?{kind:'wisp' as const,rating:'S'}:{})}));
  return {phase:'receiving',message:'智能定阵设计预览 · 示例数据',transport:'original-native',testMode:true,frames:1,lastFrameAt:Date.now(),cards:{shop,augments:[],pickedAugment:null,shopReady:true,augmentsReady:false,level:5,stage:2,round:'2-3'},tracker:{revision:1,snapshot:buildSnapshot(roster,players)}};
}
