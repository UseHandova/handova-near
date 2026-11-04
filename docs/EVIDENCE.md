# Handova evidence index

Each main claim, how to check it, and what has not been shown yet. Checked on NEAR testnet on 4 Nov 2026.

## The deployed code

| | |
|---|---|
| Contract | `escrow-v3.handova.testnet` |
| Code hash on-chain | `GbfegqXYhhRVfyDUoGDbHSnvfMc4TLm5yaPmTcptA5Ri` |
| Source | `contract/` at commit `bffbc77` (unchanged since the v3 commit `3d5aeec`) |
| Rebuild | From a clean clone, `cd contract && cargo near build non-reproducible-wasm` gave the same hash (397,079 bytes). Tools: macOS, rustc 1.97.1, cargo-near 0.22.0. This is not a reproducible-build container, so other tools or systems may give a different hash |
| Access keys | None: `near account list-keys escrow-v3.handova.testnet network-config testnet now` |
| Upgrade path in the code | None: no `deploy_contract`, `migrate` or `init(ignore_state)` in `contract/src/` |
| Token | `usdc.handova.testnet`, a test token anyone can mint, not Circle USDC |

To compare a hash yourself: base58 of the SHA-256 of `contract/target/near/handova.wasm`, against `code_hash` from the RPC `view_account` query.

## Claims

| Claim | Status | How to check |
|---|---|---|
| The lease NFT moves only to the tenant the landlord agreed to | ✅ Unit and sandbox tests; live sale below | `contract/src/tests.rs`, `contract/tests/sandbox.rs` |
| A sale is refused before the landlord agrees | ✅ On `escrow-v3` | [Refused buy](https://testnet.nearblocks.io/txns/9fdgdugRwcHfSByKHRX8AaCLGxHZoagWfzbqmnAJtMk5): Mintbase logs `nft_failed_listing`, one receipt fails, the USDC is refunded |
| The next tenant asks to take over | ✅ On `escrow-v3` | [`request_takeover`](https://testnet.nearblocks.io/txns/Grqt3wEARTGB7NA8GDTywPdMkA8qs3vPyozc9KVk2gPa) |
| A sale completes after the landlord agrees | ✅ On `escrow-v3` | [Completed sale](https://testnet.nearblocks.io/txns/C3SW13cFZPXLaJZK8FviDy6sRTMBqbQLt2sj2FL4CuT1): `nft_transfer`, `lease_taken_over`, `nft_sale`, no failed receipts. `get_lease(1)` shows the buyer as `tenant` and `nft_holder` |
| The caution goes to the NFT holder at move-out | ⚠️ Tests only so far | Unit, sandbox and browser tests. No full lease has closed on `escrow-v3` yet: lease #1 is still `Active` |
| A DAO vote decides a dispute | ⚠️ Tests only so far | Browser test on the test deployment. No DAO ruling on `escrow-v3` yet |
| A replaced arbiter can't rule on an open lease | ✅ Unit test | `contract/src/tests.rs` |
| A verifier change or revoked badge can't unlock a silence claim | ✅ Unit test | `contract/src/tests.rs` |
| Failed withdrawals keep the money | ✅ Unit and sandbox tests | `failed_withdrawal_keeps_the_money` |
| The contract's USDC covers what it owes | ✅ Sandbox tests after each settled step; live values matched on 4 Nov | `get_config.total_held` against `ft_balance_of` on the token (both 12,000,000) |
| Paying from another chain, landlord cash-out | ❌ Not shown | Live quotes only; arrival simulated with test USDC. No real Intents settlement has run |
| Real rentals | ❌ None | Nobody outside the team has used it for a rental |

## Test deployment

Browser tests run on `escrow-v5.handova-3b5eb6e5.testnet`, which has the **same code hash** as `escrow-v3`. The difference is configuration: 20-second waiting periods instead of 3 and 7 days, and its own accounts.

## Who holds power today

- Owner: `handova.testnet`. Verifier: `verifier.handova.testnet`.
- Arbiter for leases on `escrow-v3`: `handova-council.sputnikv2.testnet`, threshold 2. Members are `handova.testnet`, `verifier.handova.testnet` and `tester1604.testnet`. All three are team accounts, and the owner and verifier alone can reach the threshold.
