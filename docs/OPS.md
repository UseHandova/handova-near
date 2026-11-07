# Running the Handova server: hot keys, pausing, rotating

The API server (Railway in the hosted demo) signs with three NEAR keys from its environment. The escrow contract itself has no keys. This page lists what each server key can do, how to switch each part off, and how to replace a key. Testnet only.

## What the server's keys can do

Checked on testnet on 7 Nov 2026, after [`scripts/council-handover-testnet.ts`](../scripts/council-handover-testnet.ts) took the server's keys out of the council and the owner role (transactions in [EVIDENCE](EVIDENCE.md#the-server-no-longer-holds-council-or-owner-keys)). None of the server's keys is a council seat or the escrow's owner.

| Env vars | Account | The server uses it to | The same key can also |
|---|---|---|---|
| `RELAYER_ACCOUNT_ID` / `RELAYER_PRIVATE_KEY` | `handova-relayer.testnet` | Pay gas for users' signed calls; run the keeper | Spend the relayer's NEAR |
| `CREATOR_ACCOUNT_ID` / `CREATOR_PRIVATE_KEY` | `handova.testnet` | Create `name.handova.testnet` accounts and fund them (0.15 NEAR for landlords, 0.05 for others) | Spend its NEAR (full-access key: creating sub-accounts needs one). It is no longer the escrow owner or a council member |
| `VERIFIER_ACCOUNT_ID` / `VERIFIER_NEAR_PRIVATE_KEY` | `verifier.handova.testnet` | Give or remove the ID badge (`set_verified`) | Nothing else: it is a **function-call key** for `set_verified` on `escrow-v5` only, with a 0.25 NEAR gas allowance. It can't move NEAR, vote or call anything else. The account's full-access key is kept off the server |

**What someone who reads the server's environment can do:** spend the relayer's and creator's NEAR, create accounts, and give or remove ID badges (which lift the 3-home limit but release no money). They **can't** rule on a dispute: the council's members are `tester1604.testnet`, `council-1.handova.testnet` and `council-2.handova.testnet`, and none of their keys is on the server. They can't change the arbiter or verifier, because the escrow's owner is the council DAO itself, so that takes 2 of 3 votes. They can't change the contract's code, because the escrow has no keys.

Until 7 Nov 2026 the server held two of the three council seats (`handova.testnet` and `verifier.handova.testnet`) and the owner key, so a server compromise could have passed any ruling on a disputed lease.

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

For the verifier, add a function-call key instead: `near account add-key verifier.handova.testnet grant-function-call-access --allowance '0.25 NEAR' --contract-account-id escrow-v5.handova.testnet --function-names set_verified autogenerate-new-keypair save-to-keychain network-config testnet sign-with-keychain send` (signed with the full-access key kept off the server). For the others:

1. Make a new key pair on a trusted machine, for example `near account add-key <account> grant-full-access autogenerate-new-keypair save-to-keychain network-config testnet sign-with-keychain send`. This adds the new public key to the account, signed with the old key.
2. Put the new private key in the host's environment (`RELAYER_PRIVATE_KEY`, `CREATOR_PRIVATE_KEY` or `VERIFIER_NEAR_PRIVATE_KEY`) and restart.
3. Check `GET /api/health`: the account shows with its balance. For the relayer, make one gasless call in the app. For the creator, create a test account.
4. Delete the old key: `near account delete-keys <account> public-keys <old public key> network-config testnet sign-with-keychain send`.
5. Check that only the new key is left: `near account list-keys <account> network-config testnet now`.

If a key has leaked, first pause the part that uses it (table above), then rotate it. Whoever holds a leaked full-access key can also delete our keys, so act quickly. If they get there first, the account is lost: use a new account and update the env.
- A lost **relayer** only costs its NEAR.
- A lost **creator** (`handova.testnet`) costs its NEAR and the `.handova.testnet` names. It holds no role on the escrow or the council.
- A leaked **verifier** key can only change badges until it's deleted; the full-access key kept off the server deletes it. The council can name a new verifier for future leases.

## Not done yet (hardening)

- Independent council members: all three seats are still team accounts (`council-1` and `council-2` keys are kept on a team machine, `tester1604.testnet` is the team's wallet). A seat should go to someone outside the team.
- Alert when a server account's balance drops quickly. Anyone can sign up as a landlord for 0.15 NEAR; sign-ups are rate-limited per IP, but many IP addresses could slowly drain the creator.
