import { expect, it } from 'vitest';
import { compsFromOptions, entryToComp } from '../src/game/metatft-comps';
const buckets = {8:[{units_list:'DA_18_Kayle&DA_18_Leona',traits_list:'DA_18_Inferno_2',count:1062,avg:3.0085}]};
it('使用一次 comp_options 返回的聚类汇总，不使用具体棋盘子样本',()=>{
  const [comp] = compsFromOptions({results:{options:{426021:buckets},overall:{426021:[{count:24624,avg:4.436}]}}}, {
    clusterId:426,set:18,clusterNames:[{Cluster:426021,name:[{name:'DA_18_Rapidfire',type:'trait'},{name:'DA_18_Kayle',type:'unit'}]}],
  });
  expect(comp).toMatchObject({name:'迅捷射手 凯尔',games:24624,avgPlace:4.436});
  expect(comp.winRate).toBeUndefined();expect(comp.top4).toBeUndefined();
});
it('当前 placements 是汇总对象数组，不能当作八个名次桶',()=>{
  expect(entryToComp(426,'426021',buckets,{details:{placements:[{count:24624,avg:4.436}]}})).toMatchObject({games:24624,avgPlace:4.436});
});
it('没有聚类汇总时不把棋盘子样本冒充阵容总样本',()=>{
  const c=entryToComp(426,'426021',buckets)!;
  expect(c.games).toBeUndefined();expect(c.avgPlace).toBeUndefined();
});
it('支持旧版八名次桶，且不推导汇总未提供的胜率',()=>{
  const c=entryToComp(426,'426021',buckets,{details:{placements:[10,10,10,10,10,10,10,10]}})!;
  expect(c).toMatchObject({games:80,avgPlace:4.5,winRate:.125,top4:.5});
});
