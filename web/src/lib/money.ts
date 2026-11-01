import { useEffect, useState } from 'react';
import { api } from './api';

let rate = 1600;
let loaded: Promise<void> | null = null;

/** Live USD→NGN rate (falls back to 1600). Prices on-chain are USDC; Naira is for display. */
export function useNgnRate(): number {
  const [r, setR] = useState(rate);
  useEffect(() => {
    loaded ??= api<{ rate: number }>('/api/fx').then((x) => { rate = x.rate; }).catch(() => {});
    loaded.then(() => setR(rate));
  }, []);
  return r;
}

export const usdc = (units: string | bigint, decimals = 6) => Number(BigInt(units)) / 10 ** decimals;

/** Rounded to ₦100: prices are stored in whole USDC cents, so exact Naira would look like ₦999,994. */
export function naira(usdcAmount: number, ngnPerUsd: number): string {
  const ngn = Math.round((usdcAmount * ngnPerUsd) / 100) * 100;
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(ngn);
}

export function usd(usdcAmount: number): string {
  return `${usdcAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}
