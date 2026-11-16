#!/usr/bin/env node
// Usage:
//   node src/cli.js list
//   node src/cli.js solve  <sbc-id> [--club file] [--market] [--protect 87] [--specials]
//   node src/cli.js repeat <sbc-id> [--club file] [--market] [--max 20]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeClub } from './model.js';
import { solve } from './solver.js';
import { analyzeRepeat } from './analyze.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const [cmd, sbcId, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const arg = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : def; };

const sbcs = readJson(arg('sbcs', here('../data/sbcs.json')));

if (!cmd || cmd === 'list') {
  for (const s of sbcs) console.log(`${s.id.padEnd(16)} ${s.name}`);
  process.exit(0);
}
const sbc = sbcs.find((s) => s.id === sbcId);
if (!sbc) { console.error(`Unknown SBC "${sbcId}". Run: node src/cli.js list`); process.exit(1); }

const club = normalizeClub(readJson(arg('club', here('../data/sample-club.json'))));
const options = {
  protectMinRating: Number(arg('protect', 87)),
  allowSpecial: flag('specials'),
  market: flag('market') ? readJson(here('../data/market-prices.json')) : null,
  maxAttempts: Number(arg('max', 20)),
};

const tag = (p) => (p.virtual ? 'BUY' : p.duplicate ? 'storage' : p.untradeable ? 'untradeable' : 'tradeable');
const printSquad = (res) => {
  for (const p of res.squad) {
    console.log(`  ${String(p.slot ?? '-').padEnd(4)} ${String(p.rating).padEnd(3)} ${p.name.padEnd(24)} ` +
      `${String(p.league ?? '').padEnd(18)} ${String(p.nation ?? '').padEnd(12)} ${tag(p).padEnd(12)} ${p.price}`);
  }
  console.log(`  Rating ${res.evaluation.rating} · Chemistry ${res.evaluation.chemistry?.total} ` +
    `(${res.evaluation.chemistry?.formation}) · Market value used ${res.cost.toLocaleString()}`);
  for (const r of res.evaluation.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.label} (got ${r.actual})`);
};

console.log(`${sbc.name}  ·  club: ${club.length} cards\n`);
if (cmd === 'solve') {
  const res = solve(club, sbc, options);
  console.log(res.message);
  printSquad(res);
} else if (cmd === 'repeat') {
  const res = analyzeRepeat(club, sbc, options);
  console.log(`You can complete this ${res.times}${res.capped ? '+' : ''} time(s) with cards you own.`);
  res.attempts.forEach((a, i) => { console.log(`\nAttempt ${i + 1}`); printSquad(a); });
  if (res.blockers.length) console.log(`\nWhat stops the next one:\n  ${res.blockers.join('\n  ')}`);
  if (res.nextWithMarket) {
    console.log(`\nOne more is possible by buying ${res.nextWithMarket.buys.length} card(s) for ~${res.nextWithMarket.buyCost.toLocaleString()} coins:`);
    printSquad(res.nextWithMarket);
  }
} else {
  console.error(`Unknown command "${cmd}"`);
  process.exit(1);
}
