import {describe,it,expect} from 'vitest';
import {parseCompProfile,normalizeRoleTags,type UnitRole} from '../src/decision/comp-profiles';
import {compileDirectionProfiles} from '../src/decision/direction-catalog';
const roles:Record<string,UnitRole>={A:{cost:2,role:'caster',tags:['Role.Magic','Role.Caster'],traits:['X'],shop:true},B:{cost:4,role:'tank',tags:['Role.Tank'],traits:['Y'],shop:true},C:{cost:5,role:'marksman',tags:['Role.Attack','Role.Marksman'],traits:['Z'],shop:true},Dummy:{cost:0,role:'tank',tags:['Role.Tank'],traits:[],shop:false}};
function raw(){return {tft_set:'TFTSet18',queue_id:1100,results:{overall:{count:100,avg:4},unit_stats:[{unit:'A',count:100,num_items:[{num_items:3,count:90}],tiers:[{tier:2,count:20,avg:5},{tier:3,count:80,avg:3.5}]},{unit:'B',count:100,num_items:[{num_items:3,count:70}],tiers:[{tier:2,count:100,avg:4}]},{unit:'Dummy',count:100,num_items:[{num_items:3,count:1000}],tiers:[{tier:1,count:100,avg:4}]}],options:{6:[{units_list:'A&B',count:40,avg:4},{units_list:'A&B&Dummy',count:30,avg:3.8},{units_list:'A&B&C',count:10,avg:3}]},early_options:{4:[{unit_list:'A&Dummy',count:400,avg:4,win:.6},{unit_list:'A&B',count:40,avg:4,win:.5},{unit_list:'B&C',count:30,avg:4,win:.4}]},builds:[{unit:'A',buildName:['item1'],count:40,avg:4},{unit:'A',buildName:['item1','item2','item3'],count:30,avg:3.8}],rerolls:{6:{rerolls:200,matches:20},7:{rerolls:500,matches:50},'-1':{rerolls:-1,matches:10}},final_levels:[{level:'7',count:70,avg:4},{level:'8',count:30,avg:3.5}]}};}
describe('full aggregate comp profiles and strategy regimes',()=>{
  it('keeps supported high-population variants tied to the same observed core and preserves their original statistics',()=>{
    const profile=parseCompProfile('test','测试',raw(),roles),fillers=Array.from({length:6},(_,i)=>'F'+i),units=['A','B',...fillers];
    const extended={...roles,...Object.fromEntries(fillers.map(id=>[id,{cost:1,role:'',tags:[],traits:[],shop:true}]))};
    profile.boards.push({level:9,units,poolUnits:units,count:100,avg:4.2},{level:9,units,poolUnits:units,count:40,avg:3},
      {level:10,units:['A','C',...fillers],poolUnits:['A','C',...fillers],count:1000,avg:2},
      {level:10,units,poolUnits:units,count:29,avg:1});
    const pair=compileDirectionProfiles([profile],extended)[0].pairs.find(p=>p.carry==='A'&&p.tank==='B')!;
    expect(pair.lateTemplates).toHaveLength(1);expect(pair.lateTemplates![0]).toMatchObject({level:9,count:100,avg:4.2,poolUnits:units});
  });
  it('preserves every returned variant and early observation, including generated combat units',()=>{
    const p=parseCompProfile('test','测试',raw(),roles);expect(p.boards).toHaveLength(3);expect(p.early).toHaveLength(3);expect(p.builds).toHaveLength(2);
    expect(p.early[0]).toMatchObject({count:400,units:['A','Dummy'],poolUnits:['A']});expect(p.count).toBe(100);
    expect(p.regime).toMatchObject({primary:'reroll',carry:'A',tank:'B',carryStar:3});expect(p.regime.carry).not.toBe('Dummy');
  });
  it('distinguishes low-cost three-star, four-cost and legendary plans by actual carry/star/level evidence',()=>{
    const d=raw();d.results.unit_stats[0].tiers=[{tier:2,count:95,avg:4},{tier:3,count:5,avg:3}];
    expect(parseCompProfile('x','任意名称',d,roles).regime.primary).toBe('four-cost');
    d.results.unit_stats[0].unit='C';d.results.unit_stats[0].tiers=[{tier:2,count:100,avg:4}];d.results.final_levels=[{level:'9',count:100,avg:4}];
    expect(parseCompProfile('x','任意名称',d,roles).regime).toMatchObject({primary:'legendary',rollLevel:9,carry:'C'});
  });
  it('keeps failed rerolls and a highly equipped cheap tank in the reroll family',()=>{
    const d=raw();d.results.unit_stats[0].tiers=[{tier:2,count:65,avg:6},{tier:3,count:35,avg:4}];
    expect(parseCompProfile('x','测试',d,roles).regime).toMatchObject({primary:'reroll',carryStar:2});
    const tankRoles={...roles,A:{...roles.A,tags:['Role.Tank']}};
    expect(parseCompProfile('x','测试',d,tankRoles).regime).toMatchObject({primary:'reroll',carry:'A'});
  });
  it('keeps missing averages unknown and excludes corrupt rolling statistics',()=>{
    const d=raw();(d.results.options[6][0] as any).avg=null;
    const p=parseCompProfile('x','测试',d,roles);expect(p.boards[0].avg).toBeNull();expect(p.rolling.every(r=>r.level>0&&r.average>=0)).toBe(true);
    d.tft_set='TFTSet17';expect(()=>parseCompProfile('x','测试',d,roles)).toThrow(/scope/);
  });
  it('derives role parents and respects a named cheap focus instead of a slightly more equipped tank',()=>{
    expect(normalizeRoleTags(['Role.Magic.Marksman'])).toEqual(expect.arrayContaining(['Role.Magic','Role.Marksman']));
    const d=raw(),r={...roles,B:{...roles.B,cost:2}};d.results.unit_stats[1].num_items=[{num_items:3,count:95}];d.results.unit_stats[1].tiers=[{tier:2,count:60,avg:5},{tier:3,count:40,avg:3}];
    expect(parseCompProfile('x','named A',d,r,['A']).regime.carry).toBe('A');
  });
  it('rejects a profile from another cluster even when its season matches',()=>{
    const d={...raw(),cluster_id:449};(d.results as any).cluster=449000;
    expect(()=>parseCompProfile('metatft:426:426000','wrong family',d,roles)).toThrow(/identity/);
  });
});
