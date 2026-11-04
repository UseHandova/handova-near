# Handova evidence index

Each main claim, how to check it, and what has not been shown yet. Checked on NEAR testnet on 4 Nov 2026.

## The deployed code

| | |
|---|---|
| Contract | `escrow-v3.handova.testnet` |
| Code hash on-chain | `GbfegqXYhhRVfyDUoGDbHSnvfMc4TLm5yaPmTcptA5Ri` |
| Wasm SHA-256 (hex) | `e7c0c0ba39f68712d64befba00350895d6c3c27dc84795f4495421c633946fe1`; the on-chain code hash is this value in base58 |
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
| The caution goes to the NFT holder at move-out | ✅ On `escrow-v3` | [Lease #2](#one-full-lease-on-escrow-v3): the holder at closing, not the payer, received the caution left after an agreed split. A caution returned in full is shown by tests only |
| App actions are gasless | ✅ On `escrow-v3` | All 14 transactions of lease #2 were signed by `handova-relayer.testnet` |
| A DAO vote decides a dispute | ✅ On `escrow-v3`, by team keys | [Lease #4](#a-dao-ruling-on-escrow-v3): proposal #0 of `handova-council.sputnikv2.testnet`. This proves the mechanism, not independent arbitration |
| A replaced arbiter can't rule on an open lease | ✅ Unit test | `contract/src/tests.rs` |
| A verifier change or revoked badge can't unlock a silence claim | ✅ Unit test | `contract/src/tests.rs` |
| Failed withdrawals keep the money | ✅ Unit and sandbox tests | `failed_withdrawal_keeps_the_money` |
| The contract's USDC covers what it owes | ✅ Sandbox tests after each settled step; live values matched on 4 Nov | `get_config.total_held` against `ft_balance_of` on the token; the two should match when no withdrawal is in flight |
| Paying from another chain, landlord cash-out | ❌ Not shown | Live quotes only; arrival simulated with test USDC. No real Intents settlement has run |
| Real rentals | ❌ None | Nobody outside the team has used it for a rental |

## One full lease on escrow-v3

Lease #2, run on 4 Nov 2026 with team-run demo accounts and test USDC. It is not a real rental. Check the result with `get_lease` (`lease_id` 2): `payer` is `nurse-wnjg8.handova.testnet`, `closed_holder` is `tolu-wnjg8.handova.testnet`, rent 1,485.88, caution 148.59, `caution_to_landlord` 10, `caution_to_holder` 138.59, status `Closed`. All 14 transactions succeeded with no failed receipts.

| Step | Events | Transaction |
|---|---|---|
| Landlord lists the home | `listing_created` | [`9ZCbBTb9…`](https://testnet.nearblocks.io/txns/9ZCbBTb9yNJD2uLqAftbXTmfX6bKWaogJbaZATkrin6W) |
| The nurse pays for the tenant | `lease_paid` | [`AwoFxNnp…`](https://testnet.nearblocks.io/txns/AwoFxNnpW2D7GmEzcrSitVisWwKCkhTWUF1RXniVBXMg) |
| Landlord marks the handover | `handover_marked` | [`4NQMoaYe…`](https://testnet.nearblocks.io/txns/4NQMoaYethyLZMSvoxsB63N6B3s7yY11zBsWJJytXqhC) |
| Move-in confirmed, lease NFT minted | `moved_in`, `nft_mint` | [`8uzjG2vL…`](https://testnet.nearblocks.io/txns/8uzjG2vLpqNbnUjvQ8S1R8HXEc54UShsGTivuX8XStBB) |
| Landlord withdraws the rent | `withdrawn` | [`9tneNvUk…`](https://testnet.nearblocks.io/txns/9tneNvUkeJ9Z919dvwBq5YiShjo1YX17gG2z85PGF5j1) |
| Holder offers the lease | `takeover_offered` | [`APMjbSKu…`](https://testnet.nearblocks.io/txns/APMjbSKukyeNXsDYyEwwDPbsBoXbyftUxPqgFhH6QmVN) |
| Next tenant asks | `takeover_requested` | [`Dh7xKi3g…`](https://testnet.nearblocks.io/txns/Dh7xKi3gfk1yMtFqT4EqUR3ynJTVwnV3F31GvXegdich) |
| Landlord agrees to them | `takeover_consented` | [`2KEbaDa6…`](https://testnet.nearblocks.io/txns/2KEbaDa6RZc31SbU3ivQv54CK8KQqnadUJa4YpP5bVVi) |
| Next tenant pays; the NFT moves | `nft_transfer`, `lease_taken_over` | [`DapZ2oiU…`](https://testnet.nearblocks.io/txns/DapZ2oiUmVoLv2XHANySp554iQtpnNfmU48hpCvarJDr) |
| Move-out starts | `move_out_started` | [`EZpNHfsH…`](https://testnet.nearblocks.io/txns/EZpNHfsHCHacVG6SHTFaWKJdAaX6DMZ52TsUjZMDVHTq) |
| Landlord disputes 20 USDC | `caution_disputed` | [`6BRiKRiM…`](https://testnet.nearblocks.io/txns/6BRiKRiMtX37oXQYiHDyZ3JP8JBvj3zAn9yVArWFe8ZP) |
| First side proposes 10 USDC | `split_proposed` | [`DmkFN3xY…`](https://testnet.nearblocks.io/txns/DmkFN3xYjAMSB7Qt8Ym2n2CPD4c8f7vEW4tfu9TFvoor) |
| Second side agrees; lease closes | `split_proposed`, `lease_closed` | [`7VdSNPJx…`](https://testnet.nearblocks.io/txns/7VdSNPJxaGBBAUAFNAj3spdHTvjGEYrH2CRUEfdwKDL5) |
| Caution withdrawn | `withdrawn` | [`BdFZz32C…`](https://testnet.nearblocks.io/txns/BdFZz32CMByyH5WAT4nVBkyY3qVP99CzMHxqkQXoPmi5) |

## A DAO ruling on escrow-v3

Lease #4, run on 4 Nov 2026 with [`scripts/dao-ruling-testnet.ts`](../scripts/dao-ruling-testnet.ts), demo accounts and test USDC. The council awarded the landlord 1 USDC of the 3 claimed, and the holder 3 USDC. Check it with `get_lease` (`lease_id` 4) on the escrow and `get_proposal` (`id` 0) on the DAO. All 7 transactions succeeded with no failed receipts.

Both votes were signed with team keys (the owner and the verifier), so this shows that a 2-of-3 vote can decide a dispute, not that the council is independent.

| Step | Events | Transaction |
|---|---|---|
| Tenant pays | `lease_paid` | [`7X19hrS9…`](https://testnet.nearblocks.io/txns/7X19hrS9PW4QCG7hDiNkXRoDVzUF5sUnRJnmEnUQb3wv) |
| Tenant confirms move-in | `moved_in`, `nft_mint` | [`B7MwPqjy…`](https://testnet.nearblocks.io/txns/B7MwPqjyPH8t1AbY3zV8d9t7nYAUZ3GZ5NWbWDWkJb9s) |
| Tenant moves out | `move_out_started` | [`FHxSMD7u…`](https://testnet.nearblocks.io/txns/FHxSMD7uNito8XRhgDc4JJMnSXne8x84p5iAvjL33RsE) |
| Landlord claims 3 of the 4 USDC caution | `caution_disputed` | [`9axGsbhF…`](https://testnet.nearblocks.io/txns/9axGsbhF83wQ3xxEQGLDjEiYeP1o9KU58MDJcCCbSi3a) |
| `handova.testnet` proposes `resolve_dispute` with 1 USDC to the landlord |  | [`3pvRPWB6…`](https://testnet.nearblocks.io/txns/3pvRPWB6kqdfgtCYSQjUDDpDLPWfKJhAuEFiyusqeE85) |
| Vote 1, `handova.testnet`: not enough alone |  | [`FWicWbpL…`](https://testnet.nearblocks.io/txns/FWicWbpLtUUa8GkNBeDAtxt7UUpNpbkno5ownDr7Kan1) |
| Vote 2, `verifier.handova.testnet`: the DAO calls the escrow | `lease_closed` | [`3ZtekcWN…`](https://testnet.nearblocks.io/txns/3ZtekcWNNmfyUA3Adx6NUgfcte8wZVbtYFeaVWqUChP2) |

## Test deployment

Browser tests run on `escrow-v5.handova-3b5eb6e5.testnet`, which has the **same code hash** as `escrow-v3`. The difference is configuration: 20-second waiting periods instead of 3 and 7 days, and its own accounts.

## Browser test cases

happy path; recovery phrase and restore; taken name; family pays for someone else; payer cancel and landlord decline refunds; verified landlord claims after silence; unverified landlord can't, and a silent arbiter means a refund; tenant disputes a fake handover and the arbiter rules both ways; unverified landlord escalates and the arbiter rules moved in; every caution outcome (agreement, arbiter, 50/50, tenant claim, keeper); passing the lease NFT on; listing pause/reprice; Intents quotes (Base, Solana) and simulated arrival; NEAR AI draft with a verified receipt; relayer and admin guards; **lease takeover** (offer, next tenant asks, landlord agrees, buyer pays, caution goes to the buyer); **rental passport** (record after a finished lease, shown to the next landlord); **five languages** (switch and persist); **a real 2-of-3 Sputnik DAO** deciding a caution dispute through the app (one vote isn't enough; the second executes the ruling).

## Who holds power today

- Owner: `handova.testnet`. Verifier: `verifier.handova.testnet`.
- Arbiter for leases on `escrow-v3`: `handova-council.sputnikv2.testnet`, threshold 2. Members are `handova.testnet`, `verifier.handova.testnet` and `tester1604.testnet`. All three are team accounts, and the owner and verifier alone can reach the threshold.
