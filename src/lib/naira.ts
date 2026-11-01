/**
 * Naira display helpers.
 * All prices are USDC internally. We show them in NGN using a fixed exchange rate
 * that defaults to 1 USDC ≈ 1600 NGN (update USDC_TO_NGN as needed).
 */

export const USDC_TO_NGN = 1600;

/** Format a USDC amount (6-decimal integer or float string) as Naira. */
export function formatNaira(usdcAmount: number | string): string {
  const n = typeof usdcAmount === 'string' ? parseFloat(usdcAmount) : usdcAmount;
  if (isNaN(n)) return '₦0';
  const ngn = n * USDC_TO_NGN;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(ngn);
}

/** Parse a Naira string input into USDC (float). */
export function nairaToUsdc(ngnAmount: number): number {
  return ngnAmount / USDC_TO_NGN;
}

/** Format a USDC float as a human-readable USDC string with 2 dp. */
export function formatUsdc(usdcFloat: number): string {
  return usdcFloat.toFixed(2) + ' USDC';
}
