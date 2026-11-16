# FUT Assistant (proof of concept)

A local SBC solver for EA FC Ultimate Team. It runs only on your machine and never logs in to EA.

- **Solve once:** finds the cheapest squad from your club that meets an SBC's requirements.
  Fodder order: storage duplicates → untradeables → tradeables. Cards rated 87+ are protected by default.
- **How many times can I do it?:** solves repeatedly, setting used cards aside, and tells you how many
  times your club covers the SBC, what stops the next attempt, and (optionally) what to buy for one more.

You build the squad yourself in the game or Web App, check it, and submit.

## Run it

Needs Node 20+. No dependencies to install.

```bash
cd fut-assistant
npm start                 # web page at http://127.0.0.1:5177
npm test                  # unit tests
node src/cli.js list      # list sample SBCs
node src/cli.js solve league-mix
node src/cli.js repeat rated-84 --market
node src/cli.js solve rated-84 --club my-club.json --protect 86
```

## Import your club (Chrome extension)

`extension/` is a read-only Chrome extension. It adds a small **FUT Assistant** panel to EA's
Web App with one button, **Export club (read-only)**. That button reads your club players and SBC
storage through the Web App's own read calls and saves `fut-club-YYYY-MM-DD.json` to your computer.

- It never buys, sells, lists, moves, quick-sells or submits anything.
- It sends nothing anywhere except that file.
- It reads one page of about 91 cards every 1.5–3 seconds, roughly the pace of scrolling your club by hand.
- Loan players and cards locked in Evolutions are skipped.

**Install:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick
the `fut-assistant/extension` folder.

**Use:**
1. Open the Web App, log in, and wait for it to finish loading.
2. Click **Export club**.
3. In FUT Assistant (`npm start`), choose **Load a club JSON file…** and pick the saved file.
   The page remembers it for next time.

The Web App's internals are undocumented and change between seasons. If names show as
`League 13` or positions look wrong, the mapping needs updating. Send the file's `meta` section
(especially `meta.sampleKeys`) and it can be fixed. Chemistry and "same league/club" checks still
work with ids instead of names, but sample SBCs that filter by league name (e.g. "Premier League")
need the real name or must be edited.

## Read an SBC's requirements (Chrome extension)

With an SBC open in the Web App, press **Copy SBC requirements** in the panel. Then press
**Paste SBC from Web App** in FUT Assistant. This reads only what's already on screen and makes no
network calls.

- League, nation and club rules come through as EA ids. The page shows names from your imported club.
- Requirements read with a guessed meaning (player quality, "Rare") are marked **⚠ double-check**.
- Requirements it doesn't understand (for example "first owner") are listed as **⚠ not checked**
  rather than dropped. Check those yourself.
- The requirement text EA shows is copied too, so you can compare it with what was read.

## Pre-fill an SBC (Chrome extension)

1. In FUT Assistant, solve the SBC and press **Copy pre-fill code**. Each attempt in
   "How many times can I do it?" has its own code.
2. In the Web App, open that SBC so its squad is on screen.
3. Paste the code into the extension panel and press **Pre-fill open SBC**.
4. Check the squad, then submit it yourself.

What pre-fill does:
- It looks up only the cards it hasn't already read this session (storage first, then club pages,
  stopping as soon as it has them all).
- It places them in their own positions where possible.
- It saves the squad draft once, the same as EA's page does when you place cards by hand.

What pre-fill never does:
- It never submits, buys, sells or lists anything.
- It fills only one squad per click and waits 30 seconds between fills.
- It doesn't buy "buy" cards. It leaves those spots empty and names the cards for you.

If the screen doesn't update after a fill, go back and reopen the SBC. If it says no open SBC was
found, or that it found more than one, the Web App's internals have probably changed and the
`findOpenChallenge` lookup in `extension/prefill.js` needs adjusting.

## Club file format

A JSON array of cards, or `{ "players": [...] }`:

```json
{
  "id": 123,                 // unique card id
  "baseId": 456,             // same player across versions/copies (a squad can't hold two)
  "name": "A. Player",
  "rating": 84,
  "positions": ["CM", "CDM"],
  "nation": "Spain", "league": "Premier League", "club": "Arsenal",
  "rare": true, "special": false,
  "untradeable": true,       // untradeable cards are cheaper fodder
  "duplicate": false,        // true = sitting in SBC storage
  "price": 2200              // optional; estimated from rating if missing
}
```

`data/sample-club.json` is made-up data from `npm run sample`.

## SBC format

See `data/sbcs.json`. Requirement kinds: `teamRating`, `chemistry`, `count` (with a filter such as
`{ "rare": true }` or `{ "league": "Serie A" }`), `sameAttr`, `distinct`, `each`. Optional
`squadSize` (default 11) and `formations` (default: all built-in ones; the best is picked).

## Known limits

- Team rating and chemistry follow the community-known formulas; check edge cases against the game.
- Icon/Hero chemistry boosts are approximated.
- Market prices in `data/market-prices.json` are placeholders, and "buy" cards have no league, nation or club.
- Repeat counts are a greedy estimate.
- The club export and pre-fill are tested against a mock of the Web App, not EA's real one yet.
- Using any extension inside the Web App is against EA's terms. Pre-fill writes a squad draft; that
  is lower risk than auto-submitting, but not zero.
