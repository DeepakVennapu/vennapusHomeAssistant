// "How many times can I do this SBC with what I already own?"
// Solves, sets those cards aside, solves again, until the club runs out.
// It's a greedy estimate: a smarter split of cards could sometimes squeeze one more.

import { solve, mergeOptions } from './solver.js';

export function analyzeRepeat(pool, sbc, options = {}) {
  const opts = mergeOptions(options);
  const maxAttempts = options.maxAttempts ?? 20;
  let remaining = pool.slice();
  const attempts = [];
  let lastFailure = null;

  while (attempts.length < maxAttempts) {
    const res = solve(remaining, sbc, { ...opts, market: null, seed: opts.seed + attempts.length });
    if (!res.feasible) { lastFailure = res; break; }
    attempts.push(res);
    const used = new Set(res.squad.map((p) => p.id));
    remaining = remaining.filter((p) => !used.has(p.id));
  }

  // One more attempt, allowed to buy cards, to show what the next one would cost.
  let nextWithMarket = null;
  if (lastFailure && opts.market) {
    const res = solve(remaining, sbc, { ...opts, seed: opts.seed + 1000 });
    if (res.feasible) {
      const buys = res.squad.filter((p) => p.virtual);
      nextWithMarket = { ...res, buys, buyCost: buys.reduce((a, p) => a + p.price, 0) };
    }
  }

  return {
    times: attempts.length,
    capped: attempts.length >= maxAttempts,
    attempts,
    totalCost: attempts.reduce((a, r) => a + r.cost, 0),
    blockers: lastFailure
      ? (lastFailure.squad.length ? lastFailure.evaluation.results.filter((r) => !r.ok).map((r) => `${r.label} (best: ${r.actual})`) : [lastFailure.message])
      : [],
    nextWithMarket,
  };
}
