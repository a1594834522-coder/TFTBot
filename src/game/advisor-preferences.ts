import type {PursuitMode} from '../decision/pursuit-policy';
export interface PurchaseSelection {context:string;id:string}
export interface AdvisorPreferences {items:string[];stage:number|null;boardId:string|null;searchBudget?:number|null;purchase?:PurchaseSelection|null;pursuitMode?:PursuitMode}
export const defaultAdvisorPreferences=():AdvisorPreferences=>({items:[],stage:null,boardId:null,searchBudget:null,purchase:null,pursuitMode:'upgrade-first'});
