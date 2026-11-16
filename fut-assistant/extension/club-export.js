// FUT Assistant – club export (READ-ONLY).
//
// Runs inside EA's Web App page after you log in. When you press the button it reads
// your club players and SBC storage through the Web App's own read calls, one page at
// a time at a human-like pace, and downloads them as a JSON file for FUT Assistant.
//
// It never buys, sells, lists, moves, quick-sells or submits anything, and sends
// nothing anywhere except to a file on your computer.
//
// The Web App's internals aren't documented and change between seasons, so every
// field below is read defensively. If something comes out wrong, the export's
// "meta.sampleKeys" lists the raw fields EA provided, which helps fix the mapping.

(() => {
  'use strict';
  const VERSION = '0.1.0';
  const PAGE_SIZE = 91;          // the Web App's own club page size
  const MAX_PAGES = 80;          // safety cap (~7,000 cards)
  const PAUSE_MS = [1500, 3000]; // wait between page reads

  // Position ids used by the Web App, folded to the positions chemistry uses.
  const POSITION_IDS = ['GK', 'SW', 'RWB', 'RB', 'RCB', 'CB', 'LCB', 'LB', 'LWB', 'RDM', 'CDM', 'LDM',
    'RM', 'RCM', 'CM', 'LCM', 'LM', 'RAM', 'CAM', 'LAM', 'RF', 'CF', 'LF', 'RW', 'RS', 'ST', 'LS', 'LW'];
  const FOLD = { RCB: 'CB', LCB: 'CB', SW: 'CB', RDM: 'CDM', LDM: 'CDM', RCM: 'CM', LCM: 'CM',
    RAM: 'CAM', LAM: 'CAM', RF: 'CF', LF: 'CF', RS: 'ST', LS: 'ST' };
  const ICON_LEAGUE_ID = 2118;

  // Every card the extension has read this session, by card id, so pre-fill can reuse them.
  const itemCache = new Map();
  const remember = (items) => { for (const i of items) if (i?.id != null) itemCache.set(String(i.id), i); };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pause = () => sleep(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]));
  const tryCall = (fn) => { try { return fn(); } catch { return undefined; } };
  const firstDefined = (...vals) => vals.find((v) => v !== undefined && v !== null);

  function position(p) {
    if (p == null) return null;
    const name = typeof p === 'number' ? POSITION_IDS[p] : String(p).toUpperCase();
    return name ? FOLD[name] ?? name : null;
  }

  // ---- Web App access (read-only) ----

  function webAppReady() {
    return typeof window.services !== 'undefined' && window.services?.Club?.search;
  }

  // Web App calls return an "observable"; turn it into a promise.
  function observe(observable, label) {
    return new Promise((resolve, reject) => {
      if (!observable || typeof observable.observe !== 'function') {
        reject(new Error(`${label}: the Web App API looks different from what this extension expects.`));
        return;
      }
      const timer = setTimeout(() => reject(new Error(`${label}: timed out`)), 30000);
      observable.observe(undefined, (_sender, response) => {
        clearTimeout(timer);
        if (response && response.success === false) reject(new Error(`${label}: EA returned status ${response.status}`));
        else resolve(response);
      });
    });
  }

  function searchCriteria(offset) {
    const Dto = window.UTSearchCriteriaDTO;
    const c = Dto ? new Dto() : {};
    c.type = window.SearchType?.PLAYER ?? 'player';
    c.offset = offset;
    c.count = PAGE_SIZE;
    return c;
  }

  // `until` lets pre-fill stop reading as soon as it has found the cards it needs.
  async function readClubPlayers(onProgress, until) {
    const all = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await observe(window.services.Club.search(searchCriteria(page * PAGE_SIZE)), 'Club search');
      const items = res?.response?.items ?? res?.data?.items ?? [];
      all.push(...items);
      remember(items);
      onProgress(`Reading club… ${all.length} cards`);
      const done = items.length < PAGE_SIZE || res?.response?.retrievedAll === true || Boolean(until?.());
      if (done) break;
      await pause();
    }
    return all;
  }

  async function readStorage() {
    const svc = window.services?.Item;
    if (!svc?.requestStorageItems) return { items: [], note: 'SBC storage not available in this Web App version' };
    const res = await observe(svc.requestStorageItems(), 'SBC storage');
    const items = res?.response?.items ?? res?.data?.items ?? [];
    remember(items);
    return { items };
  }

  // ---- Mapping EA items to FUT Assistant cards ----

  const localizeCache = new Map();
  function localizeName(kind, id) {
    if (id == null) return null;
    const key = `${kind}:${id}`;
    if (localizeCache.has(key)) return localizeCache.get(key);
    const loc = window.services?.Localization;
    const candidates = {
      nation: [`search.nationName.nation${id}`],
      league: [`global.leagueFull.${id}`, `global.leagueabbr5.${id}`, `search.leagueName.league${id}`],
      club: [`global.teamFull.${id}`, `global.teamabbr15.${id}`, `search.teamName.team${id}`],
    }[kind];
    let name = null;
    for (const k of candidates) {
      const v = tryCall(() => loc?.localize?.(k));
      if (typeof v === 'string' && v && v !== k && !v.includes(k)) { name = v; break; }
    }
    // Unknown names fall back to the id; chemistry and "same league" checks still work.
    const result = name ?? `${kind[0].toUpperCase()}${kind.slice(1)} ${id}`;
    localizeCache.set(key, result);
    return result;
  }

  function playerName(item) {
    const s = tryCall(() => item.getStaticData?.()) ?? item._staticData ?? {};
    return firstDefined(s.name, s.knownAs, [s.firstName, s.lastName].filter(Boolean).join(' ') || undefined,
      item.name, `#${item.definitionId ?? item.id}`);
  }

  function isLoanOrLocked(item) {
    return Boolean(
      tryCall(() => item.isLimitedUse?.()) || (Number(item.loans) > 0) ||
      tryCall(() => item.isEnrolledInAcademy?.()));
  }

  function toCard(item, fromStorage) {
    const definitionId = Number(firstDefined(item.definitionId, item.resourceId, item.id));
    const rareflag = Number(firstDefined(item.rareflag, item.rareFlag, 0));
    const leagueId = firstDefined(item.leagueId, item.league);
    const isIcon = Boolean(tryCall(() => item.isIcon?.()) ?? leagueId === ICON_LEAGUE_ID);
    const isHero = Boolean(tryCall(() => item.isHero?.()));
    const preferred = position(firstDefined(item.preferredPosition, tryCall(() => item.getPosition?.())));
    const alternates = (firstDefined(item.possiblePositions, item.alternatePositions, []) || []).map(position);
    const positions = [...new Set([preferred, ...alternates].filter(Boolean))];
    const tradeable = tryCall(() => item.isTradeable?.());
    const special = Boolean(tryCall(() => item.isSpecial?.()) ?? rareflag > 1);
    return {
      id: String(item.id),
      // Same player across versions shares the low 24 bits of the definition id.
      baseId: String(firstDefined(item.databaseId, item.baseId, definitionId & 0xffffff)),
      definitionId,
      name: playerName(item),
      rating: Number(item.rating),
      positions,
      nation: localizeName('nation', item.nationId),
      league: localizeName('league', leagueId),
      club: localizeName('club', item.teamId),
      nationId: item.nationId ?? null,
      leagueId: leagueId ?? null,
      clubId: item.teamId ?? null,
      rare: rareflag >= 1,
      special,
      rareflag,
      isIcon,
      isHero,
      untradeable: fromStorage || Boolean(firstDefined(item.untradeable, tradeable === undefined ? undefined : !tradeable, false)),
      duplicate: fromStorage,
    };
  }

  function buildExport(clubItems, storageItems, notes) {
    const isPlayer = (i) => i && Number.isFinite(Number(i.rating)) && (i.type === undefined || i.type === 'player' ||
      tryCall(() => i.isPlayer?.()) === true);
    const skipped = { loansOrLocked: 0, notPlayers: 0 };
    const cards = [];
    for (const [items, fromStorage] of [[clubItems, false], [storageItems, true]]) {
      for (const item of items) {
        if (!isPlayer(item)) { skipped.notPlayers++; continue; }
        if (isLoanOrLocked(item)) { skipped.loansOrLocked++; continue; }
        cards.push(toCard(item, fromStorage));
      }
    }
    const sample = clubItems[0] ?? storageItems[0];
    return {
      meta: {
        source: 'FUT Assistant club export',
        version: VERSION,
        exportedAt: new Date().toISOString(),
        clubCards: cards.filter((c) => !c.duplicate).length,
        storageCards: cards.filter((c) => c.duplicate).length,
        skipped,
        notes,
        sampleKeys: sample ? Object.keys(sample).sort() : [],
      },
      players: cards,
    };
  }

  function download(data) {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fut-club-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---- Small floating panel (shadow DOM so it can't clash with EA's styles) ----

  let busy = false;
  function mountPanel() {
    if (document.getElementById('fut-assistant-export')) return;
    const host = document.createElement('div');
    host.id = 'fut-assistant-export';
    host.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .box { font: 13px/1.4 system-ui, sans-serif; background: #171a21; color: #e6e8ec; border: 1px solid #2a2f39;
          border-radius: 10px; padding: 10px 12px; width: 230px; box-shadow: 0 4px 16px rgba(0,0,0,.35); }
        .title { font-weight: 700; margin-bottom: 6px; }
        button { width: 100%; padding: 7px; border: 0; border-radius: 6px; background: #4c8dff; color: #fff; font: inherit; cursor: pointer; }
        button:disabled { opacity: .6; cursor: wait; }
        .status { margin-top: 6px; color: #9aa3af; font-size: 12px; }
        .x { float: right; cursor: pointer; color: #9aa3af; }
        hr { border: 0; border-top: 1px solid #2a2f39; margin: 10px 0; }
        textarea { width: 100%; box-sizing: border-box; height: 54px; margin-bottom: 6px; background: #0f1115; color: #e6e8ec;
          border: 1px solid #2a2f39; border-radius: 6px; font: 11px ui-monospace, monospace; resize: vertical; }
        .secondary { background: #2b3240; }
      </style>
      <div class="box">
        <span class="x" title="Hide">✕</span>
        <div class="title">FUT Assistant</div>
        <button id="export">Export club (read-only)</button>
        <div class="status" id="exportStatus">Reads your club and SBC storage, then saves a file.</div>
        <hr>
        <button id="readSbc" class="secondary">Copy SBC requirements</button>
        <div class="status" id="readStatus">With an SBC open, copies its rules for FUT Assistant.</div>
        <hr>
        <textarea id="code" placeholder="Paste a pre-fill code from FUT Assistant" spellcheck="false"></textarea>
        <button id="prefill" class="secondary">Pre-fill open SBC</button>
        <div class="status" id="prefillStatus">Open the SBC's squad screen first. You check and submit yourself.</div>
      </div>`;
    const btn = root.getElementById('export');
    const status = root.getElementById('exportStatus');
    root.querySelector('.x').addEventListener('click', () => host.remove());
    const setStatus = (t) => { status.textContent = t; };

    const readStatus = root.getElementById('readStatus');
    root.getElementById('readSbc').addEventListener('click', async () => {
      try {
        const reader = window.__futAssistantSbc;
        if (!reader) throw new Error('SBC reader script did not load.');
        const data = reader.readOpenSbc();
        const text = JSON.stringify(data);
        try { await navigator.clipboard.writeText(text); } catch { window.prompt('Copy these SBC requirements:', text); }
        const n = data.sbc.requirements.filter((r) => r.kind !== 'unsupported').length;
        const warn = [data.unsupported && `${data.unsupported} not understood`, data.uncertain && `${data.uncertain} to double-check`]
          .filter(Boolean).join(', ');
        readStatus.textContent = `Copied ${n} requirement(s) for "${data.sbc.name}"${warn ? ` (${warn})` : ''}. ` +
          'Paste it in FUT Assistant.';
      } catch (e) {
        readStatus.textContent = `Stopped: ${e.message}`;
      }
    });

    const prefillBtn = root.getElementById('prefill');
    const prefillStatus = root.getElementById('prefillStatus');
    prefillBtn.addEventListener('click', async () => {
      if (busy) return;
      const prefill = window.__futAssistantPrefill;
      if (!prefill) { prefillStatus.textContent = 'Pre-fill script did not load.'; return; }
      if (!webAppReady()) { prefillStatus.textContent = 'Log in and wait for the Web App to finish loading.'; return; }
      busy = true;
      prefillBtn.disabled = true;
      try {
        const msg = await prefill.run(root.getElementById('code').value, (t) => { prefillStatus.textContent = t; });
        prefillStatus.textContent = msg;
      } catch (e) {
        prefillStatus.textContent = `Stopped: ${e.message}`;
      } finally {
        busy = false;
        prefillBtn.disabled = false;
      }
    });

    btn.addEventListener('click', async () => {
      if (busy) return;
      if (!webAppReady()) { setStatus('Log in and wait for the Web App to finish loading, then try again.'); return; }
      busy = true;
      btn.disabled = true;
      try {
        const clubItems = await readClubPlayers(setStatus);
        await pause();
        setStatus('Reading SBC storage…');
        const storage = await readStorage().catch((e) => ({ items: [], note: e.message }));
        const data = buildExport(clubItems, storage.items, storage.note ? [storage.note] : []);
        download(data);
        setStatus(`Saved ${data.meta.clubCards} club + ${data.meta.storageCards} storage cards.`);
      } catch (e) {
        setStatus(`Stopped: ${e.message}`);
      } finally {
        busy = false;
        btn.disabled = false;
      }
    });
    document.body.appendChild(host);
  }

  // Exposed for testing and for a manual run from the console.
  window.__futAssistantExport = {
    buildExport, toCard, position, readClubPlayers, readStorage, mountPanel, observe, tryCall, firstDefined,
    pause, itemCache, VERSION,
  };

  if (document.body) mountPanel();
  else window.addEventListener('DOMContentLoaded', mountPanel);
})();
