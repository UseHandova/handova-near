/**
 * Minimal shim for @/onchain-money — used by components that import parseAmount / parseUsdc / formatAmount.
 * USDC on Arc has 6 decimals on both mainnet and testnet.
 */
import { parseUnits, formatUnits } from 'viem';

const USDC_DECIMALS = 6;

export interface ParsedAmount {
  raw: bigint;
  decimals: number;
}

/**
 * Parse a human-readable USDC string (e.g. "512.5") into raw units.
 * chainId is accepted for API compatibility but ignored — USDC always has 6 decimals on Arc.
 */
export function parseAmount(_chainId: number, amount: string): ParsedAmount {
  return { raw: parseUnits(amount, USDC_DECIMALS), decimals: USDC_DECIMALS };
}

/** Parse a USDC string directly to bigint. */
export function parseUsdc(amount: string): bigint {
  return parseUnits(amount, USDC_DECIMALS);
}

/** Format raw USDC units back to a human-readable string. */
export function formatAmount(_chainId: number, parsed: ParsedAmount): string {
  return formatUnits(parsed.raw, parsed.decimals);
}
