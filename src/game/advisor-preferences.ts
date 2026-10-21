export interface PurchaseSelection {context:string;id:string}
export interface AdvisorPreferences {items:string[];stage:number|null;boardId:string|null;searchBudget?:number|null;purchase?:PurchaseSelection|null}
export const defaultAdvisorPreferences=():AdvisorPreferences=>({items:[],stage:null,boardId:null,searchBudget:null,purchase:null});
