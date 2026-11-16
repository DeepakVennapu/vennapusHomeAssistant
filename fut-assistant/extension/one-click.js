// FUT Assistant – solve and pre-fill the open SBC in one click.
//
// 1. Reads the open SBC's requirements (no network).
// 2. Uses your club: read once per session at the paced speed, then reused.
// 3. Solves on your computer with the bundled solver.
// 4. Places that one squad with the pre-fill step (saves the draft once, never submits).
//
// Cards placed by an earlier fill this session are left out of the next solve, on the
// assumption you submitted it. "Re-read my club" starts fresh.

(() => {
  'use strict';
  const placedEarlier = new Set();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const coins = (n) => Math.round(n).toLocaleString();

  const need = () => {
    const H = window.__futAssistantExport;
    const P = window.__futAssistantPrefill;
    const S = window.__futAssistantSbc;
    const X = window.__futAssistantSolver;
    if (!H || !P || !S || !X) throw new Error('Some extension scripts did not load. Reload the Web App.');
    return { H, P, S, X };
  };

  async function loadClub(onStatus, refresh) {
    const { H } = need();
    if (refresh) {
      H.itemCache.clear();
      H.clubState.clubComplete = false;
      H.clubState.storageRead = false;
      placedEarlier.clear();
    }
    if (!H.clubState.storageRead) {
      onStatus('Reading SBC storage…');
      await H.readStorage().catch(() => {});
    }
    if (!H.clubState.clubComplete) {
      await H.pause();
      await H.readClubPlayers(onStatus);
    }
    const all = [...H.itemCache.values()];
    const clubItems = all.filter((i) => !H.storageIds.has(String(i.id)));
    const storageItems = all.filter((i) => H.storageIds.has(String(i.id)));
    return H.buildExport(clubItems, storageItems, []);
  }

  async function refreshClub(onStatus) {
    const data = await loadClub(onStatus, true);
    return `Club re-read: ${data.meta.clubCards} club + ${data.meta.storageCards} storage cards.`;
  }

  async function solveAndFill(options, onStatus) {
    const { P, S, X } = need();
    const wait = P.cooldownLeft();
    if (wait > 0) throw new Error(`Please wait ${Math.ceil(wait / 1000)}s before the next pre-fill.`);

    const read = S.readOpenSbc();
    const { sbc } = read;
    if (!read.enumsFound) throw new Error("Couldn't read this SBC's requirements from the Web App. Use More tools instead.");

    const data = await loadClub(onStatus, false);
    onStatus(`Solving "${sbc.name}"…`);
    await sleep(30); // let the status paint before the solver runs

    const club = X.normalizeClub(data);
    const opts = { protectMinRating: options.protectMinRating ?? 87, excludeIds: [...placedEarlier] };
    const res = X.solve(club, sbc, opts);
    if (!res.feasible) {
      const why = res.squad.length
        ? res.evaluation.results.filter((r) => !r.ok).map((r) => `${r.label} (best: ${r.actual})`).join('; ')
        : res.message;
      throw new Error(`Can't complete this with your club. ${why}`);
    }

    const code = JSON.stringify({
      kind: 'fut-assistant-prefill', v: 1, sbc: sbc.name,
      cards: res.squad.map((p) => ({ id: p.id, name: p.name, rating: p.rating, slot: p.slot })),
    });
    await P.run(code, onStatus);
    res.squad.forEach((p) => placedEarlier.add(p.id));

    const ev = res.evaluation;
    const check = ev.results.filter((r) => r.unchecked || r.uncertain).map((r) => r.label);
    let more = '';
    try {
      const left = club.filter((p) => !placedEarlier.has(p.id));
      const rep = X.analyzeRepeat(left, sbc, { ...opts, excludeIds: [], maxAttempts: 10, restarts: 2, iterations: 1500 });
      more = ` Your club can do this about ${rep.times}${rep.capped ? '+' : ''} more time(s).`;
    } catch { /* the count is a bonus; skip it on error */ }

    return `Placed ${res.squad.length} cards · rating ${ev.rating} · chemistry ${ev.chemistry?.total ?? '–'} · ` +
      `card value ${coins(res.cost)}.` +
      (check.length ? ` ⚠ Check yourself: ${check.join('; ')}.` : '') +
      `${more} Check the squad, then submit it yourself.`;
  }

  window.__futAssistantOneClick = { solveAndFill, refreshClub, placedEarlier };
})();
