// Runs the club-export extension script in headless Chromium against a mock of the
// Web App's read API, then feeds the downloaded file into the solver.
// Skipped when Playwright isn't installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { normalizeClub } from '../src/model.js';
import { solve } from '../src/solver.js';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* not installed */ }

const script = fileURLToPath(new URL('../extension/club-export.js', import.meta.url));

// Builds a fake Web App: 120 club players over two pages, 3 storage cards, one loan, one Icon.
function mockWebApp() {
  const names = { 'search.nationName.nation14': 'England', 'global.leagueFull.13': 'Premier League', 'global.teamFull.1': 'Arsenal' };
  const make = (i, extra = {}) => ({
    id: 5000 + i, definitionId: 200000 + (i % 110), type: 'player', rating: 70 + (i % 20), rareflag: i % 3 === 0 ? 1 : 0,
    nationId: i % 2 ? 14 : 18, leagueId: i % 4 ? 13 : 53, teamId: i % 5 ? 1 : 9,
    preferredPosition: [0, 3, 5, 7, 14, 18, 25, 12, 16, 23, 27][i % 11], possiblePositions: ['CM'],
    untradeable: i % 2 === 0,
    getStaticData() { return { name: `Player ${i}` }; },
    ...extra,
  });
  const club = Array.from({ length: 120 }, (_, i) => make(i));
  club.push(make(200, { loans: 3 }));
  club.push(make(201, { leagueId: 2118, rating: 90 }));
  const storage = [make(300), make(301), make(302)];
  const observable = (payload) => ({ observe(_ctx, cb) { setTimeout(() => cb(this, { success: true, response: payload }), 5); } });
  window.__calls = [];
  window.services = {
    Club: { search(c) { window.__calls.push(`search:${c.offset}`); return observable({ items: window.__club.slice(c.offset, c.offset + c.count) }); } },
    Item: { requestStorageItems() { window.__calls.push('storage'); return observable({ items: window.__storage }); } },
    Localization: { localize: (k) => names[k] ?? k },
  };
  window.__club = club;
  window.__storage = storage;
}

test('extension exports a club the solver can use, using read calls only', { skip: !chromium && 'playwright not installed', timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.setContent('<!doctype html><html><body><p>Mock Web App</p></body></html>');
    await page.evaluate(mockWebApp);
    await page.addScriptTag({ content: readFileSync(script, 'utf8') });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('#fut-assistant-export').locator('button').click(),
    ]);
    const data = JSON.parse(readFileSync(await download.path(), 'utf8'));
    const calls = await page.evaluate(() => window.__calls);

    assert.deepEqual(calls, ['search:0', 'search:91', 'storage']);
    assert.equal(data.meta.clubCards, 121); // 120 + the Icon; the loan is skipped
    assert.equal(data.meta.storageCards, 3);
    assert.equal(data.meta.skipped.loansOrLocked, 1);

    const p1 = data.players.find((p) => p.id === '5001');
    assert.equal(p1.nation, 'England');
    assert.equal(p1.league, 'Premier League');
    assert.equal(p1.club, 'Arsenal');
    assert.deepEqual(p1.positions, ['RB', 'CM']);
    assert.ok(data.players.find((p) => p.id === '5201').isIcon);
    assert.ok(data.players.filter((p) => p.duplicate).every((p) => p.untradeable));
    // Unknown names fall back to ids instead of breaking.
    assert.equal(data.players.find((p) => p.id === '5000').nation, 'Nation 18');

    const club = normalizeClub(data);
    const res = solve(club, { requirements: [{ kind: 'teamRating', min: 80 }] });
    assert.equal(res.feasible, true);
  } finally {
    await browser.close();
  }
});
