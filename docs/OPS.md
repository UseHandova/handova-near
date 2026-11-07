# Running the Handova server: hot keys, pausing, rotating

The API server (Railway in the hosted demo) signs with three NEAR keys from its environment. The escrow contract itself has no keys. This page lists what each server key can do, how to switch each part off, and how to replace a key. Testnet only.

## What the server's keys can do

Checked on testnet on 7 Nov 2026: each account has exactly one key, it is a **full-access** key, and it is the one in the server's environment.

| Env vars | Account | The server uses it to | The same key can also |
|---|---|---|---|
| `RELAYER_ACCOUNT_ID` / `RELAYER_PRIVATE_KEY` | `handova-relayer.testnet` | Pay gas for users' signed calls; run the keeper | Spend the relayer's NEAR |
| `CREATOR_ACCOUNT_ID` / `CREATOR_PRIVATE_KEY` | `handova.testnet` | Create `name.handova.testnet` accounts and fund them (0.15 NEAR for landlords, 0.05 for others) | Act as the escrow **owner**: change the arbiter and verifier for leases paid afterwards, or hand over ownership. Cast **one of the council's three votes**. Spend its NEAR |
| `VERIFIER_ACCOUNT_ID` / `VERIFIER_NEAR_PRIVATE_KEY` | `verifier.handova.testnet` | Give or remove the ID badge (`set_verified`) | Cast **a second council vote** |

**The main risk:** the council needs 2 of 3 votes, and the server holds keys to two of the seats. Someone who reads the server's environment could pass any council ruling on a disputed lease. That means deciding a disputed move-in (rent to the landlord, or a full refund) or splitting a disputed caution (never more to the landlord than they claimed). They can't touch undisputed leases, because the arbiter only acts on disputes. They also can't change the contract's code, because the escrow has no keys.

Balances on 7 Nov 2026 (`GET /api/health`): relayer 19.8 NEAR, account creator 19.6 NEAR.

## Pausing one part

Change the variable on the host, then restart the server. Each part fails with a clear message and the rest keeps working.

| To stop | Do | Users see |
|---|---|---|
| Gasless calls and the keeper | Remove `RELAYER_PRIVATE_KEY` | *Gasless payments are switched off on this server. Use a NEAR wallet instead.* Timeouts are no longer triggered for anyone, but any account can still call the contract's "anyone may trigger" methods |
| Only the keeper | `KEEPER=off` | Nothing; timeouts wait for someone to trigger them |
| New accounts | Remove `CREATOR_PRIVATE_KEY` | *Account creation is switched off on this server. Connect a NEAR wallet instead.* |
| ID badges | Remove `VERIFIER_NEAR_PRIVATE_KEY` | *Identity checks are switched off on this server right now.* |
| A listing on Handova's home page | Add its ID to `HIDDEN_LISTINGS` | It disappears from the home page; it stays on-chain |

`RELAYER_DAILY_TX` lowers the relayer's daily budget, but `0` still lets one call through each day, so remove the key to stop the relayer completely.

The relayer also stops on its own when its balance runs low (*Free gas is paused: Handova's relayer needs a NEAR top-up*). Account creation does the same when the creator runs low.

## Replacing a key

Do this right away if a key may have leaked, and before handing the server to anyone else.

1. Make a new key pair on a trusted machine, for example `near account add-key <account> grant-full-access autogenerate-new-keypair save-to-keychain network-config testnet sign-with-keychain send`. This adds the new public key to the account, signed with the old key.
2. Put the new private key in the host's environment (`RELAYER_PRIVATE_KEY`, `CREATOR_PRIVATE_KEY` or `VERIFIER_NEAR_PRIVATE_KEY`) and restart.
3. Check `GET /api/health`: the account shows with its balance. For the relayer, make one gasless call in the app. For the creator, create a test account.
4. Delete the old key: `near account delete-keys <account> public-keys <old public key> network-config testnet sign-with-keychain send`.
5. Check that only the new key is left: `near account list-keys <account> network-config testnet now`.

If a key has leaked, first pause the part that uses it (table above), then rotate it. Whoever holds a leaked full-access key can also delete our keys, so act quickly. If they get there first, the account is lost: use a new account and update the env.
- A lost **relayer** only costs its NEAR.
- A lost **creator** (`handova.testnet`) also means losing the escrow owner role and one council seat. Leases already paid keep their arbiter.
- A lost **verifier** means losing one council seat. The owner can name a new verifier for future leases.

## Not done yet (hardening)

- Keep council voting keys off the server: today two of the three seats share keys with server roles. Members should vote from their own wallets, and the seats should go to independent members.
- Give the server a **function-call key** limited to `set_verified` on the escrow, instead of the verifier's full-access key.
- Create user accounts under a separate parent account with no other role, so the creator key isn't also the escrow owner.
- Alert when a server account's balance drops quickly. Anyone can sign up as a landlord for 0.15 NEAR; sign-ups are rate-limited per IP, but many IP addresses could slowly drain the creator.
