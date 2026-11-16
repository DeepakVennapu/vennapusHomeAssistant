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
- There's no club import from the Web App yet; that is the next step.
