// Pulls a lightweight, self-computed signal from Etsy's official Open API v3 public
// listing-search endpoint (API key only, no OAuth needed for public search) — NOT real
// trend/search-volume data, just tag/word frequency across recently-active, highly-
// favorited listings for a chosen keyword/category. See ARCHITECTURE.md's Trends
// Provider Layer for why this is the sanctioned alternative to scraping.
// TODO: implement the actual GET /listings/active call + frequency tally.

export async function getTrends(_category) {
  if (!process.env.ETSY_API_KEY) {
    throw new Error('Etsy Open API is not configured. Set ETSY_API_KEY in backend/.env to enable it.');
  }
  // TODO: fetch(`${ETSY_API_BASE}/listings/active?keywords=${encodeURIComponent(category)}`, { headers: { 'x-api-key': process.env.ETSY_API_KEY } })
  //       then tally tag/word frequency across the results into a ranked list.
  return [];
}
