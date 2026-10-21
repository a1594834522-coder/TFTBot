export interface AdvisorPreferences {items:string[];stage:number|null;boardId:string|null;searchBudget?:number|null}
export const defaultAdvisorPreferences=():AdvisorPreferences=>({items:[],stage:null,boardId:null,searchBudget:null});
