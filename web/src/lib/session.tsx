/**
 * Who is signed in, and how their transactions get signed:
 * - "device": a Handova account (`name.handova.testnet`) whose key lives on this device. Calls
 *   are signed as NEP-366 delegate actions and sent through Handova's relayer — no gas, no NEAR.
 * - "wallet": an existing NEAR wallet through NEAR Connect (HOT, Meteor, MyNearWallet…). The
 *   wallet signs and pays the (tiny) gas itself.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Account, KeyPair, KeyPairSigner, actions, teraToGas, type KeyPairString } from 'near-api-js';
import { generateSeedPhrase, parseSeedPhrase } from 'near-api-js/seed-phrase';
import { NearConnector } from '@hot-labs/near-connect';
import { gaslessCall } from '../../../shared/gasless';
import { summarize, type TxSummary } from '../../../shared/outcome';
import type { SignedNep413 } from '../../../shared/nep413';
import { API_BASE, api } from './api';
import { getProvider, getSigningProvider, nearConfig } from './near';

const STORE = 'handova:device-account';

/**
 * What the person mainly does on Handova. It only chooses which pages the navigation shows (My rentals
 * or My listings); every page stays reachable and the contract doesn't care. Kept per account on
 * this device; on a new device the person is asked again.
 */
export type Role = 'tenant' | 'landlord';
const roleKey = (accountId: string) => `handova:role:${accountId}`;
function loadRole(accountId: string): Role | null {
  try {
    const r = localStorage.getItem(roleKey(accountId));
    return r === 'tenant' || r === 'landlord' ? r : null;
  } catch {
    return null;
  }
}
function saveRole(accountId: string, role: Role) {
  try { localStorage.setItem(roleKey(accountId), role); } catch { /* private mode: asked again next time */ }
}

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
  /** NEP-413: prove control of the account by signing a message (no transaction, no gas). */
  signMessage(message: string, nonce: Uint8Array, recipient: string): Promise<SignedNep413>;
}

const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

interface SessionCtx {
  session: Session | null;
  ready: boolean;
  /** Null until the signed-in person has chosen. */
  role: Role | null;
  setRole(role: Role): void;
  createAccount(name: string, role: Role): Promise<string>;
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
  const account = new Account(d.accountId, getSigningProvider(), d.secretKey as KeyPairString);
  return {
    accountId: d.accountId,
    kind: 'device',
    needsBackup: !!d.seedPhrase && !d.backedUp,
    call: (receiverId, method, args, opts = {}) => gaslessCall(API_BASE, account, receiverId, method, args, opts),
    callDirect: async (receiverId, method, args, opts = {}) => {
      try {
        const outcome = await account.signAndSendTransaction({
          receiverId,
          actions: [actions.functionCall(method, args, opts.gas ?? teraToGas('30'), opts.deposit ?? 0n)],
          throwOnFailure: false,
        });
        return summarize(outcome);
      } catch (e) {
        const msg = (e as Error).message ?? '';
        if (/not enough balance|NotEnoughBalance|LackBalance/i.test(msg)) {
          throw new Error(`This step needs a tiny NEAR network fee and ${d.accountId} has too little NEAR. Send it about 0.05 NEAR and try again.`);
        }
        throw new Error('The NEAR network did not accept the transaction. Try again in a minute.');
      }
    },
    signMessage: async (message, nonce, recipient) => {
      const signed = await new KeyPairSigner(KeyPair.fromString(d.secretKey as KeyPairString)).signNep413Message(d.accountId, { message, nonce, recipient });
      return { accountId: d.accountId, publicKey: signed.publicKey.toString(), signature: toBase64(signed.signature) };
    },
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [device, setDevice] = useState<DeviceAccount | null>(() => loadDevice());
  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const connector = useRef<NearConnector | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});

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
    const signMessage = async (message: string, nonce: Uint8Array, recipient: string) => {
      const wallet = await getConnector().wallet();
      const signed = await wallet.signMessage({ message, nonce, recipient });
      return { accountId: signed.accountId ?? walletAccount, publicKey: signed.publicKey, signature: signed.signature };
    };
    return { accountId: walletAccount, kind: 'wallet', needsBackup: false, call: viaWallet, callDirect: viaWallet, signMessage };
  }, [device, walletAccount, getConnector]);

  const role = session ? (roles[session.accountId] ?? loadRole(session.accountId)) : null;
  const rememberRole = (accountId: string, r: Role) => {
    saveRole(accountId, r);
    setRoles((x) => ({ ...x, [accountId]: r }));
  };

  const value: SessionCtx = {
    session,
    ready,
    role,
    setRole(r) {
      if (session) rememberRole(session.accountId, r);
    },
    async createAccount(name, r) {
      // The key is made here, on the device. Only the public key goes to the server.
      const { seedPhrase, keyPair } = generateSeedPhrase();
      const { accountId } = await api<{ accountId: string }>('/api/accounts', { name, publicKey: keyPair.getPublicKey().toString(), role: r });
      const d = { accountId, secretKey: keyPair.toString(), seedPhrase, backedUp: false };
      rememberRole(accountId, r);
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
