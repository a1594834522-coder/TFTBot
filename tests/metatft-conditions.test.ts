import {describe,it,expect} from 'vitest';
import {explorerConditionUrl,conditionalPlacementSummary,createMetatftClient} from '../src/core/metatft';
const query={queue:1100 as const,patch:'18.4',bPatch:'b'};
describe('verified official Explorer parameter family',()=>{
  it('uses singular _unique keys, preserves repeat filters and encodes exclusion literally',()=>{
    const url=new URL(explorerConditionUrl('total',{...query,units:[{id:'DA_18_Kayle'},{id:'DA_18_Leona',exclude:true}],items:[{id:'DA_GuinsoosRageblade'}]}));
    expect(url.searchParams.getAll('unit_unique')).toEqual(['DA_18_Kayle-1','!DA_18_Leona-1']);
    expect(url.searchParams.get('item_unique')).toBe('DA_GuinsoosRageblade-1');expect(url.searchParams.has('units')).toBe(false);
    expect(url.searchParams.get('formatnoarray')).toBe('true');
  });
  it('refuses ambiguous or injectable IDs rather than silently generating a different condition',()=>{
    expect(()=>explorerConditionUrl('total',{...query,units:[{id:'A&item=B'}]})).toThrow();
    expect(()=>explorerConditionUrl('../total',query)).toThrow();
  });
  it('keeps carrier identity and star/item-count conditions separate and encodes ampersands once',()=>{
    const raw=explorerConditionUrl('total',{...query,holderItems:[{unit:'DA_18_Kayle',item:'DA_GuinsoosRageblade'}],unitStates:[{unit:'DA_18_Kayle',star:3},{unit:'DA_18_Leona',star:2,numItems:0,exclude:true}]});
    const params=new URL(raw).searchParams;
    expect(params.get('unit_item_unique')).toBe('DA_18_Kayle-1&DA_GuinsoosRageblade-1');
    expect(raw).toContain('%26');expect(raw).not.toContain('%2526');
    expect(params.getAll('unit_tier_numitems_unique')).toEqual(['DA_18_Kayle-1_3_.*','!DA_18_Leona-1_2_0']);
    expect(params.has('item_unique')).toBe(false);
    expect(()=>explorerConditionUrl('total',{...query,holderItems:[{unit:'A&x=B',item:'C'}]})).toThrow();
    expect(()=>explorerConditionUrl('total',{...query,unitStates:[{unit:'A',star:5 as 3}]})).toThrow();
  });
  it('parses the actual eight placement buckets and preserves empty evidence as unknown',()=>{
    expect(conditionalPlacementSummary({data:[{placement_count:[1,2,3,4,5,6,7,8]}]})).toMatchObject({count:36,mean:204/36,top4:10/36});
    expect(conditionalPlacementSummary({data:[{placement_count:Array(8).fill(0)}]})).toMatchObject({count:0,mean:null,first:null,top4:null});
    expect(conditionalPlacementSummary({data:[{placement_count:[null,1]}]})).toBeNull();
  });
  it('sends conditions through the ordinary authenticated-header client and cache',async()=>{
    let seen='';const client=createMetatftClient({fetchImpl:async(url)=>{seen=String(url);return {ok:true,status:200,text:async()=>JSON.stringify({data:[{placement_count:Array(8).fill(1)}]})} as Response;}});
    const response=await client.conditionalExplorer('total',{...query,units:[{id:'DA_18_Kayle'}]});
    expect(conditionalPlacementSummary(response)?.count).toBe(8);expect(new URL(seen).searchParams.get('unit_unique')).toBe('DA_18_Kayle-1');
  });
});
