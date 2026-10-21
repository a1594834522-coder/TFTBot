import policy from '../../data/battle-unit-policy.json';
import {normalizeShopHero} from './shop-mechanics';
export interface CombatForm {poolId:string;traits:string[];name:string}
export const combatForms=policy.forms as Record<string,CombatForm>;
/** Pool aliases identify physical copies. A battle form may carry different
 * traits even when it shares the same shop champion and embedding. */
export const combatHeroId=(id:string)=>combatForms[id]?id:normalizeShopHero(id);
export const combatFormName=(id:string)=>combatForms[id]?.name??null;
export const combatAuxiliaryName=(id:string)=>(policy.auxiliaries as Record<string,{name:string}>)[id]?.name??'独立单位';
