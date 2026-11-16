// SBC solver: finds the cheapest squad from your club that meets every requirement.
//
// Two phases per restart:
//   1. Search (simulated annealing) until the squad meets all requirements.
//   2. Keep it valid while swapping in cheaper fodder, then a final greedy polish.
// "Cheap" means fodder you lose the least by using: duplicates in storage first,
// then untradeables, then tradeables. Your best cards are protected by default.
//
// The solver only proposes a squad. It never talks to EA.

import { evaluate, matches } from './requirements.js';
import { qualityOf } from './model.js';

export const DEFAULT_OPTIONS = {
  protectMinRating: 87,   // never use cards rated this or higher (unless untradeable duplicates)
  protectIds: [],         // never use these card ids
  excludeIds: [],         // skip these card ids for this run
  allowSpecial: false,    // allow promo/special cards as fodder
  market: null,           // { prices: { "84": 2200, ... } } adds "buy any N-rated" cards
  restarts: 4,
  iterations: 3000,
  seed: 1,
  weights: { duplicate: 0.15, untradeable: 0.5, tradeable: 0.95, market: 1.1 },
};

export function mergeOptions(o = {}) {
  return { ...DEFAULT_OPTIONS, ...o, weights: { ...DEFAULT_OPTIONS.weights, ...(o.weights ?? {}) } };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cardCost(p, w) {
  const weight = p.virtual ? w.market : p.duplicate ? w.duplicate : p.untradeable ? w.untradeable : w.tradeable;
  // Small rating term: on a tie, keep the lower-rated card back.
  return p.price * weight + p.rating * 0.01;
}

export function marketCards(prices, size) {
  const out = [];
  for (const [r, price] of Object.entries(prices ?? {})) {
    const rating = Number(r);
    for (let i = 0; i < size; i++) {
      const id = `market-${rating}-${i + 1}`;
      out.push({
        id, baseId: id, name: `Any ${rating} ${qualityOf(rating)} (buy)`, rating,
        positions: ['ANY'], nation: null, league: null, club: null,
        rare: false, special: false, rarity: 'common', isIcon: false, isHero: false,
        untradeable: false, duplicate: false, price: Number(price), quality: qualityOf(rating), virtual: true,
      });
    }
  }
  return out;
}

export function buildCandidates(pool, sbc, opts) {
  const size = sbc.squadSize ?? 11;
  const each = (sbc.requirements ?? []).filter((r) => r.kind === 'each');
  const protect = new Set(opts.protectIds.map(String));
  const exclude = new Set(opts.excludeIds.map(String));
  const isProtected = (p) =>
    protect.has(p.id) || (p.rating >= opts.protectMinRating && !(p.duplicate && p.untradeable));
  const ok = (p) => each.every((r) => matches(p, r.filter));
  const fromClub = pool.filter((p) =>
    !exclude.has(p.id) && !isProtected(p) && (opts.allowSpecial || !p.special) && ok(p));
  const fromMarket = opts.market ? marketCards(opts.market.prices, size).filter(ok) : [];
  return fromClub.concat(fromMarket);
}

const better = (a, b) =>
  !b || (a.ev.ok && !b.ev.ok) || (a.ev.ok === b.ev.ok && (a.ev.ok ? a.cost < b.cost : a.ev.violation < b.ev.violation));

function runRestart(cands, costs, order, sbc, size, rand, iterations) {
  const n = cands.length;
  const players = (sel) => sel.map((i) => cands[i]);
  const conflict = (sel, slot, j) =>
    sel.some((k, idx) => k === j || (idx !== slot && cands[k].baseId === cands[j].baseId));
  const stateOf = (sel) => ({ sel, cost: sel.reduce((a, i) => a + costs[i], 0), ev: evaluate(players(sel), sbc) });

  // Start from a random pick among the cheaper cards.
  const pickFrom = order.slice(0, Math.min(n, size * 4)).sort(() => rand() - 0.5).concat(order);
  const sel = [];
  const used = new Set();
  for (const i of pickFrom) {
    if (sel.length === size) break;
    if (used.has(cands[i].baseId)) continue;
    used.add(cands[i].baseId);
    sel.push(i);
  }
  let cur = stateOf(sel);

  // Phase 1: reach a valid squad.
  const f = (s) => s.ev.violation + s.cost * 1e-8;
  for (let it = 0; it < iterations * 2 && !cur.ev.ok; it++) {
    const T = 2 * (0.01 ** (it / (iterations * 2)));
    const slot = Math.floor(rand() * size);
    const j = Math.floor(rand() * n);
    if (conflict(cur.sel, slot, j)) continue;
    const next = stateOf(cur.sel.map((k, idx) => (idx === slot ? j : k)));
    const d = f(next) - f(cur);
    if (d <= 0 || rand() < Math.exp(-d / T)) cur = next;
  }
  if (!cur.ev.ok) return cur;

  // Phase 2: stay valid, get cheaper.
  let best = cur;
  const T0 = (cur.cost / size) * 0.5;
  for (let it = 0; it < iterations; it++) {
    const T = T0 * (0.001 ** (it / iterations));
    const slot = Math.floor(rand() * size);
    const j = Math.floor(rand() * n);
    const d = costs[j] - costs[cur.sel[slot]];
    if (d > T * 5 || conflict(cur.sel, slot, j)) continue;
    const next = stateOf(cur.sel.map((k, idx) => (idx === slot ? j : k)));
    if (!next.ev.ok) continue;
    if (d <= 0 || rand() < Math.exp(-d / T)) cur = next;
    if (cur.cost < best.cost) best = cur;
  }

  // Greedy polish: swap any slot for a cheaper card while the squad stays valid.
  for (let improved = true; improved;) {
    improved = false;
    for (let slot = 0; slot < size && !improved; slot++) {
      for (const j of order) {
        if (costs[j] >= costs[best.sel[slot]]) break;
        if (conflict(best.sel, slot, j)) continue;
        const next = stateOf(best.sel.map((k, idx) => (idx === slot ? j : k)));
        if (next.ev.ok) { best = next; improved = true; break; }
      }
    }
  }
  return best;
}

export function solve(pool, sbc, options = {}) {
  const opts = mergeOptions(options);
  const size = sbc.squadSize ?? 11;
  const cands = buildCandidates(pool, sbc, opts);
  const distinct = new Set(cands.map((p) => p.baseId)).size;
  if (distinct < size) {
    return {
      feasible: false, cost: 0, squad: [], candidates: cands.length,
      message: `Only ${distinct} usable players for a ${size}-player squad.`,
      evaluation: evaluate([], sbc),
    };
  }
  const costs = cands.map((p) => cardCost(p, opts.weights));
  const order = cands.map((_, i) => i).sort((a, b) => costs[a] - costs[b]);
  const rand = rng(opts.seed);

  let best = null;
  for (let r = 0; r < opts.restarts; r++) {
    const s = runRestart(cands, costs, order, sbc, size, rand, opts.iterations);
    if (better(s, best)) best = s;
  }

  const squad = best.sel.map((i) => cands[i]);
  const evaluation = evaluate(squad, sbc, true);
  const slots = evaluation.chemistry?.perPlayer ?? [];
  return {
    feasible: evaluation.ok,
    cost: Math.round(squad.reduce((a, p) => a + p.price, 0)),
    fodderCost: Math.round(best.cost),
    squad: squad.map((p, i) => ({ ...p, slot: slots[i]?.slot ?? null, chem: slots[i]?.chem ?? 0 })),
    candidates: cands.length,
    message: evaluation.ok ? 'Valid squad found.' : 'No valid squad found; showing the closest one.',
    evaluation,
  };
}
