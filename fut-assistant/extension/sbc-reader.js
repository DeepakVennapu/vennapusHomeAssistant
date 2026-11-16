// FUT Assistant – read the open SBC's requirements (READ-ONLY, no network calls).
//
// Reads the requirement list of the SBC that's open in the Web App and converts it to
// FUT Assistant's format. EA's requirement codes are undocumented: names are read from
// the Web App's own SBCEligibilityKey / SBCEligibilityScope tables at runtime, and
// anything that can't be understood is listed as "unsupported" instead of guessed.
// The text EA shows on screen is copied too, so you can compare.

(() => {
  'use strict';

  const tryCall = (fn) => { try { return fn(); } catch { return undefined; } };

  // Invert an enum-like object { NAME: 12 } → { 12: 'NAME' }.
  const invert = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v, k]));

  const QUALITY = { 1: 'bronze', 2: 'silver', 3: 'gold' };
  const QUALITY_RANK = { bronze: 1, silver: 2, gold: 3 };

  // Turn whatever holds the key → values pairs into [[key, [values]], ...].
  function kvEntries(req) {
    const kv = req.kvPairs ?? req._kvPairs ?? req.kvpairs;
    const out = [];
    const add = (k, v) => out.push([Number(k), (Array.isArray(v) ? v : [v]).map(Number).filter(Number.isFinite)]);
    if (kv instanceof Map) kv.forEach((v, k) => add(k, v));
    else if (kv && typeof kv === 'object') {
      const coll = kv._collection ?? kv.collection ?? kv;
      for (const [k, v] of Object.entries(coll)) if (/^\d+$/.test(k)) add(k, v);
    }
    if (!out.length && req.key != null) {
      const vals = req.values ?? req.value ?? tryCall(() => req.getValue?.(req.key)) ?? [];
      add(req.key, vals);
    }
    return out;
  }

  // Scope → min/max for a number n. Unknown scope is treated as "at least".
  function bounds(scope, n) {
    if (scope === 'LOWER') return { max: n };
    if (scope === 'EXACT') return { min: n, max: n };
    return { min: n };
  }

  // Map one (key, values) pair of a requirement. Returns { req } or { unsupported }.
  function mapPair(keyName, values, scopeName, count) {
    const v = values[0];
    const perPlayer = count == null || count < 0; // EA uses -1 for "applies to every player / the team"
    const n = perPlayer ? undefined : count;
    switch (keyName) {
      case 'TEAM_RATING':
      case 'TEAM_RATING_1_TO_100':
        return { req: { kind: 'teamRating', min: v } };
      case 'TEAM_CHEMISTRY':
      case 'CHEMISTRY_POINTS':
        return { req: { kind: 'chemistry', min: v } };
      case 'ALL_PLAYERS_CHEMISTRY_POINTS':
        return { req: { kind: 'playerChem', min: v } };
      case 'PLAYER_COUNT':
        return { squadSize: v };
      case 'SAME_NATION_COUNT': return { req: { kind: 'sameAttr', attr: 'nationId', ...bounds(scopeName, v) } };
      case 'SAME_LEAGUE_COUNT': return { req: { kind: 'sameAttr', attr: 'leagueId', ...bounds(scopeName, v) } };
      case 'SAME_CLUB_COUNT': return { req: { kind: 'sameAttr', attr: 'clubId', ...bounds(scopeName, v) } };
      case 'NATION_COUNT': return { req: { kind: 'distinct', attr: 'nationId', ...bounds(scopeName, v) } };
      case 'LEAGUE_COUNT': return { req: { kind: 'distinct', attr: 'leagueId', ...bounds(scopeName, v) } };
      case 'CLUB_COUNT': return { req: { kind: 'distinct', attr: 'clubId', ...bounds(scopeName, v) } };
      case 'NATION_ID': return { req: { kind: 'count', filter: { nationId: values }, ...bounds(scopeName, n ?? 1) } };
      case 'LEAGUE_ID': return { req: { kind: 'count', filter: { leagueId: values }, ...bounds(scopeName, n ?? 1) } };
      case 'CLUB_ID': return { req: { kind: 'count', filter: { clubId: values }, ...bounds(scopeName, n ?? 1) } };
      case 'PLAYER_RARITY':
        return { req: { kind: 'count', filter: { rareflag: values }, ...bounds(scopeName, n ?? 1) } };
      case 'PLAYER_MIN_OVR':
        return perPlayer ? { req: { kind: 'each', filter: { minRating: v } } }
          : { req: { kind: 'count', filter: { minRating: v }, ...bounds(scopeName, n) } };
      case 'PLAYER_MAX_OVR':
        return perPlayer ? { req: { kind: 'each', filter: { maxRating: v } } }
          : { req: { kind: 'count', filter: { maxRating: v }, ...bounds(scopeName, n) } };
      case 'PLAYER_EXACT_OVR':
        return { req: { kind: 'count', filter: { minRating: v, maxRating: v }, ...bounds(scopeName, n ?? 1) } };
      case 'PLAYER_QUALITY':
      case 'PLAYER_LEVEL': {
        const q = QUALITY[v];
        if (!q) return { unsupported: true };
        if (perPlayer) {
          // "Player quality: Min Silver" → every player silver or better, and so on.
          const allowed = Object.keys(QUALITY_RANK).filter((name) =>
            scopeName === 'LOWER' ? QUALITY_RANK[name] <= v : scopeName === 'EXACT' ? QUALITY_RANK[name] === v : QUALITY_RANK[name] >= v);
          return { req: { kind: 'each', filter: { quality: allowed } }, uncertain: true };
        }
        return { req: { kind: 'count', filter: { quality: q }, ...bounds(scopeName, n) }, uncertain: true };
      }
      case 'PLAYER_RARITY_GROUP':
        // Group 4 is believed to be "Rare" (rare + special cards). Other groups aren't mapped yet.
        if (values.length === 1 && values[0] === 4) {
          return { req: { kind: 'count', filter: { rare: true }, ...bounds(scopeName, n ?? 1) }, uncertain: true };
        }
        return { unsupported: true };
      default:
        return { unsupported: true };
    }
  }

  // Requirement text exactly as EA shows it, for comparing.
  function screenText() {
    const nodes = document.querySelectorAll('[class*="requirement" i] li, [class*="Requirement"] li, [class*="eligibility" i] li');
    return [...new Set([...nodes].map((n) => n.innerText?.trim()).filter(Boolean))].slice(0, 20);
  }

  function readOpenSbc() {
    const prefill = window.__futAssistantPrefill;
    if (!prefill) throw new Error('Pre-fill script did not load.');
    const challenge = prefill.findOpenChallenge();
    const keyNames = invert(window.SBCEligibilityKey);
    const scopeNames = invert(window.SBCEligibilityScope);
    const reqs = challenge.eligibilityRequirements ?? tryCall(() => challenge.getEligibilityRequirements?.()) ?? [];

    const sbc = { id: `ea-${challenge.id ?? 'sbc'}`, name: challenge.name ?? `SBC ${challenge.id ?? ''}`.trim(), requirements: [] };
    const unsupported = [];
    const uncertain = [];

    for (const r of reqs) {
      const scopeName = scopeNames[r.scope] ?? (typeof r.scope === 'string' ? r.scope.toUpperCase() : 'GREATER');
      const count = r.count != null ? Number(r.count) : -1;
      for (const [key, values] of kvEntries(r)) {
        const keyName = keyNames[key] ?? `KEY_${key}`;
        const raw = { key: keyName, scope: scopeName, count, values };
        const mapped = values.length ? mapPair(keyName, values, scopeName, count) : { unsupported: true };
        if (mapped.squadSize) { sbc.squadSize = mapped.squadSize; continue; }
        if (mapped.unsupported) { unsupported.push(raw); continue; }
        mapped.req.source = raw;
        if (mapped.uncertain) { mapped.req.uncertain = true; uncertain.push(raw); }
        sbc.requirements.push(mapped.req);
      }
    }

    if (!sbc.squadSize) {
      // Smaller SBCs lock some spots ("bricks"); count the open ones.
      const slots = tryCall(() => challenge.squad.getFieldPlayers?.()) ?? [];
      const open = slots.filter((s) => !tryCall(() => s?.isBrick?.()));
      if (open.length && open.length < 11) sbc.squadSize = open.length;
    }
    for (const u of unsupported) sbc.requirements.push({ kind: 'unsupported', source: u, label: `Not understood: ${u.key} ${u.scope} ${u.values.join('/')}${u.count >= 0 ? ` ×${u.count}` : ''}` });

    return {
      kind: 'fut-assistant-sbc',
      v: 1,
      readAt: new Date().toISOString(),
      sbc,
      unsupported: unsupported.length,
      uncertain: uncertain.length,
      eaText: screenText(),
      enumsFound: Object.keys(keyNames).length > 0,
    };
  }

  window.__futAssistantSbc = { readOpenSbc, mapPair, kvEntries };
})();
