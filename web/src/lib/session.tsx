/**
 * Who is signed in, and how their transactions get signed:
 * - "device": a Handova account (`name.handova.testnet`) whose key lives on this device. Calls
 *   are signed as NEP-366 delegate actions and sent through Handova's relayer — no gas, no NEAR.
 * - "wallet": an existing NEAR wallet through NEAR Connect (HOT, Meteor, MyNearWallet…). The
 *   wallet signs and pays the (tiny) gas itself.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Account, actions, teraToGas, type KeyPairString } from 'near-api-js';
import { generateSeedPhrase, parseSeedPhrase } from 'near-api-js/seed-phrase';
import { NearConnector } from '@hot-labs/near-connect';
import { gaslessCall } from '../../../shared/gasless';
import { summarize, type TxSummary } from '../../../shared/outcome';
import { API_BASE, api } from './api';
import { getProvider, nearConfig } from './near';

const STORE = 'handova:device-account';

interface DeviceAccount {
  accountId: string;
  secretKey: string;
  seedPhrase?: string;
  backedUp?: boolean;
}

export interface CallOpts {
  deposit?: bigint;
  gas?: bigint;
}

export interface Session {
  accountId: string;
  kind: 'device' | 'wallet';
  /** Recovery phrase not yet confirmed as written down. */
  needsBackup: boolean;
  call(receiverId: string, method: string, args: object, opts?: CallOpts): Promise<TxSummary>;
  /** Signed and paid by the account itself — for calls the relayer won't pay for (e.g. 1-yocto `nft_transfer`). */
  callDirect(receiverId: string, method: string, args: object, opts?: CallOpts): Promise<TxSummary>;
}

interface SessionCtx {
  session: Session | null;
  ready: boolean;
  createAccount(name: string): Promise<string>;
  restore(seedPhrase: string, accountId: string): Promise<void>;
  connectWallet(): Promise<void>;
  signOut(): Promise<void>;
  seedPhrase(): string | undefined;
  markBackedUp(): void;
}

const Ctx = createContext<SessionCtx | null>(null);

function loadDevice(): DeviceAccount | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as DeviceAccount) : null;
  } catch {
    return null;
  }
}

function saveDevice(d: DeviceAccount | null) {
  try {
    if (d) localStorage.setItem(STORE, JSON.stringify(d));
    else localStorage.removeItem(STORE);
  } catch { /* private mode: session lasts until reload */ }
}

function deviceSession(d: DeviceAccount): Session {
  const account = new Account(d.accountId, getProvider(), d.secretKey as KeyPairString);
  return {
    accountId: d.accountId,
    kind: 'device',
    needsBackup: !!d.seedPhrase && !d.backedUp,
    call: (receiverId, method, args, opts = {}) => gaslessCall(API_BASE, account, receiverId, method, args, opts),
    callDirect: async (receiverId, method, args, opts = {}) => {
      const outcome = await account.signAndSendTransaction({
        receiverId,
        actions: [actions.functionCall(method, args, opts.gas ?? teraToGas('100'), opts.deposit ?? 0n)],
        throwOnFailure: false,
      });
      return summarize(outcome);
    },
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [device, setDevice] = useState<DeviceAccount | null>(() => loadDevice());
  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const connector = useRef<NearConnector | null>(null);

  const getConnector = useCallback(() => {
    connector.current ??= new NearConnector({ network: nearConfig().network, footerBranding: null });
    return connector.current;
  }, []);

  useEffect(() => {
    if (device) return setReady(true);
    // Restore an existing wallet connection quietly.
    const c = getConnector();
    c.on('wallet:signIn', (t: any) => setWalletAccount(t.accounts?.[0]?.accountId ?? null));
    c.on('wallet:signOut', () => setWalletAccount(null));
    c.getConnectedWallet()
      .then(({ accounts }) => setWalletAccount(accounts[0]?.accountId ?? null))
      .catch(() => {})
      .finally(() => setReady(true));
  }, [device, getConnector]);

  const session = useMemo<Session | null>(() => {
    if (device) return deviceSession(device);
    if (!walletAccount) return null;
    const viaWallet = async (receiverId: string, method: string, args: object, opts: CallOpts = {}) => {
      const wallet = await getConnector().wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId,
        actions: [actions.functionCall(method, args, opts.gas ?? teraToGas('100'), opts.deposit ?? 0n) as any],
      });
      return summarize(outcome);
    };
    return { accountId: walletAccount, kind: 'wallet', needsBackup: false, call: viaWallet, callDirect: viaWallet };
  }, [device, walletAccount, getConnector]);

  const value: SessionCtx = {
    session,
    ready,
    async createAccount(name) {
      // The key is made here, on the device. Only the public key goes to the server.
      const { seedPhrase, keyPair } = generateSeedPhrase();
      const { accountId } = await api<{ accountId: string }>('/api/accounts', { name, publicKey: keyPair.getPublicKey().toString() });
      const d = { accountId, secretKey: keyPair.toString(), seedPhrase, backedUp: false };
      saveDevice(d);
      setDevice(d);
      return accountId;
    },
    async restore(seedPhrase, accountId) {
      const keyPair = parseSeedPhrase(seedPhrase.trim().toLowerCase().replace(/\s+/g, ' '));
      const keys = await getProvider().viewAccessKeyList({ accountId }).catch(() => null);
      const pk = keyPair.getPublicKey().toString();
      if (!keys?.keys?.some((k: any) => k.public_key === pk)) throw new Error("That phrase doesn't match this account. Check the words and the account name.");
      const d = { accountId, secretKey: keyPair.toString(), seedPhrase, backedUp: true };
      saveDevice(d);
      setDevice(d);
    },
    async connectWallet() {
      const w = await getConnector().connect();
      const accounts = await w.getAccounts();
      setWalletAccount(accounts[0]?.accountId ?? null);
    },
    async signOut() {
      if (device) {
        saveDevice(null);
        setDevice(null);
      } else {
        await getConnector().disconnect().catch(() => {});
        setWalletAccount(null);
      }
    },
    seedPhrase: () => device?.seedPhrase,
    markBackedUp() {
      if (!device) return;
      const d = { ...device, backedUp: true };
      saveDevice(d);
      setDevice(d);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}
