import { normalizeClub } from '../src/model.js';
import { solve } from '../src/solver.js';
import { analyzeRepeat } from '../src/analyze.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const coins = (n) => Math.round(n).toLocaleString();

let club = [];
let sbcs = [];
let market = null;

async function loadJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Could not load ${path}`);
  return r.json();
}

function setClub(data, label) {
  club = normalizeClub(data);
  const storage = club.filter((p) => p.duplicate).length;
  const untradeable = club.filter((p) => p.untradeable && !p.duplicate).length;
  $('clubInfo').textContent = `${label}: ${club.length} cards (${storage} in storage, ${untradeable} untradeable)`;
}

function readSaved() {
  try {
    const text = localStorage.getItem('futAssistant.club');
    return text ? { text, name: localStorage.getItem('futAssistant.clubName') ?? 'Imported club' } : null;
  } catch { return null; }
}

function addSavedOption(name) {
  let opt = $('clubSource').querySelector('option[value="saved"]');
  if (!opt) {
    opt = document.createElement('option');
    opt.value = 'saved';
    $('clubSource').insertBefore(opt, $('clubSource').firstChild);
  }
  opt.textContent = `My club (${name})`;
}

function currentSbc() {
  return JSON.parse($('sbcJson').value);
}

function options() {
  return {
    protectMinRating: Number($('protect').value),
    allowSpecial: $('allowSpecial').checked,
    market: $('useMarket').checked ? market : null,
  };
}

const source = (p) => (p.virtual ? '<span class="buy">Buy</span>'
  : p.duplicate ? 'Storage' : p.untradeable ? 'Untradeable' : 'Tradeable');

function squadTable(res) {
  const rows = res.squad.map((p) => `<tr>
    <td>${esc(p.slot ?? '–')}</td><td class="num">${p.rating}</td><td>${esc(p.name)}</td>
    <td>${esc(p.league ?? '–')}</td><td>${esc(p.club ?? '–')}</td><td>${esc(p.nation ?? '–')}</td>
    <td>${p.rare ? 'Rare' : ''}</td><td>${source(p)}</td><td class="num">${p.chem}</td><td class="num">${coins(p.price)}</td>
  </tr>`).join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Pos</th><th>OVR</th><th>Name</th><th>League</th><th>Club</th><th>Nation</th><th></th><th>Source</th><th>Chem</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function summary(res) {
  const ev = res.evaluation;
  const reqs = ev.results.map((r) =>
    `<li class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} ${esc(r.label)} <span class="muted">(got ${r.actual})</span></li>`).join('');
  return `<div class="chips">
      <span class="chip">Rating ${ev.rating}</span>
      <span class="chip">Chemistry ${ev.chemistry?.total ?? '–'} (${esc(ev.chemistry?.formation ?? '–')})</span>
      <span class="chip">Card value used ${coins(res.cost)}</span>
    </div><ul class="reqs">${reqs}</ul>`;
}

// Pre-fill codes shown on screen, keyed by button index.
let codes = [];

function prefillCode(res, sbc) {
  return JSON.stringify({
    kind: 'fut-assistant-prefill',
    v: 1,
    sbc: sbc.name,
    createdAt: new Date().toISOString(),
    cards: res.squad.map((p) => (p.virtual
      ? { buy: true, name: p.name, rating: p.rating }
      : { id: p.id, name: p.name, rating: p.rating, slot: p.slot })),
  });
}

function copyButton(res, sbc) {
  if (!res.feasible) return '';
  codes.push(prefillCode(res, sbc));
  return `<div class="row"><button class="primary copy" data-code="${codes.length - 1}">Copy pre-fill code</button>
    <span class="muted copied"></span></div>`;
}

function renderSolve(res, sbc) {
  codes = [];
  const buys = res.squad.filter((p) => p.virtual);
  $('output').innerHTML = `<h2>${esc(sbc.name)}</h2>
    <div class="big ${res.feasible ? 'ok' : 'bad'}">${esc(res.message)}</div>
    ${buys.length ? `<p class="buy">Needs ${buys.length} card(s) from the market, about ${coins(buys.reduce((a, p) => a + p.price, 0))} coins.</p>` : ''}
    ${summary(res)}${res.squad.length ? squadTable(res) : ''}
    ${copyButton(res, sbc)}
    <p class="note">Paste the code into the extension panel in EA's Web App with this SBC open, or build the squad by hand.
      Either way, check it and submit it yourself.</p>`;
}

function renderRepeat(res, sbc) {
  codes = [];
  const attempts = res.attempts.map((a, i) => `<details ${i === 0 ? 'open' : ''}>
      <summary>Attempt ${i + 1} · rating ${a.evaluation.rating} · card value ${coins(a.cost)}</summary>
      ${summary(a)}${squadTable(a)}${copyButton(a, sbc)}</details>`).join('');
  const next = res.nextWithMarket;
  $('output').innerHTML = `<h2>${esc(sbc.name)}</h2>
    <div class="big ${res.times ? 'ok' : 'bad'}">${res.times}${res.capped ? '+' : ''} time(s) with cards you own</div>
    <p class="muted">Card value across all attempts: ${coins(res.totalCost)}.
      ${res.capped ? 'Stopped counting at the limit.' : ''} This is a greedy estimate; a different split could occasionally get one more.</p>
    ${res.blockers.length ? `<p><b>What stops the next one:</b></p><ul class="reqs">${res.blockers.map((b) => `<li class="bad">✗ ${esc(b)}</li>`).join('')}</ul>` : ''}
    ${next ? `<details open><summary class="buy">One more by buying ${next.buys.length} card(s) for about ${coins(next.buyCost)} coins</summary>${summary(next)}${squadTable(next)}${copyButton(next, sbc)}</details>` : ''}
    ${attempts}`;
}

function run(kind) {
  let sbc;
  try { sbc = currentSbc(); } catch (e) { alert(`Requirements JSON is invalid: ${e.message}`); return; }
  const buttons = [$('solveBtn'), $('repeatBtn')];
  buttons.forEach((b) => { b.disabled = true; });
  $('output').innerHTML = '<h2>Working…</h2><p class="muted">Solving on this machine.</p>';
  setTimeout(() => {
    try {
      if (kind === 'solve') renderSolve(solve(club, sbc, options()), sbc);
      else renderRepeat(analyzeRepeat(club, sbc, options()), sbc);
    } catch (e) {
      $('output').innerHTML = `<h2>Error</h2><p class="bad">${esc(e.message)}</p>`;
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }, 20);
}

async function init() {
  [sbcs, market] = await Promise.all([loadJson('../data/sbcs.json'), loadJson('../data/market-prices.json')]);
  setClub(await loadJson('../data/sample-club.json'), 'Sample club');
  $('sbcSelect').innerHTML = sbcs.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
  const showSbc = () => { $('sbcJson').value = JSON.stringify(sbcs[$('sbcSelect').value], null, 2); };
  $('sbcSelect').addEventListener('change', showSbc);
  showSbc();

  // Reuse the last imported club, if this browser has one saved.
  const saved = readSaved();
  if (saved) {
    try {
      setClub(JSON.parse(saved.text), saved.name);
      addSavedOption(saved.name);
      $('clubSource').value = 'saved';
    } catch { /* ignore a corrupt saved copy */ }
  }

  $('clubSource').addEventListener('change', async () => {
    const v = $('clubSource').value;
    if (v === 'file') $('clubFile').click();
    else if (v === 'saved') { const s = readSaved(); if (s) setClub(JSON.parse(s.text), s.name); }
    else setClub(await loadJson('../data/sample-club.json'), 'Sample club');
  });
  $('clubFile').addEventListener('change', async () => {
    const f = $('clubFile').files[0];
    if (!f) return;
    try {
      const text = await f.text();
      setClub(JSON.parse(text), f.name);
      try { localStorage.setItem('futAssistant.club', text); localStorage.setItem('futAssistant.clubName', f.name); } catch { /* storage unavailable */ }
      addSavedOption(f.name);
      $('clubSource').value = 'saved';
    } catch (e) { alert(`Could not read club file: ${e.message}`); }
  });
  $('output').addEventListener('click', async (e) => {
    const btn = e.target.closest('button.copy');
    if (!btn) return;
    const text = codes[Number(btn.dataset.code)];
    const note = btn.parentElement.querySelector('.copied');
    try {
      await navigator.clipboard.writeText(text);
      note.textContent = 'Copied. Paste it into the extension panel.';
    } catch {
      window.prompt('Copy this pre-fill code:', text);
    }
  });
  $('solveBtn').addEventListener('click', () => run('solve'));
  $('repeatBtn').addEventListener('click', () => run('repeat'));
}

init().catch((e) => { $('output').innerHTML = `<h2>Error</h2><p class="bad">${esc(e.message)}</p>`; });
