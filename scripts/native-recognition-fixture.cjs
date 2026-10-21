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
const server = new native.IpcConnection(process.env.TFTBOT_TEST_CHANNEL, true, () => {});
server.connect();
console.log('NATIVE_FIXTURE_READY');
const timer = setInterval(() => {
  for (const [key, value] of [['tft_shop', heroes], ['tft_augments', choices], ['tft_roster', [{summoner:'测试玩家',tag_line:'001',health:100,is_locale:true},{summoner:'协议对手',tag_line:'002',health:90}]],['tft_board',{cell_1:{name:heroes[0].name,level:2,item_1:'',item_2:'',item_3:''}}],['tft_bench',{cell_1:{name:heroes[0].name,level:1,item_1:'',item_2:'',item_3:''}}], ['players_info', [{summoner:'测试玩家',tag_line:'001',champions:[{name:heroes[0].name,level:2,area:'board'},{name:heroes[0].name,level:1,area:'bench'}]},{summoner:'协议对手',tag_line:'002',champions:[{name:ids[1],level:2,area:'board',items:[]}]}]],['tft_xp',{xp_level:5,xp_progress:8,xp_progress_max:20}],['tft_gold','31'],['tft_item_bench',[{summoner:'测试玩家',tag_line:'001',bench_items:[]}]],['tft_round','2-5']]) server.send(Buffer.from(JSON.stringify({ type: 'info', category: 'game_info', key, value: JSON.stringify(value) })));
}, 200);
setTimeout(() => { clearInterval(timer); server.destroy(); process.exit(0); }, 40_000);
