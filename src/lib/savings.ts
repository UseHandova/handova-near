/**
 * Rent savings (client): the plan lives on the server, the money in RentSavingsVault (only the saver can move it).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPublicClient, encodeFunctionData, parseAbi, type Address } from 'viem';
import { arcTransport } from '@/lib/arc-rpc';
import { CHAIN } from '@/lib/network';
import type { SmartAccount } from 'viem/account-abstraction';
import { api, hasSession } from '@/lib/api';
import { USDC_TO_NGN } from '@/lib/naira';
import type { Frequency } from '@/lib/savings-math';
import { sendUserOp } from '@/lib/chain';

export const VAULT_ADDRESS = (import.meta.env.VITE_SAVINGS_VAULT_ADDRESS ?? '') as Address;
const USDC = '0x3600000000000000000000000000000000000000' as Address;
const VAULT_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function deposit(uint256)',
  'function withdraw(uint256 amount, address to)',
]);
const ERC20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const read = createPublicClient({ chain: CHAIN, transport: arcTransport(import.meta.env.VITE_ARC_RPC_URL as string | undefined) });

export interface SavingsPlan { goalNgn: number; startAt: number; dueAt: number; frequency: Frequency; day: number; label: string; reminders: boolean }

const toRaw = (ngn: number) => BigInt(Math.round((ngn / USDC_TO_NGN) * 1e6));
const toNgn = (raw: bigint) => (Number(raw) / 1e6) * USDC_TO_NGN;

export function useSavings(account: SmartAccount) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(() => hasSession(account.address));
  const planKey = ['savings-plan', account.address.toLowerCase()];
  const balKey = ['savings-balance', account.address.toLowerCase()];
  const plan = useQuery({
    queryKey: planKey,
    enabled: connected,
    queryFn: () => api<{ plan: SavingsPlan | null }>(account, '/api/savings/plan').then(r => r.plan),
    retry: false,
  });
  const balances = useQuery({
    queryKey: balKey,
    enabled: !!VAULT_ADDRESS,
    queryFn: async () => {
      const [saved, wallet] = await Promise.all([
        read.readContract({ address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: 'balanceOf', args: [account.address] }),
        read.readContract({ address: USDC, abi: ERC20, functionName: 'balanceOf', args: [account.address] }),
      ]);
      return { savedNgn: toNgn(saved), walletNgn: toNgn(wallet) };
    },
    refetchInterval: 30_000,
  });

  async function send(calls: { to: Address; data: `0x${string}` }[]) {
    await sendUserOp(account, calls);
    await qc.invalidateQueries({ queryKey: balKey });
  }

  return {
    plan: plan.data ?? null, planLoading: connected && plan.isLoading, connected, connect: () => setConnected(true),
    savedNgn: balances.data?.savedNgn ?? 0, walletNgn: balances.data?.walletNgn ?? 0, balancesLoading: balances.isLoading,
    available: !!VAULT_ADDRESS,
    async savePlan(p: { goalNgn: number; dueAt: number; frequency: Frequency; day: number; label: string; phone?: string }) {
      const r = await api<{ plan: SavingsPlan }>(account, '/api/savings/plan', { body: p });
      qc.setQueryData(planKey, r.plan);
      setConnected(true);
      return r.plan;
    },
    async stopPlan() {
      await api(account, '/api/savings/plan/stop', { body: {} });
      qc.setQueryData(planKey, null);
    },
    /** Approve + deposit in one gasless user operation. */
    deposit: (ngn: number) => send([
      { to: USDC, data: encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [VAULT_ADDRESS, toRaw(ngn)] }) },
      { to: VAULT_ADDRESS, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'deposit', args: [toRaw(ngn)] }) },
    ]),
    withdraw: (ngn: number) => send([
      { to: VAULT_ADDRESS, data: encodeFunctionData({ abi: VAULT_ABI, functionName: 'withdraw', args: [toRaw(ngn), account.address] }) },
    ]),
  };
}
