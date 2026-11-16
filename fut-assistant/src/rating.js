// Team rating as the community understands EA's formula: every player rated above
// the average adds the difference again, then the total is rounded and divided.
// Verify against the in-game rating before trusting edge cases.

export function ratingTotal(ratings, size = ratings.length) {
  if (!ratings.length) return 0;
  const sum = ratings.reduce((a, b) => a + b, 0);
  const avg = sum / size;
  let excess = 0;
  for (const r of ratings) if (r > avg) excess += r - avg;
  return sum + excess;
}

export function teamRating(ratings, size = ratings.length) {
  if (!ratings.length) return 0;
  return Math.floor(Math.round(ratingTotal(ratings, size)) / size);
}
