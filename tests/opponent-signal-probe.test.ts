import {describe,it,expect} from 'vitest';
import {createOpponentSignalProbe} from '../src/recognition/opponent-signal-probe';
const packet=(key:string,value:unknown)=>({type:'info',category:'game_info',key,value:JSON.stringify(value)});
describe('passive opponent signal discovery (synthetic fields, not verified GEP contracts)',()=>{
  it('preserves an unknown roster flag changing after the initial contract sample window',()=>{
    const probe=createOpponentSignalProbe(),row={summoner:'a',tag_line:'test',health:100,xp:4,synthetic_flag:false};
    expect(probe.observe(packet('tft_roster',[row]),true,0)?.extraRosterFields).toContainEqual({path:'$[].synthetic_flag',type:'boolean'});
    for(let i=1;i<=20;i++)expect(probe.observe(packet('tft_roster',[{...row,health:100-i,xp:4+i}]),true,i*300)).toBeNull();
    const changed=probe.observe(packet('tft_roster',[{...row,health:70,synthetic_flag:true}]),true,7000)!;
    expect(JSON.parse(changed.sample)[0].synthetic_flag).toBe(true);expect(changed.interpretation).toBe('unverified-contract-only');expect(changed).not.toHaveProperty('weights');
  });
  it('keeps new rejected event payloads without claiming that they carry opponent eligibility',()=>{
    const probe=createOpponentSignalProbe(),frame=packet('undocumented_event',{mask:5});
    expect(probe.observe(frame,true,0)).toBeNull();
    expect(probe.observe(frame,false,300)).toMatchObject({accepted:false,fields:{'$.mask':'number'},sample:'{"mask":5}'});
    expect(probe.observe(frame,false,1000)).toBeNull();
  });
  it('records round boundaries and resamples unchanged flags in the next round',()=>{
    const probe=createOpponentSignalProbe(),roster=packet('tft_roster',[{summoner:'a',tag_line:'x',synthetic_flag:1}]);
    probe.observe(packet('tft_round',{stage:'3-2'}),true,0);
    expect(probe.observe(roster,true,300)?.round).toBe('3-2');
    probe.observe(packet('tft_round','3-3'),true,600);
    expect(probe.observe(roster,true,900)?.round).toBe('3-3');
    expect(probe.observe(packet('tft_opp','scouted#x'),true,1200)).toMatchObject({key:'tft_opp',interpretation:'unverified-contract-only'});
  });
  it('deduplicates updates, retries throttled changes on a later frame, and rejects huge payloads',()=>{
    const probe=createOpponentSignalProbe();probe.observe(packet('opponent_flags',{flag:0}),false,0);
    expect(probe.observe(packet('opponent_flags',{flag:1}),false,1)).toBeNull();
    expect(probe.observe(packet('opponent_flags',{flag:1}),false,300)?.sample).toBe('{"flag":1}');
    expect(probe.observe(packet('opponent_flags','x'.repeat(65537)),false,1000)).toBeNull();
  });
});
