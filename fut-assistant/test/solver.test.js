import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamRating } from '../src/rating.js';
import { chemistryFor } from '../src/chemistry.js';
import { evaluate } from '../src/requirements.js';
import { normalizePlayer } from '../src/model.js';
import { solve } from '../src/solver.js';
import { analyzeRepeat } from '../src/analyze.js';

let nextId = 1;
const card = (o) => normalizePlayer({
  id: nextId++, rating: 80, positions: ['CM'], nation: 'Spain', league: 'L1', club: 'C1', price: 500, ...o,
});
const F442 = ['GK', 'RB', 'CB', 'CB', 'LB', 'RM', 'CM', 'CM', 'LM', 'ST', 'ST'];

test('team rating: flat squad and above-average bonus', () => {
  assert.equal(teamRating(Array(11).fill(84)), 84);
  assert.equal(teamRating([88, ...Array(10).fill(84)]), 84);
  assert.equal(teamRating([...Array(6).fill(86), ...Array(5).fill(83)]), 85);
});

test('chemistry: same club/nation/league in position is 33', () => {
  const squad = F442.map((pos) => card({ positions: [pos] }));
  assert.equal(chemistryFor(squad, '4-4-2').total, 33);
});

test('chemistry: an out-of-position player earns and gives nothing', () => {
  const squad = F442.map((pos) => card({ positions: [pos] }));
  squad[0] = card({ positions: ['ST'] }); // no GK left
  const c = chemistryFor(squad, '4-4-2');
  assert.equal(c.perPlayer.filter((p) => p.slot === null).length, 1);
  assert.equal(c.total, 30);
});

test('requirements: count, distinct and same-club checks', () => {
  const squad = [
    ...Array.from({ length: 4 }, () => card({ club: 'A', league: 'X', rare: true })),
    ...Array.from({ length: 7 }, (_, i) => card({ club: `B${i}`, league: i % 2 ? 'Y' : 'Z' })),
  ];
  const ev = evaluate(squad, {
    requirements: [
      { kind: 'count', filter: { rare: true }, min: 5 },
      { kind: 'distinct', attr: 'league', min: 3 },
      { kind: 'sameAttr', attr: 'club', max: 3 },
    ],
  });
  assert.deepEqual(ev.results.map((r) => r.ok), [false, true, false]);
  assert.equal(ev.ok, false);
});

test('solver: meets the rating, prefers cheap fodder, skips protected cards', () => {
  const pool = [
    ...Array.from({ length: 11 }, (_, i) => card({ baseId: `a${i}`, rating: 84, price: 2200, duplicate: true, untradeable: true })),
    ...Array.from({ length: 11 }, (_, i) => card({ baseId: `b${i}`, rating: 84, price: 2200 })),
    card({ baseId: 'star', rating: 91, price: 90000 }),
  ];
  const res = solve(pool, { requirements: [{ kind: 'teamRating', min: 84 }] });
  assert.equal(res.feasible, true);
  assert.equal(res.evaluation.rating, 84);
  assert.ok(res.squad.every((p) => p.duplicate), 'should use storage duplicates first');
  assert.ok(!res.squad.some((p) => p.baseId === 'star'));
});

test('solver: never puts the same player twice in one squad', () => {
  const pool = Array.from({ length: 22 }, (_, i) => card({ baseId: `p${i % 11}`, rating: 82 }));
  const res = solve(pool, { requirements: [{ kind: 'teamRating', min: 82 }] });
  assert.equal(res.feasible, true);
  assert.equal(new Set(res.squad.map((p) => p.baseId)).size, 11);
});

test('solver: says so when the club is too small', () => {
  const res = solve([card({}), card({})], { requirements: [] });
  assert.equal(res.feasible, false);
});

test('repeat: counts how many times the club covers an SBC', () => {
  const pool = Array.from({ length: 25 }, (_, i) => card({ baseId: `r${i}`, rating: 83 }));
  const res = analyzeRepeat(pool, { requirements: [{ kind: 'teamRating', min: 83 }] });
  assert.equal(res.times, 2);
  assert.ok(res.blockers.length > 0);
});

test('repeat: with market prices, shows what the next attempt costs', () => {
  const pool = Array.from({ length: 15 }, (_, i) => card({ baseId: `m${i}`, rating: 83 }));
  const res = analyzeRepeat(pool, { requirements: [{ kind: 'teamRating', min: 83 }] }, { market: { prices: { 83: 1200 } } });
  assert.equal(res.times, 1);
  assert.equal(res.nextWithMarket.buys.length, 7);
});

test('requirements: per-player chemistry and unsupported entries', () => {
  const squad = F442.map((pos) => card({ positions: [pos] }));
  squad[10] = card({ positions: ['ST'], nation: 'Peru', league: 'L9', club: 'C9' });
  const ev = evaluate(squad, { requirements: [{ kind: 'playerChem', min: 1 }, { kind: 'unsupported', label: 'Mystery' }] });
  assert.equal(ev.results[0].ok, false);
  assert.equal(ev.results[0].actual, 10);
  assert.equal(ev.results[1].unchecked, true);
  assert.equal(ev.results[1].ok, true);
});

test('requirements: EA ids work as filters', () => {
  const squad = [card({ leagueId: 13 }), card({ leagueId: 13 }), card({ leagueId: 53 })];
  const ev = evaluate(squad, { squadSize: 3, requirements: [{ kind: 'count', filter: { leagueId: [13] }, min: 2 }] });
  assert.equal(ev.ok, true);
});
