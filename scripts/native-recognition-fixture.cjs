// Explicit test producer on a unique private channel. Never connects to a game.
const native = require('E:/amumu/resources/win64/node-native.node');
const catalog = require('../data/tft-sets.json');
const ratings = require('../data/metatft-augments.raw.json');
const set = Math.max(...Object.keys(catalog.characters).map(Number));
const selected = require('../data/metatft-comps.json').sets[set][0];
const ids = [...new Set([selected.units[0].character_id, ...catalog.characters[set].map(c=>c.character_id)])].slice(0,5);
const heroes = ids.map(name=>({name}));
heroes[4]={name:'DA_18_LostTravelers'};
const picks = ratings.response.content.content.tierList.flatMap(t => t.content).filter(e => e.type === 'augment').slice(0, 3);
const choices = Object.fromEntries(picks.map((a, i) => [`augment_${i + 1}`, { name: a.id }]));
const withAux=process.env.TFTBOT_TEST_COMBAT_AUX==='1';
const board={cell_1:{name:heroes[0].name,level:2,item_1:'',item_2:'',item_3:''}};
const withLanding=process.env.TFTBOT_TEST_LANDING==='1';
const withPurchase=process.env.TFTBOT_TEST_PURCHASE==='1'||withLanding;
const bench={cell_1:{name:heroes[0].name,level:1,item_1:'',item_2:'',item_3:''}};
if(withPurchase){
 for(const [i,name]of ['DA_18_Akali_AD','DA_18_Leona','DA_18_Rakan','DA_18_Varus'].entries())board['cell_'+(i+2)]={name,level:1,item_1:i===0?'DA_InfinityEdge':'',item_2:'',item_3:''};
 bench.cell_2={name:'DA_18_Akali_AD',level:1,item_1:'',item_2:'',item_3:''};
 heroes[1]={name:'DA_18_Akali_AD'};heroes[2]={name:'DA_18_Rengar'};heroes[3]={name:'DA_18_Rakan'};
}
if(withAux){
 board.cell_10={name:'DA_TheTower_TrainingDummy',level:1,item_1:'DA_WarmogsArmor',item_2:'',item_3:''};
 board.cell_11={name:'DA_Elderwood18_Lifeblossom',level:0,item_1:'',item_2:'',item_3:''};
}
const selectedAugments=withAux?[['tft_picked_augment',{slot_1:{name:'DA_TheTower'},slot_2:{name:''},slot_3:{name:''},slot_4:{name:''}}]]:[];
const server = new native.IpcConnection(process.env.TFTBOT_TEST_CHANNEL, true, () => {});
server.connect();
console.log('NATIVE_FIXTURE_READY');
const timer = setInterval(() => {
  for (const [key, value] of [['tft_shop', heroes], ...selectedAugments, ['tft_augments', choices], ['tft_roster', [{summoner:'测试玩家',tag_line:'001',health:100,is_locale:true},{summoner:'协议对手',tag_line:'002',health:90}]],['tft_board',board],['tft_bench',bench], ['players_info', [{summoner:'测试玩家',tag_line:'001',champions:[...Object.values(board).filter(u=>u.name!=='DA_TheTower_TrainingDummy'&&u.name!=='DA_Elderwood18_Lifeblossom').map(u=>({name:u.name,level:u.level,area:'board',items:[u.item_1,u.item_2,u.item_3].filter(Boolean)})),...Object.values(bench).map(u=>({name:u.name,level:u.level,area:'bench',items:[]}))]},{summoner:'协议对手',tag_line:'002',champions:[{name:ids[1],level:2,area:'board',items:[]}]}]],['tft_xp',{xp_level:withLanding?8:5,xp_progress:8,xp_progress_max:withLanding?80:20}],['tft_gold',withLanding?'20':'31'],['tft_item_bench',[{summoner:'测试玩家',tag_line:'001',bench_items:[]}]],['tft_round',withLanding?'4-2':'2-5']]) server.send(Buffer.from(JSON.stringify({ type: 'info', category: 'game_info', key, value: JSON.stringify(value) })));
}, 200);
setTimeout(() => { clearInterval(timer); server.destroy(); process.exit(0); }, 40_000);
