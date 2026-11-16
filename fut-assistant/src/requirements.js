// SBC requirement checking. Each requirement returns a "deficit": 0 when met,
// otherwise roughly how far off it is, so the solver can move toward a valid squad.
//
// Requirement kinds:
//   { kind: 'teamRating', min }
//   { kind: 'chemistry',  min }
//   { kind: 'count',    filter, min?, max? }   e.g. Rare players: Min 5
//   { kind: 'sameAttr', attr, min?, max? }     e.g. Same league count: Min 4 / Same club: Max 3
//   { kind: 'distinct', attr, min?, max? }     e.g. Leagues: Min 3 / Nations: Max 4
//   { kind: 'each',     filter }               e.g. every player is silver
//
// A filter is { attr: value | [values], minRating?, maxRating?, rare?, quality? }.

import { ratingTotal, teamRating } from './rating.js';
import { bestChemistry } from './chemistry.js';

export function matches(p, filter = {}) {
  for (const [k, v] of Object.entries(filter)) {
    if (k === 'minRating') { if (p.rating < v) return false; continue; }
    if (k === 'maxRating') { if (p.rating > v) return false; continue; }
    const val = p[k];
    if (Array.isArray(v) ? !v.includes(val) : val !== v) return false;
  }
  return true;
}

const filterText = (f = {}) => Object.entries(f)
  .map(([k, v]) => (k === 'rare' ? (v ? 'Rare' : 'Non-rare') : `${k} ${Array.isArray(v) ? v.join('/') : v}`))
  .join(', ');

const bounds = (r) => [r.min != null ? `Min ${r.min}` : null, r.max != null ? `Max ${r.max}` : null]
  .filter(Boolean).join(', ');

export function describe(r) {
  if (r.label) return r.label;
  switch (r.kind) {
    case 'teamRating': return `Team rating: Min ${r.min}`;
    case 'chemistry': return `Squad chemistry: Min ${r.min}`;
    case 'count': return `${filterText(r.filter)} players: ${bounds(r)}`;
    case 'sameAttr': return `Players from the same ${r.attr}: ${bounds(r)}`;
    case 'distinct': return `Different ${r.attr}s: ${bounds(r)}`;
    case 'each': return `Every player: ${filterText(r.filter)}`;
    default: return r.kind;
  }
}

const range = (n, r) => Math.max(0, (r.min ?? -Infinity) - n) + Math.max(0, n - (r.max ?? Infinity));

function tally(squad, attr) {
  const m = new Map();
  for (const p of squad) if (p[attr] != null) m.set(p[attr], (m.get(p[attr]) ?? 0) + 1);
  return m;
}

// withDetails=true also computes chemistry for display even if no requirement needs it.
export function evaluate(squad, sbc, withDetails = false) {
  const size = sbc.squadSize ?? 11;
  const ratings = squad.map((p) => p.rating);
  const reqs = sbc.requirements ?? [];
  const needsChem = withDetails || reqs.some((r) => r.kind === 'chemistry');
  const chem = needsChem ? bestChemistry(squad, sbc.formations) : null;
  const rating = teamRating(ratings, size);

  const results = reqs.map((r) => {
    let actual;
    let deficit;
    switch (r.kind) {
      case 'teamRating': {
        actual = rating;
        // Smooth measure: how many rating points short the whole squad is, per player.
        deficit = rating >= r.min ? 0 : Math.max(1, r.min * size - Math.round(ratingTotal(ratings, size))) / size;
        break;
      }
      case 'chemistry':
        actual = chem.total;
        deficit = Math.max(0, r.min - chem.total) / 3;
        break;
      case 'count':
        actual = squad.filter((p) => matches(p, r.filter)).length;
        deficit = range(actual, r);
        break;
      case 'sameAttr': {
        const counts = [...tally(squad, r.attr).values()];
        actual = counts.length ? Math.max(...counts) : 0;
        deficit = Math.max(0, (r.min ?? 0) - actual) +
          (r.max != null ? counts.reduce((a, c) => a + Math.max(0, c - r.max), 0) : 0);
        break;
      }
      case 'distinct':
        actual = tally(squad, r.attr).size;
        deficit = range(actual, r);
        break;
      case 'each':
        deficit = squad.filter((p) => !matches(p, r.filter)).length;
        actual = squad.length - deficit;
        break;
      default:
        throw new Error(`Unknown requirement kind "${r.kind}"`);
    }
    return { label: describe(r), kind: r.kind, ok: deficit === 0, actual, deficit };
  });

  const sizeDeficit = Math.abs(size - squad.length);
  const violation = sizeDeficit + results.reduce((a, r) => a + r.deficit, 0);
  return { ok: violation === 0, violation, rating, chemistry: chem, results };
}
