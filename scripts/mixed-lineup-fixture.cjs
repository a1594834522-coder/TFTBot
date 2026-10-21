// Synthetic physical holdings around one ACTUAL MetaTFT board. No game input,
// screenshots, personal identities or fabricated aggregate statistics.
module.exports.mixedLineupFixture=function(){
  const catalog=require('../data/metatft-direction-catalog.json'),shop=require('../data/current-shop-mechanics.json').units;
  const known=new Set(shop.map(h=>h.id));
  const usable=q=>q.regime==='four-cost'&&q.templates[0]?.poolUnits.length===8&&q.templates[0].poolUnits.every(id=>known.has(id)&&!id.includes('Lux'));
  const profile=catalog.profiles.find(p=>p.pairs.some(usable)),pair=profile?.pairs.find(usable);
  if(!profile||!pair)throw Error('No supported current-season observed fixture');
  const target=pair.templates[0].poolUnits,waiting=[...new Set([pair.carry,pair.tank,...target])].slice(0,4),retained=target.filter(id=>!waiting.includes(id));
  const workers=shop.filter(h=>!target.includes(h.id)&&!h.id.includes('Lux')).sort((a,b)=>a.cost-b.cost||a.id.localeCompare(b.id)).slice(0,4).map(h=>h.id);
  const piece=(name,level,items=[])=>({name,level,item_1:items[0]??'',item_2:items[1]??'',item_3:items[2]??''});
  const board=Object.fromEntries([...retained,...workers].map((id,i)=>['cell_'+(i+1),piece(id,1)]));
  const bench=Object.fromEntries(waiting.map((id,i)=>['cell_'+(i+1),piece(id,2,id===pair.carry?['DA_GuinsoosRageblade']:id===pair.tank?['DA_WarmogsArmor']:[])]));
  const roster=[{summoner:'本方重组示例',tag_line:'demo',health:60,index:0,is_locale:true},{summoner:'对手重组示例',tag_line:'demo',health:75,index:1}];
  const players=[{summoner:roster[0].summoner,tag_line:'demo',champions:[...Object.values(board).map(u=>({...u,area:'board',items:[u.item_1,u.item_2,u.item_3].filter(Boolean)})),...Object.values(bench).map(u=>({...u,area:'bench',items:[u.item_1,u.item_2,u.item_3].filter(Boolean)}))]},{summoner:roster[1].summoner,tag_line:'demo',champions:target.map(name=>({name,level:2,area:'board',items:[]}))}];
  const intent={key:'metatft:'+profile.key,directionId:pair.id,units:target};
  const events=[['tft_roster',roster],['tft_board',board],['tft_bench',bench],['players_info',players],['tft_xp',{xp_level:8,xp_progress:0,xp_progress_max:80}],['tft_gold',20],['tft_round','4-2'],['tft_shop',[workers[0],'Sold','Sold','Sold','DA_18_LostTravelers'].map(name=>({name}))],['tft_item_bench',[{summoner:roster[0].summoner,tag_line:'demo',bench_items:[]}]],['tft_picked_augment',{slot_1:{name:'DA_TradeSector'},slot_2:{name:''},slot_3:{name:''},slot_4:{name:''}}]];
  return {events,intent,board,bench,target,workers,profile:profile.name};
};
