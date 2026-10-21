import type {EarlyHoldAdvice} from './comp-advisor';
import type {SelectedComp} from './selected-comp';
/** Product scope agreed 2026-10-21. Archived algorithms remain available for research only. */
export const automaticAdviceEnabled=false;
export const inactiveEarlyHolds=():EarlyHoldAdvice=>({ready:false,cards:[],directions:[],boards:[],stage:2,stageEstimated:true});
export function selectedMainlineOnly(base:SelectedComp|null,_assets?:unknown,requested?:string|null):SelectedComp|null{
  if(requested)throw Error('智能过渡已暂停');
  return base?{...base,transitions:[],transitionId:null,highlightedUnits:[...base.units]}:null;
}
