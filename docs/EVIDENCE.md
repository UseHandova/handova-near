# Handova evidence index

Each main claim, how to check it, and what has not been shown yet. Checked on NEAR testnet on 6 Nov 2026.

## The deployed code

| | |
|---|---|
| Contract | `escrow-v5.handova.testnet` |
| Code hash on-chain | `76d4GThLisp93P62BHtXs8Q2zy8TSj96f6JfVbKDJvZo` |
| Wasm SHA-256 (hex) | `5a96cb6bd9b0bae8c1fa09c999ff9a28203ed2094fc20f7c501c1cc545066d0a` (409,763 bytes); the on-chain code hash is this value in base58. Rebuilt from a clean clone of `355915b` on 6 Nov: same hash |
| Source | `contract/` at `355915b` (deployed; the contract last changed in `9b8fd5e`) |
| Rebuild | `cd contract && cargo near build non-reproducible-wasm` (rustc 1.97.1, cargo-near 0.22.0, macOS). Not a reproducible-build container, so other tools may give a different hash. Clean run from a fresh public clone on 7 Nov 2026 (unit 56/56 in 120 s with compiling, sandbox 7/7 in 134 s, same hash): [`evidence/rust-clean-run.log`](evidence/rust-clean-run.log) |
| Access keys | None: `near account list-keys escrow-v5.handova.testnet network-config testnet now` |
| Upgrade path in the code | None: no `deploy_contract`, `migrate` or `init(ignore_state)` in `contract/src/` |
| Token | `usdc.handova.testnet`, a test token anyone can mint, not Circle USDC |
| Settings | Arbiter `handova-council.sputnikv2.testnet`, verifier `verifier.handova.testnet`, every waiting period 7 days; `listing_deposit` 0.06 NEAR, `lease_storage` 0.04096 NEAR. Funded with 6 NEAR, about 4.1 of it locked by the code's own storage |

Deployment: [create](https://testnet.nearblocks.io/txns/4MaAwjz5dAkfBQcZEM5ikFzMUxQX7QXVm9BZvyvvtK8e) · [deploy and init](https://testnet.nearblocks.io/txns/6ywSieF4mkDVpzPxf1BmUypNKrRMS1D7f4QTsqrWTjeb) · [token registration](https://testnet.nearblocks.io/txns/HsXQWAypyQ99rAp8UTJUjLswsC4MYqEH3aTXKcN7j3n8) · [lock: last key deleted](https://testnet.nearblocks.io/txns/B6mnknQkomMeVMyerXLEL4eb5P1QtXeTV7MVysrwaodL). The two Lagos listings were copied from v4 with the same terms and paid their own deposits ([#1](https://testnet.nearblocks.io/txns/CQAe4hv8t7QDFYFMjMjqMpKVL49A67WpN2B8nkGminVL), [#2](https://testnet.nearblocks.io/txns/FK7Tnjw6KkgM91yYK4m6aR64Yu662CwDLTiHn232iYiE)), from the team-run account `lagos-homes.handova.testnet`.

Every transaction below was looked up on testnet RPC on 6 Nov 2026 and succeeded (the one refused purchase is marked). Listings #3–#7 and #9 are test runs, hidden from the app's home page (`HIDDEN_LISTINGS`); #8 was removed.

## Claims

| Claim | Status | How to check |
|---|---|---|
| Silence never releases rent | ✅ Code and tests | No `claim_move_in` in `contract/src/`; unit tests and browser test "silence pays nobody" |
| A payment is refused if the listing's terms changed | ✅ Unit tests | `PayMsg` in `contract/src/escrow.rs` carries rent, caution and term |
| The caution goes to the NFT holder, not the payer | ✅ On `escrow-v5` | [Lease #4](#a-full-lease-on-escrow-v5): the nurse paid, mum held the NFT and received the full 150 USDC caution |
| Tenants and payers need no NEAR | ✅ On `escrow-v5` | Lease #4's steps after listing were relayed; the demo printed the nurse's NEAR change as 0 |
| Listings pay for their own storage | ✅ Unit and sandbox tests; on `escrow-v5` | `create_listing` attaches `listing_deposit`; [hosted check](#the-hosted-app-on-escrow-v5): a new landlord got 0.15 NEAR, listed #8, removed it gaslessly and kept 0.1497 NEAR |
| A takeover runs to closing, with the caution paid to the new holder | ✅ On `escrow-v5` | [Lease #5](#a-takeover-on-escrow-v5): `nft_token("5")` is owned by Tolu, `caution_to_holder` 4 USDC |
| The lease NFT moves only to the tenant the landlord named | ✅ Unit and sandbox tests; live sale | `consent_takeover(lease_id, buyer)`; `contract/tests/sandbox.rs` |
| A Mintbase sale is refused before the landlord names the buyer, and completes after | ✅ On `escrow-v5` | [Lease #1](#a-mintbase-sale-on-escrow-v5): `get_lease(1)` shows the buyer as `tenant` and `nft_holder` and the first tenant as `payer` |
| A DAO vote decides a dispute | ✅ On `escrow-v5`, by team keys | [Lease #3](#a-dao-ruling-on-escrow-v5), proposal #2. Proves the mechanism, not independent arbitration |
| The API server holds no council seat and isn't the owner; its verifier key can only call `set_verified` | ✅ On testnet, 7 Nov 2026 | [Council handover](#the-server-no-longer-holds-council-or-owner-keys): `get_policy`, `get_config.owner`, `near account list-keys verifier.handova.testnet` |
| An unsettled caution dispute pays the landlord only what the holder offered | ✅ Unit tests | `settle_dispute_timeout` in `contract/src/escrow.rs` |
| A replaced arbiter can't rule on an open lease | ✅ Unit test | Each lease stores its `arbiter` |
| Inspection "before" photos are fixed at payment | ✅ Code | The lease stores `property_ref`; `server/near/inspect.ts` reads it |
| The passport counts months actually lived | ✅ Unit tests | `rental_record` in `contract/src/market.rs` |
| Storage can't block open leases | ✅ Sandbox test | Each lease takes 4,096 bytes from its listing's credit; the worst case measured 3,857. Payments also keep a reserve per open lease (`get_config.storage_spare`) |
| Failed withdrawals keep the money | ✅ Unit and sandbox tests | `failed_withdrawal_keeps_the_money` |
| The contract's USDC covers what it owes | ✅ Sandbox tests; live values matched on 6 Nov | `get_config.total_held` and the token's `ft_balance_of(escrow-v5)` were both 50 USDC |
| Any website can take rent into the escrow with one script tag | ✅ Browser test | `e2e/13-checkout-widget.spec.ts`: the sample site at `/checkout-demo.html` opens Handova's checkout, the payer pays, and the site receives the lease ID through `handova:paid` |
| Paying from another chain, landlord cash-out | ❌ Not shown | Live quotes only; arrival simulated with test USDC. No real Intents settlement has run |
| Real rentals | ❌ None | Nobody outside the team has used it for a rental |

## A full lease on escrow-v5

Lease #4 (listing #6), from `bun run demo:testnet` on 6 Nov 2026 with demo accounts and test USDC. It is not a real rental. `get_lease` (`lease_id` 4): `payer` `nurse-mw5i34a1.handova.testnet`, `tenant` and `closed_holder` `mum-mw5i384b.handova.testnet`, `caution_to_holder` 150 USDC, status `Closed`. The landlord signed the listing with its deposit; every later step was relayed, and the nurse's NEAR balance changed by 0.

| Step | Transaction |
|---|---|
| Landlord lists the home (signed, 0.06 NEAR deposit) | [`EVDBw8VX…`](https://testnet.nearblocks.io/txns/EVDBw8VXjM7VjkGmYDGvTZpXmrgvgLJ4SGrbdWtxtEBB) |
| The nurse pays for mum | [`GzVnAVcx…`](https://testnet.nearblocks.io/txns/GzVnAVcxqBAeAApB7f7RCppsYHvd1XNy2gvX6bN1eMEX) |
| Landlord marks the handover | [`ED7vKpvZ…`](https://testnet.nearblocks.io/txns/ED7vKpvZSvU3EfCA4qLU6ajJwH5229hSDcDsEzMyZhyW) |
| Mum confirms move-in; lease NFT minted | [`6KJ7LVhy…`](https://testnet.nearblocks.io/txns/6KJ7LVhyvecXKQ51PHN5aUoBJXNpufChNPYCXaXBdmvk) |
| Landlord withdraws the rent | [`2HUXnAeU…`](https://testnet.nearblocks.io/txns/2HUXnAeULNhzkevKKNitBdcX2y3uc8AqyEXB9R59jUEX) |
| Mum moves out | [`Dzt8a2cc…`](https://testnet.nearblocks.io/txns/Dzt8a2ccpFjs9ThLK6MZ4QpNp9kcrbtLFQNE5XnHPBSC) |
| Landlord approves; lease closes | [`6Uy8r6cC…`](https://testnet.nearblocks.io/txns/6Uy8r6cC9YG9owaMKGjiVagXRoG1zbmy46suRMgQ2NRm) |
| Mum withdraws the caution | [`8gsaiNoL…`](https://testnet.nearblocks.io/txns/8gsaiNoLhrojrCriD6E2thVrvmCiuWxgbmqpp7LgmAg4) |

## A takeover on escrow-v5

Lease #5 (listing #7), from [`scripts/takeover-testnet.ts`](../scripts/takeover-testnet.ts): Ade rents, hands the lease to Tolu with the landlord's agreement, and at move-out the 4 USDC caution goes to Tolu, the holder by then. Check `get_lease` (`lease_id` 5) and `nft_token` (`"5"`).

| Step | Transaction |
|---|---|
| Landlord lists the home | [`4MJ12aZF…`](https://testnet.nearblocks.io/txns/4MJ12aZFi2LkQ8hWmRrjrDmejukmmcRHExyZtsRj6GkT) |
| Ade pays | [`GB57LNuy…`](https://testnet.nearblocks.io/txns/GB57LNuygqZHH7azzxXC4DPVPzgW3nkwB9B9JbAzv8SS) |
| Landlord marks the handover | [`BE1PmG8d…`](https://testnet.nearblocks.io/txns/BE1PmG8dX6oHKv8x6QULqcbxZZErAu6tghvdR5jc7k1E) |
| Ade confirms move-in | [`BJi3XPby…`](https://testnet.nearblocks.io/txns/BJi3XPbyWoPa8cU2RTgvEA73vgnjYusokZqLMGFwEx87) |
| Ade offers the lease | [`E8CB1gVu…`](https://testnet.nearblocks.io/txns/E8CB1gVuCG49aJoKiBLsfejoDtLxhVPTAjV4TKbBmZv) |
| Tolu asks to take it over | [`Hh9HtxwR…`](https://testnet.nearblocks.io/txns/Hh9HtxwRNE2z1Rpe1mAm9d9PXbUHEpjqDsjz4P9Jgztk) |
| Landlord agrees to Tolu (`consent_takeover`) | [`B7dCJXE3…`](https://testnet.nearblocks.io/txns/B7dCJXE3SCxSZiqtAmuhwYiA9toBggeTL6himUGZSYB9) |
| Tolu pays the price; the NFT moves | [`7zsSLTw7…`](https://testnet.nearblocks.io/txns/7zsSLTw7QnUnfLGLss4ifUGkV7RcvEeDdssvdcLqo1ou) |
| Tolu moves out | [`5sfpuBPi…`](https://testnet.nearblocks.io/txns/5sfpuBPix71NKFgJyBQfCEBh1shcRZqXJwJXfAjzvCoR) |
| Landlord approves; caution to Tolu | [`5grzGnEm…`](https://testnet.nearblocks.io/txns/5grzGnEmyM1LycQQzfH5FRuFgG8fePYMjA1KfaATccJQ) |
| Tolu withdraws the caution | [`8qCic5ha…`](https://testnet.nearblocks.io/txns/8qCic5haDyJeEzsWNP7MB1X1PQh1PQn8rQgiSSCqvoru) |
| Ade withdraws the price | [`BvHANT6C…`](https://testnet.nearblocks.io/txns/BvHANT6C4nNFtfSgLcybn17TnCEfT1b3rcPQjRVwqowv) |

## A Mintbase sale on escrow-v5

Lease #1 (listing #3), from [`scripts/mintbase-sale-testnet.ts`](../scripts/mintbase-sale-testnet.ts) on Mintbase's market `market-v2-beta.mintspace2.testnet`. The first purchase came before the landlord named the buyer and was refused (the buyer's USDC came back). After `consent_takeover` the same purchase completed: the buyer holds the NFT, and the seller received 4.95 USDC. The lease is still `Active`.

| Step | Transaction |
|---|---|
| Landlord lists the home | [`5RUfvS9w…`](https://testnet.nearblocks.io/txns/5RUfvS9wchA8NTQqsx8cy8DBmCbnNauChcGfztDWtopQ) |
| Tenant pays | [`GdMVxmLF…`](https://testnet.nearblocks.io/txns/GdMVxmLFZjuLnUKNCX8LYGy2MLuG38vj4c3i6CLzPj6C) |
| Tenant confirms move-in | [`JBtxxeep…`](https://testnet.nearblocks.io/txns/JBtxxeepiSJ2nip1dRMRqUnwacGUSWFu3hX2ue9qWEHJ) |
| Tenant offers the lease | [`5BpnX8fU…`](https://testnet.nearblocks.io/txns/5BpnX8fUeztEstbnuVCHHyT7uGoPeJCdB7NbndoudKCX) |
| Tenant pays Mintbase storage | [`5vYq73G4…`](https://testnet.nearblocks.io/txns/5vYq73G4a7P2ERtyE3GsgvgdQnDoDzJYW5MVJaGWP5BU) |
| Tenant lists it (`nft_approve`) | [`F5KMCFTV…`](https://testnet.nearblocks.io/txns/F5KMCFTVrZYjeUmbJgPVmiYpsFEf3UPLnP8TLaYZLB98) |
| Buyer buys before the landlord agreed: **refused**, refunded | [`9c3sf8im…`](https://testnet.nearblocks.io/txns/9c3sf8imFvSU3JwB8iggwdn5XGfkLmiAd99WVCrk3jeC) |
| Buyer asks to take it over | [`DpCWmhva…`](https://testnet.nearblocks.io/txns/DpCWmhvaY92DPYCSQB8yaBmPB79fy9MgM1Jz7wFN66HY) |
| Landlord agrees to the buyer | [`GuUEt8Jh…`](https://testnet.nearblocks.io/txns/GuUEt8Jhg31pwzFsfh2xcVekpWVq3w5o86fXNqMBVnSB) |
| Tenant pays Mintbase storage again | [`GviGqpTE…`](https://testnet.nearblocks.io/txns/GviGqpTEziZr3kEm2WxuooUwped8j8k1L6DL1HZfRWJa) |
| Tenant lists it again | [`2AZHsqRq…`](https://testnet.nearblocks.io/txns/2AZHsqRqH5DeUhMnoagwRJDLXD6mwzBNmZJWnxx3V6Cr) |
| Buyer buys; the NFT moves | [`mjtDiYqx…`](https://testnet.nearblocks.io/txns/mjtDiYqxF2qRgyo9mBg6NuAyLJP14tvgyNtpe9QegXr) |

## A DAO ruling on escrow-v5

Lease #3 (listing #5), from [`scripts/dao-ruling-testnet.ts`](../scripts/dao-ruling-testnet.ts). The landlord disputed the 4 USDC caution; the council's proposal #2 awarded the landlord 1 and the holder 3 (`caution_to_landlord` 1, `caution_to_holder` 3). Both votes came from team keys (the owner and the verifier).

| Step | Transaction |
|---|---|
| Landlord lists the home | [`DHZximYe…`](https://testnet.nearblocks.io/txns/DHZximYeeXRWyYSCU6paYnzN8M2NomjPL7nKJFfrdE9V) |
| Tenant pays | [`9aDKeVeY…`](https://testnet.nearblocks.io/txns/9aDKeVeY9dnCihsPnPAhfeeuTwqtXK7yq5zFpx5z2esp) |
| Tenant confirms move-in | [`7CBgyVZM…`](https://testnet.nearblocks.io/txns/7CBgyVZMcb2qw4UVAcyvPX5M35qk5Le4RMLkK86xj5xq) |
| Tenant moves out | [`8diDdcrG…`](https://testnet.nearblocks.io/txns/8diDdcrGB3jrLGhUitoQSLCdgyww4tcvUHocLmPbt4KM) |
| Landlord disputes the caution | [`8BTcGSr4…`](https://testnet.nearblocks.io/txns/8BTcGSr4VUQkVKRffdvWUBrm49tDfxLxgQCB4cdQoySS) |
| `handova.testnet` proposes `resolve_dispute` | [`74zXG6bN…`](https://testnet.nearblocks.io/txns/74zXG6bN8mPVKk6B2De7SaF9h2hS1eYZmdC2TGGU2jYT) |
| Vote 1, `handova.testnet`: not enough alone | [`9iyp99uG…`](https://testnet.nearblocks.io/txns/9iyp99uGvPGF9MgvTnjD61HM8yWTV3diMR7ahLAo7Y2R) |
| Vote 2, `verifier.handova.testnet`: the DAO calls the escrow; lease closes | [`3sbUsTqN…`](https://testnet.nearblocks.io/txns/3sbUsTqNkVGfyZTq8X6cwLnRr6CekdPjFMrS69UtXdZ9) |
| Landlord pauses the listing | [`HgwTKewB…`](https://testnet.nearblocks.io/txns/HgwTKewB6cEsTZsMKArNAF6tzLwoE5gQj9HKvoXUm7oN) |

An earlier DAO run (lease #2, listing #4) stopped when its landlord ran short of NEAR for the listing deposit, before the script was fixed (`f053a24`). That lease is in `Ending` since 6 Nov; if nobody acts, the keeper returns its caution to the holder after the 7-day review.

## The hosted app on escrow-v5

Through https://handova-near.vercel.app on 6 Nov 2026: a new landlord account got 0.15 NEAR at sign-up, listed #8 (signed, with the deposit) [`6YoksMCU…`](https://testnet.nearblocks.io/txns/6YoksMCUhbNXJtaaPmyRniURW3JFdupt2tehUTnjcZ5s) and removed it gaslessly [`4kS1XnEU…`](https://testnet.nearblocks.io/txns/4kS1XnEU6dw73EkTnkQFF6TLuixP989RV6xv5hiJjaix), ending with 0.1497 NEAR: the deposit came back, minus the listing fee.

## Earlier deployments

- `escrow-v4.handova.testnet` (code hash `22xuM4pC4rqG4Tbu6CoPXvKKatVaNGCvzXqzhjYgacvZ`, no keys): same escrow rules, but the contract paid for listings' storage, so anyone could fill it with free listings. Its demo lease #4, Mintbase sale (lease #1) and DAO ruling (lease #2, proposal #1) stay on-chain.
- `escrow-v3.handova.testnet`: silence could release rent for a verified landlord, and consent didn't name a buyer. Its lease #2 was the first takeover run to closing (caution to the new holder `tolu-wnjg8`).
- `escrow` and `escrow-v2`: early test history; v2 had a deploy key.

## Test deployment

Browser tests run on `escrow-v8.handova-3b5eb6e5.testnet`, which has the **same code hash** as `escrow-v5`. The difference is configuration: 20-second waiting periods instead of 7 days, its own accounts, and it is not locked.

## Browser test cases

1. list → pay → handover → move-in → NFT → landlord paid → move-out → caution back
2. recovery phrase: back it up, sign out, restore on a new phone
3. name already taken is shown before creating
4. family abroad pays for mum; only mum confirms; she gets the NFT
5. no handover in time: the payer cancels and gets everything back
6. landlord declines before move-in: tenant refunded in full
7. tenant silent after handover: even a verified landlord waits for a yes or a ruling
8. fake handover: tenant disputes, landlord cannot claim, arbiter refunds; second case arbiter rules moved in
9. silence pays nobody; an arbiter who stays silent means a refund
10. unverified landlord whose tenant won't confirm asks the arbiter, who rules moved in
11. caution dispute settled by agreement
12. caution dispute decided by the arbiter
13. dispute nobody settles: the caution goes back to the holder
14. landlord silent after move-out: tenant claims the caution
15. the keeper closes a review nobody acted on
16. caution dispute decided by a 2-of-3 DAO council
17. lease takeover: holder offers, a new tenant asks, the landlord agrees to them, they buy it and get the caution right
18. lease handed to family for free, only after the landlord agrees: the caution right moves with it
19. lease sold on Mintbase's market: listed after the landlord agrees, bought there, the caution right moves
20. rental passport: a finished lease shows on the tenant passport and to the next landlord
21. pay from another chain: live NEAR Intents quote, then (testnet) simulated arrival pays the escrow
22. landlord cash-out: live NEAR Intents quote to USDT on TRON; a wrong address is refused
23. voice-note style text → NEAR AI draft with a signed TEE receipt → publish
24. AI move-out inspection: the landlord adds a photo, NEAR AI advises with a signed receipt
25. relayer pays only for Handova calls
26. admin routes need the admin secret; faucet refuses unknown accounts; bad names refused
27. roles: chosen at sign-up, menu follows the role, switchable on the Account page
28. landlord pauses, resumes and reprices; price locks while a lease is open
29. the app speaks Yorùbá, Hausa, Igbo and Pidgin, and remembers the choice
30. checkout widget: a button on another site opens Handova, the payer pays into escrow, the site gets the lease

These are the test titles as written in `e2e/`. All 29 passed in one run on 6 Nov 2026, with the sandbox tests (7/7), on commit `355915b` with a clean tree: [`evidence/one-pass-v5.log`](evidence/one-pass-v5.log). An earlier attempt had 4 failures while the test Mac slept, so the run was repeated with sleep blocked (`caffeinate`). Test 30 was added after that run and passed on its own on 6 Nov 2026 (`bunx playwright test e2e/13-checkout-widget.spec.ts`: 1 passed).

## Who holds power today

- Owner: the council DAO `handova-council.sputnikv2.testnet` (since 7 Nov 2026; before, `handova.testnet`, whose key is on the API server). Changing the arbiter or verifier for future leases takes 2 of 3 council votes.
- Verifier: `verifier.handova.testnet`. The API server holds only a function-call key for `set_verified` on `escrow-v5` (0.25 NEAR gas allowance); the account's full-access key is kept on a team machine.
- Arbiter for leases on `escrow-v5`: `handova-council.sputnikv2.testnet`, threshold 2. Members are `tester1604.testnet`, `council-1.handova.testnet` and `council-2.handova.testnet`. None of their keys is on the server. All three are team accounts, and the council-1 and council-2 keys are on the same team machine, so one person there can still reach the threshold: this is not independent arbitration.

## The server no longer holds council or owner keys

Until 7 Nov 2026 the API server held the keys of two council seats (`handova.testnet`, `verifier.handova.testnet`) and the owner key, so whoever took the server could pass any ruling on a disputed lease. [`scripts/council-handover-testnet.ts`](../scripts/council-handover-testnet.ts) changed that on 7 Nov 2026. Each step:

| Step | Transaction |
|---|---|
| Create `council-1.handova.testnet` (key kept off the server) | [`DTTAUXuW…`](https://testnet.nearblocks.io/txns/DTTAUXuW6Q8hyf6kXJ6TPzyX5RbvLEGCVghSHKHw7FT3) |
| Create `council-2.handova.testnet` | [`3wiwEA9K…`](https://testnet.nearblocks.io/txns/3wiwEA9K5JLjfFpZM6PsE4SowBq3oXUZx5ZkJqUtoJoW) |
| Proposal #3, add council-1: proposed, then votes by `handova.testnet` and `verifier.handova.testnet` | [`2uk2BL33…`](https://testnet.nearblocks.io/txns/2uk2BL33zx9wDU6rpN225tW7x5spjyq5RfL84yXodvek) · [`5vX7RwxL…`](https://testnet.nearblocks.io/txns/5vX7RwxLZ9xZAALuX42zxkGzFpT6cMG736cYK4nQmCpw) · [`Ac74S9mG…`](https://testnet.nearblocks.io/txns/Ac74S9mG1JouW6yjkrNUuecQ7A2otHvQ1zowpW3YPhDX) |
| Proposal #4, add council-2 | [`gnd2wNW8…`](https://testnet.nearblocks.io/txns/gnd2wNW8CQFjJJqtZEXDWzsGZ6op2R5Fo9TWBvirh7Q) · [`8gg6EJyK…`](https://testnet.nearblocks.io/txns/8gg6EJyKjmmq6nvbyyxg28pchF6qYjDghFTFDy1rz6du) · [`6pTYoYMT…`](https://testnet.nearblocks.io/txns/6pTYoYMT7fQXBHQhXRwAfMcDbSCdER49Qmdqva1fiN4r) |
| Proposal #5, remove `verifier.handova.testnet` (votes: `handova.testnet`, council-1) | [`A9nrUP62…`](https://testnet.nearblocks.io/txns/A9nrUP62jQZjcowgYHwSt7puW4PP4ydGS2g2pYtovSH1) · [`9p1Pn5VS…`](https://testnet.nearblocks.io/txns/9p1Pn5VSyp126byTbYPS84qQnhi6tCNdTXCYzPvxkFBe) · [`2umTLkhj…`](https://testnet.nearblocks.io/txns/2umTLkhjhedVe5bPK7qsGPi9Cg9esJBc5svu7Eez1XYB) |
| Proposal #6, remove `handova.testnet` (votes: council-1, council-2) | [`GKsczXc8…`](https://testnet.nearblocks.io/txns/GKsczXc8Qc7NkWQLHzibgtzeiv1Q8GUuzbQevXQ4vHF2) · [`8xksyYZd…`](https://testnet.nearblocks.io/txns/8xksyYZdzF9mxXZ3bRd8m9H3LfevjAoV7D6bS8JrhCND) · [`HD2G2iwk…`](https://testnet.nearblocks.io/txns/HD2G2iwkGBb1BCoDCh7ESnYrmSSUqaq6ZWwQgZcAUinp) |
| `set_owner(handova-council.sputnikv2.testnet)`, signed by the old owner | [`8zfmFfr9…`](https://testnet.nearblocks.io/txns/8zfmFfr9MczmKSXdQdgcxFkubndqybzWvGiWwo4QiJ8t) |
| Verifier account: add a `set_verified`-only key for the server, add a full-access key kept off the server, delete the old full-access key | [`CVQA6mnu…`](https://testnet.nearblocks.io/txns/CVQA6mnumEnc4vyYrxs6EJwrd9gSGutTCsVikQdNnnps) |
| Check: `set_verified` with the server's new key works | [`zWceHu8L…`](https://testnet.nearblocks.io/txns/zWceHu8LrYkybtWG8s5NzgNP8k5zk29WCM61gUgCvVU) |

A NEAR transfer signed with the server's new verifier key was refused before sending (`Access key requires full access`).

The new council then ruled on a dispute, voting only with keys that were never on the server (`bun scripts/dao-ruling-testnet.ts`, 7 Nov 2026). Lease #6 (listing #9, hidden from the home page): the landlord claimed 3 of the 4 USDC caution; proposal #7 gave the landlord 1 and the holder 3, and after council-1's vote alone the lease was still `Disputed`.

| Step | Transaction |
|---|---|
| Landlord disputes 3 USDC of the caution | [`As3dstyM…`](https://testnet.nearblocks.io/txns/As3dstyMHn7eWJWUxUjXUzFS1nCiv4rSBNCkGb4tPLrG) |
| Proposal #7 (`resolve_dispute`: landlord 1 USDC) | [`ALNh9hEf…`](https://testnet.nearblocks.io/txns/ALNh9hEf2a87agEBHRyXCQAJjqocmaihpmRW894J6Jd7) |
| Vote 1 of 2, `council-1.handova.testnet` | [`6CxgfVFa…`](https://testnet.nearblocks.io/txns/6CxgfVFaR5pZhsePAaroG2KnJJZvxpu98h8Kag5oYddB) |
| Vote 2 of 2, `council-2.handova.testnet`: the DAO calls the escrow, lease #6 `Closed` | [`6VbnMvMw…`](https://testnet.nearblocks.io/txns/6VbnMvMwRdFdvBzUXzBwx3jmcyX2sVk1DHq3rLV31RAU) |

Check it yourself:
```sh
near contract call-function as-read-only handova-council.sputnikv2.testnet get_policy json-args '{}' network-config testnet now   # council group
near contract call-function as-read-only escrow-v5.handova.testnet get_config json-args '{}' network-config testnet now           # "owner": "handova-council.sputnikv2.testnet"
near account list-keys verifier.handova.testnet network-config testnet now                                                        # one full-access key, one function-call key: set_verified on escrow-v5
```
