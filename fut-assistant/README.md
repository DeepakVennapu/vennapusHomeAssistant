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
- The club export is tested against a mock of the Web App, not EA's real one yet.
- No pre-fill into the Web App yet; you build the squad yourself.
