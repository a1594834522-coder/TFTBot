import type {PoolTarget} from './pool-budget';
const choose=(n:number,k:number)=>{if(k<0||k>n)return 0;let value=1;for(let i=1;i<=k;i++)value=value*(n-i+1)/i;return value;};
const factorial=(n:number)=>{let value=1;for(let i=2;i<=n;i++)value*=i;return value;};
const integer=(n:number,min=0)=>Number.isSafeInteger(n)&&n>=min;

/** Shared physical-shop transition law, independent of the decision policy. */
export function createPoolKernel(input:{targets:PoolTarget[];tierRemaining:Record<number,number>;tierOdds:Record<number,number>}){
  const targets=input.targets;let transitions=0;
  if(targets.length>12||new Set(targets.map(t=>t.id)).size!==targets.length)throw new Error('Invalid completion targets');
  for(let cost=1;cost<=5;cost++)if(!integer(input.tierRemaining[cost])||!Number.isFinite(input.tierOdds[cost])||input.tierOdds[cost]<0||input.tierOdds[cost]>1)throw new Error('Invalid cost pool/odds');
  if(Object.keys(input.tierOdds).some(k=>!['1','2','3','4','5'].includes(k))||Math.abs(Object.values(input.tierOdds).reduce((n,p)=>n+p,0)-1)>1e-8)throw new Error('Cost odds must sum to one');
  for(const t of targets)if(!t.id||!integer(t.cost,1)||t.cost>5||!integer(t.needed)||t.needed>9||!integer(t.remaining)||!integer(t.price))throw new Error('Invalid completion target');
  for(let cost=1;cost<=5;cost++)if(targets.filter(t=>t.cost===cost).reduce((n,t)=>n+t.remaining,0)>input.tierRemaining[cost])throw new Error('Target cards exceed physical cost pool');
  const strides:number[]=[];let size=1,root=0;
  targets.forEach(t=>{strides.push(size);root+=t.needed*size;size*=t.needed+1;});
  if(size>4096)throw new Error('Completion state space exceeds 4096; split explicit core targets');
  const decoded=new Map<number,number[]>();
  const decode=(code:number)=>{let result=decoded.get(code);if(!result){result=targets.map((t,i)=>Math.floor(code/strides[i])%(t.needed+1));decoded.set(code,result);}return result;};
  const costs=[...new Set(targets.filter(t=>t.needed>0).map(t=>t.cost))].sort(),byCost=costs.map(cost=>targets.flatMap((t,i)=>t.cost===cost?[i]:[]));
  const plans=new Map<number,Array<{counts:number[];mass:number}>>();
  function costPlans(slots:number){
    const cached=plans.get(slots);if(cached)return cached;
    const probabilities=costs.map(c=>input.tierOdds[c]);probabilities.push(Math.max(0,1-probabilities.reduce((n,p)=>n+p,0)));
    const list:Array<{counts:number[];mass:number}>=[],counts:number[]=[];
    function next(index:number,left:number,mass:number){
      if(index===probabilities.length-1){const p=probabilities[index];if(left&&p===0)return;const value=mass*p**left/factorial(left)*factorial(slots);if(value>0)list.push({counts:[...counts],mass:value});return;}
      for(let k=0;k<=left;k++){const p=probabilities[index];if(k&&p===0)continue;counts.push(k);next(index+1,left-k,mass*p**k/factorial(k));counts.pop();}
    }
    next(0,slots,1);plans.set(slots,list);return list;
  }
  const distributions=new Map<string,Array<{next:number;probability:number}>>();
  function outcomes(code:number,slots:number){
    const key=code+':'+slots,cached=distributions.get(key);if(cached)return cached;
    const needed=decode(code),acquired=targets.map((t,i)=>t.needed-needed[i]),pool={...input.tierRemaining};
    targets.forEach((t,i)=>pool[t.cost]-=acquired[i]);
    // The provider does not establish how an exhausted cost pool is reassigned.
    for(let cost=1;cost<=5;cost++)if(input.tierOdds[cost]>0&&pool[cost]<slots)throw new Error('Cost-pool exhaustion needs an explicit replacement rule');
    const groupOutcomes=new Map<string,Array<{delta:number;mass:number}>>();
    function group(groupIndex:number,draws:number){
      const groupKey=groupIndex+':'+draws,hit=groupOutcomes.get(groupKey);if(hit)return hit;
      const cost=costs[groupIndex],active=byCost[groupIndex].filter(i=>needed[i]>0),n=pool[cost];
      if(!active.length||!draws){const value=[{delta:0,mass:1}];groupOutcomes.set(groupKey,value);return value;}
      const remaining=active.map(i=>targets[i].remaining-acquired[i]),other=n-remaining.reduce((sum,r)=>sum+r,0),denominator=choose(n,draws),sums=new Map<number,number>();
      function draw(index:number,left:number,delta:number,mass:number){
        if(index===active.length){const ways=choose(other,left);if(ways){const probability=mass*ways/denominator;sums.set(delta,(sums.get(delta)??0)+probability);}return;}
        const i=active[index];
        for(let count=0;count<=Math.min(remaining[index],left);count++)draw(index+1,left-count,delta+Math.min(count,needed[i])*strides[i],mass*choose(remaining[index],count));
      }
      draw(0,draws,0,1);
      const result=[...sums].map(([delta,mass])=>({delta,mass}));groupOutcomes.set(groupKey,result);return result;
    }
    const combined=new Map<number,number>();
    for(const plan of costPlans(slots)){
      function join(index:number,delta:number,mass:number){
        if(index===costs.length){combined.set(code-delta,(combined.get(code-delta)??0)+mass);return;}
        for(const entry of group(index,plan.counts[index]))join(index+1,delta+entry.delta,mass*entry.mass);
      }
      join(0,0,plan.mass);
    }
    const result=[...combined].filter(([,p])=>p>0).map(([next,probability])=>({next,probability})),mass=result.reduce((n,e)=>n+e.probability,0);
    if(Math.abs(mass-1)>1e-8)throw new Error('Completion transition lost probability mass');
    transitions+=result.length;distributions.set(key,result);return result;
  }
  return {size,root,strides,decode,outcomes,signature:JSON.stringify([input.targets,input.tierRemaining,input.tierOdds]),get transitionCount(){return transitions;}};
}
