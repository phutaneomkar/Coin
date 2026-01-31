/**
 * Format price to match CoinDCX exactly - no rounding.
 * 0.00006 shows as 0.00006, NOT 0.0001
 */
export function formatPrice(price: number | undefined | null): string {
  if (price == null || typeof price !== 'number' || !Number.isFinite(price)) return '—';
  const abs = Math.abs(price);
  // Use enough decimals so we never round (e.g. 0.00006 stays 0.00006)
  let decimals = 2;
  if (abs > 0 && abs < 0.00001) decimals = 10;
  else if (abs > 0 && abs < 0.0001) decimals = 8;
  else if (abs > 0 && abs < 0.01) decimals = 8;
  else if (abs > 0 && abs < 1) decimals = 6;
  else if (abs >= 1 && abs < 1000) decimals = 5;
  else if (abs >= 1000) decimals = 2;
  const s = price.toFixed(decimals);
  // Do NOT trim trailing zeros for low prices to match CoinDCX precision (e.g. 0.09930)
  return '$' + s;
}

/** Format price without $ prefix (for use with existing $ in template) */
export function formatPriceRaw(price: number | undefined | null): string {
  if (price == null || typeof price !== 'number' || !Number.isFinite(price)) return '0';
  const abs = Math.abs(price);
  let decimals = 2;
  if (abs > 0 && abs < 0.00001) decimals = 10;
  else if (abs > 0 && abs < 0.0001) decimals = 8;
  else if (abs > 0 && abs < 0.01) decimals = 8;
  else if (abs > 0 && abs < 1) decimals = 6;
  else if (abs >= 1 && abs < 1000) decimals = 5;
  else if (abs >= 1000) decimals = 2;
  const s = price.toFixed(decimals);
  // Do NOT trim trailing zeros for low prices
  return s;
}
