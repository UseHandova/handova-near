/** USDC amounts: on-chain base units (6 decimals) ↔ display. */
export const USDC_DECIMALS = 6;

export function toUnits(amount: number | string, decimals = USDC_DECIMALS): bigint {
  const [whole, frac = ''] = String(amount).split('.');
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

export function fromUnits(units: bigint | string, decimals = USDC_DECIMALS, places = 2): string {
  const u = BigInt(units);
  const base = 10n ** BigInt(decimals);
  const whole = u / base;
  const frac = (u % base).toString().padStart(decimals, '0').slice(0, places);
  return places ? `${whole.toLocaleString('en-US')}.${frac}` : whole.toLocaleString('en-US');
}
