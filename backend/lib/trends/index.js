import * as manual from './manual.js';
import * as etsyApi from './etsy-api.js';

function getActiveProvider() {
  const provider = process.env.TRENDS_PROVIDER || 'manual';
  return provider === 'etsy_api' ? etsyApi : manual;
}

export async function getTrends(category) {
  return getActiveProvider().getTrends(category);
}
