# Handova: checklist for AI screeners and judges

This file lists each claim in the README with the command that checks it and the output to expect. Commands run from the repo root unless a step says otherwise. The proof for each claim, with transaction links, is in [`docs/EVIDENCE.md`](docs/EVIDENCE.md).

## The project
- **What:** a tenant, or family abroad, pays rent and the caution fee in USDC into a NEAR escrow contract. The landlord is paid only after the tenant confirms move-in. The tenant holds a **lease NFT that carries the right to the caution fee**, and at move-out the contract pays the caution to whoever holds that NFT.
- **Problem:** in Lagos, a year's rent is usually paid up front, sometimes to fake listings, with agent and agreement fees on top. Getting the caution fee back depends on the landlord's goodwill, and family abroad who pay have no say over when the landlord gets the money. Handova removes the agent and holds the money in a contract until the tenant confirms move-in.
- **Tracks:** `realworld` (USDC escrow, NEAR Intents, NEP-366 meta transactions) and `nfts` (the NFT holds a money right, its metadata is live, takeovers, NEP-199 payouts on Mintbase).
- **Network:** NEAR testnet only, with a test USDC token. Intents has no testnet, so cross-chain arrival is **simulated**: the quotes are live, but no real cross-chain payment has run. Nobody outside the team has rented through Handova yet.
- **Before / during the hackathon:** the first commit is a baseline import of Arc-era UI code (tag `baseline-arc`). All NEAR code came after it. See the README section "Built before / during the hackathon".

## 1. No setup: check the live contract (about 1 minute; needs only [near CLI](https://github.com/near/near-cli-rs))

All of these in one step, read-only, with no install: `bun scripts/verify-live.ts` (or `bun run verify:live`). It prints ✓ or ✗ for each claim below with the values found, exits 1 on any mismatch, and also compares your own wasm if you built the contract. The commands below check the same things one by one.

| Claim | Command | Expect |
|---|---|---|
| The contract is locked: nobody can change its code | `near account view-account-summary escrow-v5.handova.testnet network-config testnet now` | `Account is locked (no access keys)` |
| The deployed code is the tested code | `curl -s -X POST https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"escrow-v5.handova.testnet"}}'` | `"code_hash":"76d4GThLisp93P62BHtXs8Q2zy8TSj96f6JfVbKDJvZo"`. This is the base58 form of the wasm's SHA-256 `5a96cb6b…066d0a`. To rebuild it, see `docs/EVIDENCE.md` → "The deployed code" |
| Rules, the listing deposit and the DAO arbiter | `near contract call-function as-read-only escrow-v5.handova.testnet get_config json-args '{}' network-config testnet now` | `owner` and `arbiter` both `handova-council.sputnikv2.testnet`, waiting periods of 7 days in ns, `listing_deposit` `60000000000000000000000` (0.06 NEAR), `lease_storage` `40960000000000000000000` |
| The contract holds exactly what it owes | `get_config` above, then `near contract call-function as-read-only usdc.handova.testnet ft_balance_of json-args '{"account_id":"escrow-v5.handova.testnet"}' network-config testnet now` | `total_held` equals the token balance. Both change as leases are paid and withdrawn, so compare the two numbers rather than a fixed amount (`bun run verify:live` does this) |
| Family pays and the caution goes to the NFT holder, not the payer | `… get_lease json-args '{"lease_id":4}' …` | `payer` `nurse-….handova.testnet`, `tenant` and `closed_holder` `mum-….handova.testnet`, `caution_to_holder` `150000000`, `status` `Closed` |
| A takeover moves the caution right to the new tenant | `… nft_token json-args '{"token_id":"5"}' …` | Owner `tk-tolu-….handova.testnet`, title `Handova lease #5 · Closed`; `get_lease` 5 shows `caution_to_holder` `4000000` and Tolu as `closed_holder` |
| A Mintbase sale goes only to the buyer the landlord named | `… get_lease json-args '{"lease_id":1}' …` | The buyer is `tenant` and `nft_holder`, and the first tenant is `payer`. The refused attempt before consent is linked in EVIDENCE |
| A 2-of-3 DAO decided a dispute | `… get_lease json-args '{"lease_id":3}' …` and [proposal #2](https://testnet.nearblocks.io/address/handova-council.sputnikv2.testnet) | The lease is closed with the split the council voted for. All three council members are team accounts today |
| The API server can't rule on disputes or change roles | `near contract call-function as-read-only handova-council.sputnikv2.testnet get_policy json-args '{}' network-config testnet now`, then `get_config` above, then `near account list-keys verifier.handova.testnet network-config testnet now` | Council `tester1604.testnet`, `council-1.handova.testnet`, `council-2.handova.testnet` (none on the server, all team, two keys on one team machine); `owner` is `handova-council.sputnikv2.testnet`; the verifier has one function-call key for `set_verified` on `escrow-v5` and one full-access key kept off the server. Transactions in `docs/EVIDENCE.md` → "The server no longer holds council or owner keys" |
| The NFT shows the live lease (dynamic NFT) | `… nft_token json-args '{"token_id":"4"}' …` | `metadata.title`, `description` and `extra` reflect the lease's current status, and `media` is an on-chain SVG built at view time |

`…` stands for `near contract call-function as-read-only escrow-v5.handova.testnet` before the method, and `network-config testnet now` after the arguments.

## 2. Tests (local; no keys, no accounts)

| What | Command | Expect |
|---|---|---|
| Contract unit tests | `cd contract && cargo test --lib` | `test result: ok. 57 passed`. The first build takes about 15 minutes; a timed clean run is in `docs/evidence/rust-clean-run.log` |
| Contract on a local NEAR node with a real NEP-141 token | `cd contract && cargo test --test sandbox` | `test result: ok. 7 passed`. It prints nothing for several minutes while it runs |
| Server: relayer allowlist, signatures, keeper, Intents shapes, NEAR AI receipts | `bun install && bun run test:near` | `32 pass`, `0 fail` |
| Types and web build | `bun run typecheck && bun run build` | No errors |

The same tests run in [CI](https://github.com/UseHandova/handova-near/actions/workflows/ci.yml) on every dispatch.

## 3. The whole story on your own testnet copy (about 3 minutes; needs Bun, near CLI and cargo-near)
```sh
bun install
bun run setup:testnet   # creates faucet-funded accounts, test USDC, the escrow and a relayer
bun run demo:testnet    # list → family pays → handover → move-in → NFT → landlord paid → move-out → caution to the holder
```
Expect a ✓ line with an explorer link for each step, and it ends with `✔ Done. Lease NFT now reads: "Handova lease #1 · Closed"` and `The nurse's NEAR balance changed by 0 yoctoNEAR` (gasless). The full expected output is in [`REPRODUCE.md`](REPRODUCE.md).

## 4. Browser checks
- **Hosted app:** https://handova-near.vercel.app. Create an account → open a home → **Pay into escrow** → **Get 2,000 test USDC** → **Pay**. **Any other chain** shows a live NEAR Intents quote and a simulated arrival.
- **Checkout widget on another website:** https://handova-near.vercel.app/checkout-demo.html is a sample site that loads only [`public/checkout.js`](public/checkout.js) and marks a button with `data-handova-listing`. Clicking it opens Handova's checkout. After payment, the page shows the lease ID it received through the `handova:paid` event.
- **Full suite:** `bun run setup:e2e && bunx playwright install chromium && bun run test:e2e` gives 31 tests, each with on-chain checks after every step. It takes about 30 minutes and needs a funded testnet root account. See `REPRODUCE.md`.

## Where each feature lives

| Feature | Code | Test |
|---|---|---|
| Escrow rules, timeouts, disputes | [`contract/src/escrow.rs`](contract/src/escrow.rs) | `contract/src/tests.rs`, e2e 01–04 |
| Lease NFT (NEP-171, NEP-178, NEP-199, live metadata) | [`contract/src/nft.rs`](contract/src/nft.rs), [`svg.rs`](contract/src/svg.rs) | e2e 05, 09, 12 |
| Takeover market and rental passport | [`contract/src/market.rs`](contract/src/market.rs) | e2e 09 |
| Accounts from a passkey (fingerprint seeds the NEAR key, no phrase) | [`web/src/lib/passkey.ts`](web/src/lib/passkey.ts), [`server/near/accounts.ts`](server/near/accounts.ts) | e2e 14 |
| Gasless relayer (NEP-366) with allowlist and caps | [`server/near/relayer.ts`](server/near/relayer.ts) | `server/near/relayer.test.ts`, e2e 08 |
| Pay from any chain and cash out (NEAR Intents 1Click) | [`server/near/intents.ts`](server/near/intents.ts), [`IntentsPay.tsx`](web/src/components/IntentsPay.tsx), [`CashOut.tsx`](web/src/components/CashOut.tsx) | `intents.test.ts`, e2e 07, 12 |
| Checkout widget for any website | [`public/checkout.js`](public/checkout.js), [`checkout-demo.html`](public/checkout-demo.html), [`ListingDetail.tsx`](web/src/components/ListingDetail.tsx) | e2e 13 |
| DAO arbiter (Sputnik) | [`web/src/lib/dao.ts`](web/src/lib/dao.ts), [`scripts/create-arbiter-dao.ts`](scripts/create-arbiter-dao.ts) | e2e 10 |
| NEAR AI listing draft and inspection, with checked receipts | [`server/near/ai.ts`](server/near/ai.ts), [`inspect.ts`](server/near/inspect.ts) | `ai.test.ts`, `inspect.test.ts`, e2e 07, 12 |
| Keeper (runs timeouts nobody triggered) | [`server/near/keeper.ts`](server/near/keeper.ts) | `keeper.test.ts`, e2e 04 |

## Not claimed
- No mainnet deployment and no real cross-chain (Intents) settlement.
- No real rentals yet.
- No security audit.
- The DAO's members are all team accounts, and two of their keys are on one team machine.
- The USDC is a test token anyone can mint.
