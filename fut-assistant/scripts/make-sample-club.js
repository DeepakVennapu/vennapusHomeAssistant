// Generates data/sample-club.json: a made-up club so the POC runs without EA data.
// Player names are invented; leagues, clubs and nations are just realistic labels.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { estimatePrice } from '../src/model.js';

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rand() * a.length)];

const LEAGUES = {
  'Premier League': ['Arsenal', 'Liverpool', 'Man City', 'Chelsea', 'Spurs'],
  'LALIGA EA SPORTS': ['Real Madrid', 'FC Barcelona', 'Atlético Madrid', 'Sevilla'],
  'Serie A': ['Inter', 'Milan', 'Juventus', 'Napoli'],
  Bundesliga: ['Bayern', 'Dortmund', 'Leverkusen', 'Leipzig'],
  'Ligue 1': ['PSG', 'Marseille', 'Lyon', 'Monaco'],
  Eredivisie: ['Ajax', 'PSV', 'Feyenoord'],
  'Liga Portugal': ['Benfica', 'Porto', 'Sporting CP'],
  MLS: ['Inter Miami', 'LA Galaxy', 'LAFC'],
};
const NATIONS = ['England', 'Spain', 'France', 'Germany', 'Italy', 'Brazil', 'Argentina',
  'Portugal', 'Netherlands', 'Belgium', 'USA', 'Croatia', 'Uruguay', 'Morocco'];
const POSITIONS = [['GK'], ['GK'], ['CB'], ['CB'], ['CB'], ['RB', 'RWB'], ['LB', 'LWB'], ['CDM', 'CM'],
  ['CM', 'CDM'], ['CM', 'CAM'], ['CAM', 'CM'], ['RM', 'RW'], ['LM', 'LW'], ['RW', 'RM'], ['LW', 'LM'], ['ST'], ['ST', 'CF']];
const FIRST = 'ABCDEFGHJKLMNOPRSTVW'.split('');
const LAST = ['Varga', 'Moreau', 'Okafor', 'Lindqvist', 'Costa', 'Brandt', 'Rossi', 'Ibáñez', 'Kowal',
  'Haddad', 'Silva', 'Novak', 'Dupont', 'Mertens', 'Asante', 'Ferreira', 'Kane-Ellis', 'Quint',
  'Albrecht', 'Romero', 'Takeda', 'Osei', 'Vidal', 'Petrov', 'Nyberg', 'Castillo', 'Laurent', 'Brook'];

const bands = [
  [50, 64, 20], [65, 74, 45], [75, 79, 60], [80, 83, 65], [84, 86, 35], [87, 90, 10],
];

const players = [];
let id = 1;
for (const [lo, hi, n] of bands) {
  for (let k = 0; k < n; k++) {
    const league = pick(Object.keys(LEAGUES));
    const rating = lo + Math.floor(rand() * (hi - lo + 1));
    const rare = rand() < 0.5;
    const special = rating >= 80 && rand() < 0.08;
    const untradeable = rand() < 0.4;
    const p = {
      id: id, baseId: 1000 + id, name: `${pick(FIRST)}. ${pick(LAST)}`, rating,
      positions: pick(POSITIONS), nation: pick(NATIONS), league, club: pick(LEAGUES[league]),
      rare: rare || special, special, rarity: special ? 'inform' : rare ? 'rare' : 'common',
      untradeable,
    };
    p.price = estimatePrice(rating, p.rare) * (special ? 3 : 1);
    players.push(p);
    id++;
  }
}
// Duplicates sitting in SBC storage: same player as a club card, always untradeable.
for (let k = 0; k < 25; k++) {
  const src = players[Math.floor(rand() * players.length)];
  if (src.special) continue;
  players.push({ ...src, id: id++, duplicate: true, untradeable: true });
}

const out = fileURLToPath(new URL('../data/sample-club.json', import.meta.url));
writeFileSync(out, JSON.stringify({ players }, null, 1) + '\n');
console.log(`Wrote ${players.length} cards to ${out}`);
