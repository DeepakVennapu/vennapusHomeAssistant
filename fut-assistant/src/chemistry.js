// FC-style chemistry: players only earn chemistry, and only count toward others',
// when they are in one of their positions. Thresholds give 1/2/3 points.

export const FORMATIONS = {
  '4-4-2': ['GK', 'RB', 'CB', 'CB', 'LB', 'RM', 'CM', 'CM', 'LM', 'ST', 'ST'],
  '4-3-3': ['GK', 'RB', 'CB', 'CB', 'LB', 'CM', 'CM', 'CM', 'RW', 'ST', 'LW'],
  '4-2-3-1': ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'CDM', 'CAM', 'RM', 'LM', 'ST'],
  '4-1-2-1-2': ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'CM', 'CM', 'CAM', 'ST', 'ST'],
  '3-5-2': ['GK', 'CB', 'CB', 'CB', 'RM', 'CDM', 'CDM', 'LM', 'CAM', 'ST', 'ST'],
  '5-3-2': ['GK', 'RWB', 'CB', 'CB', 'CB', 'LWB', 'CM', 'CM', 'CM', 'ST', 'ST'],
};

const THRESHOLDS = { club: [2, 4, 7], nation: [2, 5, 8], league: [3, 5, 8] };

const level = (n, [a, b, c]) => (n >= c ? 3 : n >= b ? 2 : n >= a ? 1 : 0);

const canPlay = (p, slot) => p.positions.includes('ANY') || p.positions.includes(slot);

// Kuhn's algorithm: put as many players as possible into one of their own positions.
export function assignPositions(players, slots) {
  const owner = new Array(slots.length).fill(-1);
  const tryAssign = (pi, seen) => {
    for (let s = 0; s < slots.length; s++) {
      if (seen[s] || !canPlay(players[pi], slots[s])) continue;
      seen[s] = true;
      if (owner[s] === -1 || tryAssign(owner[s], seen)) {
        owner[s] = pi;
        return true;
      }
    }
    return false;
  };
  for (let pi = 0; pi < players.length; pi++) tryAssign(pi, new Array(slots.length).fill(false));
  const slotOf = new Array(players.length).fill(-1);
  owner.forEach((pi, s) => { if (pi !== -1) slotOf[pi] = s; });
  return slotOf;
}

export function chemistryFor(players, formation) {
  const slots = FORMATIONS[formation];
  if (!slots) throw new Error(`Unknown formation ${formation}`);
  const slotOf = assignPositions(players, slots);
  const counts = { club: new Map(), nation: new Map(), league: new Map() };
  const add = (attr, key, n) => { if (key != null) counts[attr].set(key, (counts[attr].get(key) ?? 0) + n); };

  players.forEach((p, i) => {
    if (slotOf[i] === -1) return;
    // Icons and Heroes have no real club; Icons boost their nation, Heroes their league (x2).
    if (!p.isIcon && !p.isHero) add('club', p.club, 1);
    add('nation', p.nation, p.isIcon ? 2 : 1);
    if (!p.isIcon) add('league', p.league, p.isHero ? 2 : 1);
  });

  const perPlayer = players.map((p, i) => {
    if (slotOf[i] === -1) return { chem: 0, slot: null };
    const slot = slots[slotOf[i]];
    if (p.isIcon || p.isHero) return { chem: 3, slot };
    const chem = Math.min(3,
      (p.club != null ? level(counts.club.get(p.club), THRESHOLDS.club) : 0) +
      (p.nation != null ? level(counts.nation.get(p.nation), THRESHOLDS.nation) : 0) +
      (p.league != null ? level(counts.league.get(p.league), THRESHOLDS.league) : 0));
    return { chem, slot };
  });

  return { formation, total: perPlayer.reduce((a, p) => a + p.chem, 0), perPlayer };
}

// SBCs let you pick the formation, so try each allowed one and keep the best.
export function bestChemistry(players, formations = Object.keys(FORMATIONS)) {
  let best = null;
  for (const f of formations) {
    const c = chemistryFor(players, f);
    if (!best || c.total > best.total) best = c;
    if (best.total === 3 * players.length) break;
  }
  return best;
}
