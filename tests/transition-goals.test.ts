import {describe,it,expect} from 'vitest';
import {transitionLibrary,transitionSources,transitionGoals,type TransitionLibrary} from '../src/decision/transition-goals';
const library=():TransitionLibrary=>({meta:{set:'TFTSet18',clusteringId:1,source:'test',overviewUpdated:1},nodes:[{id:'a',stage:2,units:['A','B'],current:{}},{id:'b',stage:2,units:['A','C'],current:{}},{id:'zero',stage:3,units:['D','E'],current:{}},{id:'same',stage:3,units:['A','B'],current:{}}],edges:[{from:'a',to:'zero',current:{battleWeight:70,avgPlace:3.9}},{from:'a',to:'same',current:{battleWeight:20,avgPlace:3}}],exits:[{from:'a',current:{battleWeight:10}}]});
describe('observed transition goals, without an overlap gate',()=>{
  it('retains a completely different future lineup and the excluded/exit mass',()=>{
    const goals=transitionGoals(library(),['a'],30);expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({id:'zero',kind:'collect',targets:[{id:'D',copies:1},{id:'E',copies:1}],evidence:[{weight:70,share:.7,stats:{avgPlace:3.9}}]});
    expect(goals[0]).not.toHaveProperty('winRate');
  });
  it('keeps equal nearest source matches as uncertainty rather than inventing a softmax probability',()=>{
    expect(transitionSources(library(),2,['A','B'])).toEqual([{id:'a',edits:0,exact:true}]);
    expect(transitionSources(library(),2,['A'])).toEqual([{id:'a',edits:1,exact:false},{id:'b',edits:1,exact:false}]);
    expect(transitionSources(library(),2,[])).toEqual([]);
  });
  it('never manufactures a current route from historical outcomes',()=>{
    const l=library();const graph:any={...l,nodes:l.nodes.map(n=>({...n,fullWindow:{items:{secret:1}}})),edges:[{from:'a',to:'zero',current:null,fullWindow:{battleWeight:1000,avgPlace:1}}],exits:[]};
    const compact=transitionLibrary(graph);expect(compact.edges).toEqual([]);expect(JSON.stringify(compact)).not.toContain('secret');expect(transitionGoals(compact,['a'])).toEqual([]);
    graph.edges[0].to='missing';expect(()=>transitionLibrary(graph)).toThrow(/topology/);
  });
  it('separates current route evidence from historical core/star target marginals',()=>{
    const l=library();l.nodes[2].coreTemplate={scope:'full-window-marginals',targets:[{id:'D',copies:3},{id:'E',copies:1}],evidence:[{id:'D',star:2,starWeight:40,gearWeight:90},{id:'E',star:1,starWeight:60,gearWeight:50}]};
    const [goal]=transitionGoals(l,['a'],30,'core');
    expect(goal).toMatchObject({id:'zero:core',kind:'core',templateScope:'full-window-marginals',targets:[{id:'D',copies:3},{id:'E',copies:1}],evidence:[{stats:{avgPlace:3.9}}]});
    expect(transitionGoals(l,['b'],0,'core')).toEqual([]);
  });
});
