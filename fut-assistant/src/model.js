// Card model: turns whatever the club export gives us into one consistent shape.

export function qualityOf(rating) {
  if (rating >= 75) return 'gold';
  if (rating >= 65) return 'silver';
  return 'bronze';
}

// Rough market value by rating, used when a card has no price.
// Only a fallback: real prices should come from your own price data.
const GOLD_PRICES = {
  75: 300, 76: 350, 77: 400, 78: 450, 79: 500, 80: 600, 81: 750, 82: 900,
  83: 1200, 84: 2200, 85: 4500, 86: 9000, 87: 16000, 88: 26000, 89: 40000, 90: 60000,
};

export function estimatePrice(rating, rare = false) {
  const q = qualityOf(rating);
  if (q === 'bronze') return rare ? 250 : 150;
  if (q === 'silver') return rare ? 350 : 200;
  if (rating > 90) return Math.round(60000 * 1.5 ** (rating - 90));
  const base = GOLD_PRICES[rating];
  return rare && rating <= 82 ? Math.round(base * 1.2) : base;
}

const toList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function normalizePlayer(raw) {
  const rating = Number(raw.rating);
  if (!Number.isFinite(rating)) throw new Error(`Card ${raw.id ?? '?'} has no numeric rating`);
  const special = Boolean(raw.special);
  const rare = special || Boolean(raw.rare ?? raw.rarity === 'rare');
  return {
    id: String(raw.id),
    // Same player in a different version/copy shares a baseId; a squad can't hold two.
    baseId: String(raw.baseId ?? raw.id),
    name: raw.name ?? `#${raw.id}`,
    rating,
    positions: toList(raw.positions ?? raw.position).map((p) => String(p).toUpperCase()),
    nation: raw.nation ?? null,
    league: raw.league ?? null,
    club: raw.club ?? null,
    rare,
    special,
    rarity: raw.rarity ?? (special ? 'special' : rare ? 'rare' : 'common'),
    isIcon: Boolean(raw.isIcon),
    isHero: Boolean(raw.isHero),
    untradeable: Boolean(raw.untradeable),
    duplicate: Boolean(raw.duplicate),
    price: raw.price != null ? Number(raw.price) : estimatePrice(rating, rare),
    quality: qualityOf(rating),
    virtual: false,
  };
}

export function normalizeClub(data) {
  const list = Array.isArray(data) ? data : data?.players ?? data?.items;
  if (!Array.isArray(list)) throw new Error('Club file must be an array of cards or { "players": [...] }');
  return list.map(normalizePlayer);
}
