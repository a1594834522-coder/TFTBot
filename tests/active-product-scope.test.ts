import {it,expect} from 'vitest';
import {selectedMainlineOnly,inactiveEarlyHolds,automaticAdviceEnabled} from '../src/game/active-product-scope';
import type {SelectedComp} from '../src/game/selected-comp';
it('preserves an explicitly chosen final lineup while removing stale automatic transitions',()=>{
  const original={key:'chosen',name:'主阵容',units:['a','b'],transitions:[{id:'old',units:['c']}],transitionId:'old',highlightedUnits:['a','b','c']} as SelectedComp;
  const selected=selectedMainlineOnly(original)!;
  expect(selected.key).toBe('chosen');expect(selected.units).toEqual(['a','b']);expect(selected.highlightedUnits).toEqual(['a','b']);expect(selected.transitions).toEqual([]);expect(selected.transitionId).toBeNull();
  expect(original.transitionId).toBe('old');expect(selectedMainlineOnly(null)).toBeNull();
  expect(()=>selectedMainlineOnly(original,undefined,'old')).toThrow('暂停');
  expect(automaticAdviceEnabled).toBe(false);expect(inactiveEarlyHolds()).toMatchObject({ready:false,cards:[],boards:[]});
});
