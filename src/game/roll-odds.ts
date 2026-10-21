/**
 * Conditional model for the NEXT copy: four or five independent cost draws, then
 * physical copies sampled without replacement within that cost. Between
 * failed paid rerolls, unbought cards are returned and the pool stays fixed.
 * This is a model expectation, excluding purchases and natural/free refreshes.
 */
export function estimateRoll(input: { tierProbability: number; remaining: number; tierRemaining: number; inShop?: boolean;heroSlots?:4|5 }) {
  const { tierProbability: p, remaining: r, tierRemaining: n } = input;
  const slots=input.heroSlots??5;
  if(slots!==4&&slots!==5)throw Error('英雄格数量无效');
  if (![p,r,n].every(Number.isFinite) || p < 0 || p > 1 || !Number.isInteger(r) || !Number.isInteger(n) || r < 0 || r > n) throw new Error('刷牌参数无效');
  if (input.inShop) return { hit: 1, meanGold: 0, gold50: 0, gold90: 0, reason: '商店已有目标英雄' };
  if (!r || !p) return { hit: 0, meanGold: null, gold50: null, gold90: null, reason: !r ? '已知牌池没有剩余副本' : '此等级无法刷到该费用' };
  if (n < slots) return { hit: 0, meanGold: null, gold50: null, gold90: null, reason: '该费用牌池过小，无法确定耗尽后的补位规则' };
  const choose = slots===4?[1,4,6,4,1]:[1,5,10,10,5,1];
  let success = 0;
  for (let k = 1; k <= slots; k++) {
    let logMiss = 0;
    for (let i = 0; i < k; i++) {
      if (n-r-i <= 0) { logMiss = -Infinity; break; }
      logMiss += Math.log1p(-r/(n-i));
    }
    // Sum positive hit probabilities instead of subtracting a number near 1.
    success += choose[k] * p**k * (1-p)**(slots-k) * -Math.expm1(logMiss);
  }
  const hit = Math.min(1, Math.max(0, success));
  const budget = (q: number) => hit >= 1 ? 2 : 2*Math.ceil(Math.log1p(-q)/Math.log1p(-hit));
  return { hit, meanGold: hit ? 2/hit : null, gold50: hit ? budget(.5) : null, gold90: hit ? budget(.9) : null, reason: '' };
}
