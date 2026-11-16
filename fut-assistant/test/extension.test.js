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
const prefillScript = fileURLToPath(new URL('../extension/prefill.js', import.meta.url));
const readerScript = fileURLToPath(new URL('../extension/sbc-reader.js', import.meta.url));

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
      page.locator('#fut-assistant-export #export').click(),
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

// A fake open SBC: a 4-4-2 squad screen reachable the way the Web App exposes it.
function mockOpenSbc() {
  window.__saved = 0;
  window.__submitted = 0;
  window.__placed = null;
  const slots = ['GK', 'RB', 'CB', 'CB', 'LB', 'RM', 'CM', 'CM', 'LM', 'ST', 'ST'].map((typeName) => ({ position: { typeName } }));
  const challenge = {
    id: 77, setId: 5, eligibilityRequirements: [],
    squad: { getFieldPlayers: () => slots, setPlayers(items) { window.__placed = items.map((i) => i && i.id); } },
  };
  window.getAppMain = () => ({
    getRootViewController: () => ({
      getPresentedViewController: () => ({
        getCurrentViewController: () => ({ getCurrentController: () => ({ _view: { deep: { holder: { challenge } } } }) }),
      }),
    }),
  });
  window.services.SBC = {
    saveChallenge() { window.__saved++; return { observe(_c, cb) { setTimeout(() => cb(this, { success: true }), 5); } }; },
    submitChallenge() { window.__submitted++; throw new Error('must never submit'); },
  };
}

test('pre-fill places the chosen cards in position, saves the draft, never submits', { skip: !chromium && 'playwright not installed', timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><p>Mock Web App</p></body></html>');
    await page.evaluate(mockWebApp);
    await page.evaluate(mockOpenSbc);
    await page.addScriptTag({ content: readFileSync(script, 'utf8') });
    await page.addScriptTag({ content: readFileSync(prefillScript, 'utf8') });

    // Cards 5000.. have preferred positions in slot order GK,RB,CB,LB,CM,CAM,ST,RM,LM,RW,LW (by i % 11).
    // Give them out of order, plus one card to buy, and expect a sensible placement.
    const ids = [5009, 5006, 5004, 5000, 5001, 5002, 5013, 5007, 5008, 5017];
    const code = JSON.stringify({ kind: 'fut-assistant-prefill', v: 1, sbc: 'Test',
      cards: [...ids.map((id) => ({ id: String(id), name: `P${id}` })), { buy: true, name: 'Any 84 gold (buy)', rating: 84 }] });

    await page.locator('#fut-assistant-export #code').fill(code);
    await page.locator('#fut-assistant-export #prefill').click();
    const status = page.locator('#fut-assistant-export #prefillStatus');
    await status.filter({ hasText: /Placed|Stopped/ }).waitFor({ timeout: 30000 });
    const text = await status.textContent();
    assert.match(text, /Placed 10 card\(s\)\. Buy and place 1 more yourself/);

    const placed = await page.evaluate(() => window.__placed);
    assert.equal(placed.length, 11);
    assert.equal(placed[0], 5000, 'GK card in the GK slot');
    assert.equal(placed[1], 5001, 'RB card in the RB slot');
    assert.deepEqual([placed[9], placed[10]].sort(), [5006, 5017], 'strikers up front');
    assert.equal(placed.filter((x) => x == null).length, 1, 'one empty slot for the card to buy');
    assert.equal(await page.evaluate(() => window.__saved), 1);
    assert.equal(await page.evaluate(() => window.__submitted), 0);

    // A second fill straight away is blocked by the cooldown.
    await page.locator('#fut-assistant-export #prefill').click();
    await status.filter({ hasText: /Please wait/ }).waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__saved), 1);
  } finally {
    await browser.close();
  }
});

test('pre-fill refuses a bad code and a missing card', { skip: !chromium && 'playwright not installed', timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(mockWebApp);
    await page.evaluate(mockOpenSbc);
    await page.addScriptTag({ content: readFileSync(script, 'utf8') });
    await page.addScriptTag({ content: readFileSync(prefillScript, 'utf8') });
    const bad = await page.evaluate(() => window.__futAssistantPrefill.run('hello').catch((e) => e.message));
    assert.match(bad, /not a FUT Assistant pre-fill code/);
    // Speed up the paced club read for this test.
    await page.evaluate(() => { window.__futAssistantExport.pause = () => Promise.resolve(); });
    const code = JSON.stringify({ kind: 'fut-assistant-prefill', cards: [{ id: '999999', name: 'Sold Guy' }] });
    const missing = await page.evaluate((c) => window.__futAssistantPrefill.run(c).catch((e) => e.message), code);
    assert.match(missing, /no longer in your club or storage: Sold Guy/);
    assert.equal(await page.evaluate(() => window.__saved), 0);
  } finally {
    await browser.close();
  }
});

// Fake SBC requirements, shaped the way the Web App stores them (enum tables + kvPairs).
function mockRequirements() {
  window.SBCEligibilityKey = { PLAYER_COUNT: 1, TEAM_RATING_1_TO_100: 2, CHEMISTRY_POINTS: 3, SAME_LEAGUE_COUNT: 4,
    NATION_COUNT: 5, LEAGUE_ID: 6, PLAYER_RARITY_GROUP: 7, FIRST_OWNER_PLAYERS_COUNT: 8, PLAYER_QUALITY: 9 };
  window.SBCEligibilityScope = { GREATER: 0, LOWER: 1, EXACT: 2 };
  const kv = (o) => ({ _collection: o });
  const challenge = window.getAppMain().getRootViewController().getPresentedViewController()
    .getCurrentViewController().getCurrentController()._view.deep.holder.challenge;
  challenge.name = 'Test Hybrid';
  challenge.eligibilityRequirements = [
    { scope: 2, count: -1, kvPairs: kv({ 1: [11] }) },
    { scope: 0, count: -1, kvPairs: kv({ 2: [80] }) },
    { scope: 0, count: -1, kvPairs: kv({ 3: [10] }) },
    { scope: 1, count: -1, kvPairs: kv({ 4: [8] }) },
    { scope: 0, count: -1, kvPairs: kv({ 5: [2] }) },
    { scope: 0, count: 3, kvPairs: kv({ 6: [13] }) },
    { scope: 0, count: 2, kvPairs: kv({ 7: [4] }) },
    { scope: 2, count: 1, kvPairs: kv({ 8: [1] }) },
    { scope: 0, count: -1, kvPairs: new Map([[9, [2]]]) },
  ];
  document.body.insertAdjacentHTML('beforeend', '<ul class="sbc-requirements"><li>Team Rating: Min. 80</li><li>First Owner: Exactly 1</li></ul>');
}

test('reads the open SBC requirements and the solver can use them', { skip: !chromium && 'playwright not installed', timeout: 60000 }, async () => {
  const browser = await chromium.launch({ args: ['--enable-features=Clipboard'] });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(mockWebApp);
    await page.evaluate(mockOpenSbc);
    await page.evaluate(mockRequirements);
    for (const f of [script, prefillScript, readerScript]) await page.addScriptTag({ content: readFileSync(f, 'utf8') });

    const data = await page.evaluate(() => window.__futAssistantSbc.readOpenSbc());
    const { sbc } = data;
    assert.equal(sbc.name, 'Test Hybrid');
    assert.equal(sbc.squadSize, 11);
    assert.equal(data.unsupported, 1);
    assert.equal(data.uncertain, 2);
    assert.deepEqual(data.eaText, ['Team Rating: Min. 80', 'First Owner: Exactly 1']);
    const kinds = sbc.requirements.map((r) => [r.kind, r.attr ?? r.filter ?? null, r.min ?? null, r.max ?? null]);
    assert.deepEqual(kinds, [
      ['teamRating', null, 80, null],
      ['chemistry', null, 10, null],
      ['sameAttr', 'leagueId', null, 8],
      ['distinct', 'nationId', 2, null],
      ['count', { leagueId: [13] }, 3, null],
      ['count', { rare: true }, 2, null],
      ['each', { quality: ['silver', 'gold'] }, null, null],
      ['unsupported', null, null, null],
    ]);

    // The panel button reports what it copied.
    await page.locator('#fut-assistant-export #readSbc').click();
    await page.locator('#fut-assistant-export #readStatus').filter({ hasText: /Copied|Stopped/ }).waitFor();
    assert.match(await page.locator('#fut-assistant-export #readStatus').textContent(),
      /Copied 7 requirement\(s\) for "Test Hybrid" \(1 not understood, 2 to double-check\)/);

    const exported = await page.evaluate(() => window.__futAssistantExport.buildExport(window.__club, window.__storage, []));
    const res = solve(normalizeClub(exported), sbc);
    assert.equal(res.feasible, true, JSON.stringify(res.evaluation.results));
    assert.ok(res.evaluation.results.find((r) => r.kind === 'unsupported').unchecked);
  } finally {
    await browser.close();
  }
});
