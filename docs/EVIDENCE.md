# Handova evidence index

Each main claim, how to check it, and what has not been shown yet. Checked on NEAR testnet on 6 Nov 2026.

## The deployed code

| | |
|---|---|
| Contract | `escrow-v4.handova.testnet` |
| Code hash on-chain | `22xuM4pC4rqG4Tbu6CoPXvKKatVaNGCvzXqzhjYgacvZ` |
| Wasm SHA-256 (hex) | `0f5c7a16eeddd4303e769c76ccf4798fad415ec2a3fafdf9f894a0f8ba582686` (399,321 bytes); the on-chain code hash is this value in base58 |
| Source | `contract/` at `166baad` (unchanged since `95c45f7`) |
| Rebuild | `cd contract && cargo near build non-reproducible-wasm` (rustc 1.97.1, cargo-near 0.22.0, macOS). Not a reproducible-build container, so other tools may give a different hash |
| Access keys | None: `near account list-keys escrow-v4.handova.testnet network-config testnet now` |
| Upgrade path in the code | None: no `deploy_contract`, `migrate` or `init(ignore_state)` in `contract/src/` |
| Token | `usdc.handova.testnet`, a test token anyone can mint, not Circle USDC |

Deployment: [create](https://testnet.nearblocks.io/txns/HceuZQ8vozPFQPuDT3DmXuaYMsuPeFxGsaaVdBZLYpnb) · [deploy and init](https://testnet.nearblocks.io/txns/5XNSgvSraX1CgcxgJPVyuDJ2T7Ag9ghunns3BcExL9fW) · [token registration](https://testnet.nearblocks.io/txns/234XbuBtYF5XSKAG248c7YvR48aCeXQcU9uvh3yG2M5N) · [lock: last key deleted](https://testnet.nearblocks.io/txns/rBoduTiQyybp1wLm6p2RjHmH11V7NXGxn12WHpkeBdi). The two Lagos listings were copied from v3 with the same terms ([#1](https://testnet.nearblocks.io/txns/GxEhWh9r8ABgWPVDev5GLrxZpryUCU3RFHXXg1fmrGFG), [#2](https://testnet.nearblocks.io/txns/FHJVX9nHwWg5a66Lk4JnkjM4vLCcZs5jYJMgHf2SAki3)), from the team-run account `lagos-homes.handova.testnet`.

## Claims

| Claim | Status | How to check |
|---|---|---|
| Silence never releases rent | ✅ Code and tests | No `claim_move_in` in `contract/src/`; unit tests and browser test "silence pays nobody" |
| A payment is refused if the listing's terms changed | ✅ Unit tests | `PayMsg` in `contract/src/escrow.rs` carries rent, caution and term |
| The caution goes to the NFT holder, not the payer | ✅ On `escrow-v4` | [Lease #4](#a-full-lease-on-escrow-v4): the nurse paid, mum held the NFT and received the full 150 USDC caution |
| App actions are gasless | ✅ On `escrow-v4` | Lease #4's steps were relayed by `handova-relayer.testnet`; the nurse's NEAR balance didn't change |
| The lease NFT moves only to the tenant the landlord named | ✅ Unit and sandbox tests; live sale | `consent_takeover(lease_id, buyer)`; `contract/tests/sandbox.rs` |
| A Mintbase sale is refused before the landlord names the buyer, and completes after | ✅ On `escrow-v4` | Lease #1 with [`scripts/mintbase-sale-testnet.ts`](../scripts/mintbase-sale-testnet.ts): `get_lease(1)` shows the buyer as `tenant` and `nft_holder` and the first tenant as `payer`. The script doesn't print hashes; they are on [the escrow's page](https://testnet.nearblocks.io/address/escrow-v4.handova.testnet) |
| A DAO vote decides a dispute | ✅ On `escrow-v4`, by team keys | [Lease #2](#a-dao-ruling-on-escrow-v4), proposal #1. Proves the mechanism, not independent arbitration |
| An unsettled caution dispute pays the landlord only what the holder offered | ✅ Unit tests | `settle_dispute_timeout` in `contract/src/escrow.rs` |
| A replaced arbiter can't rule on an open lease | ✅ Unit test | Each lease stores its `arbiter` |
| Inspection "before" photos are fixed at payment | ✅ Code | The lease stores `property_ref`; `server/near/inspect.ts` reads it |
| The passport counts months actually lived | ✅ Unit tests | `rental_record` in `contract/src/market.rs` |
| Storage can't block open leases | ✅ Sandbox test | Each open lease reserves 4,096 bytes; the worst case measured 3,857. `get_config.storage_spare` |
| Failed withdrawals keep the money | ✅ Unit and sandbox tests | `failed_withdrawal_keeps_the_money` |
| The contract's USDC covers what it owes | ✅ Sandbox tests; live values matched on 6 Nov | `get_config.total_held` against `ft_balance_of` on the token; they match when no withdrawal is in flight |
| Takeover through to closing, with the caution paid to the buyer | ⚠️ On `escrow-v3` only | [Earlier deployment](#earlier-deployment-escrow-v3). On v4 the sold lease (#1) is still open |
| Paying from another chain, landlord cash-out | ❌ Not shown | Live quotes only; arrival simulated with test USDC. No real Intents settlement has run |
| Real rentals | ❌ None | Nobody outside the team has used it for a rental |

## A full lease on escrow-v4

Lease #4, from `bun run demo:testnet` on 5 Nov 2026 with demo accounts and test USDC. It is not a real rental. `get_lease` (`lease_id` 4): `payer` `nurse-mw4vb4cb.handova.testnet`, `tenant` and `closed_holder` `mum-mw4vb8am.handova.testnet`, caution 150, `caution_to_holder` 150, status `Closed`. The NFT reads "Handova lease #4 · Closed".

| Step | Events | Transaction |
|---|---|---|
| The nurse pays for mum (relayed) | `lease_paid` | [`4p1yFkLo…`](https://testnet.nearblocks.io/txns/4p1yFkLo9uDSd6p1WLyckLLBCgjs8Ue7gjrFQKeW7PWa) |
| Mum confirms move-in (relayed) | `moved_in`, `nft_mint` | [`EnZKgh7A…`](https://testnet.nearblocks.io/txns/EnZKgh7AuAsD7msqh8vuEnkLAMEjMJMfUu83DWE8YHa4) |
| Mum withdraws the caution (relayed) | `withdrawn` | [`3gK7kFC6…`](https://testnet.nearblocks.io/txns/3gK7kFC6oWGEvUsCqsTWZfkKUB8C6LeAmgzUY12VNqcn) |

## A DAO ruling on escrow-v4

Lease #2, from [`scripts/dao-ruling-testnet.ts`](../scripts/dao-ruling-testnet.ts). The landlord claimed 3 of the 4 USDC caution; the council's proposal #1 awarded the landlord 1 and the holder 3. Check with `get_lease` (`lease_id` 2) and `get_proposal` (`id` 1) on `handova-council.sputnikv2.testnet`. Both votes came from team keys (the owner and the verifier).

| Step | Events | Transaction |
|---|---|---|
| Landlord disputes the caution | `caution_disputed` | [`PGZc96WG…`](https://testnet.nearblocks.io/txns/PGZc96WGfr3uDx8tiS95ctNPq8nJDeCLA5qbnzrcniX) |
| `handova.testnet` proposes `resolve_dispute` |  | [`9mmf1eSE…`](https://testnet.nearblocks.io/txns/9mmf1eSEobaLFpquYZQ3mpEJmUoGy5C9y9uCtrxhB694) |
| Vote 1, `handova.testnet`: not enough alone |  | [`ECASKWpT…`](https://testnet.nearblocks.io/txns/ECASKWpT42Y1n8yM16p3CRp1V7R4XmUpPLaUs7Ljro5v) |
| Vote 2, `verifier.handova.testnet`: the DAO calls the escrow | `lease_closed` | [`4Cou7UN3…`](https://testnet.nearblocks.io/txns/4Cou7UN3pA1CbKkrL5EfA7kdY5gJsUyaDAMfzYfvF8mW) |

## Earlier deployment (escrow-v3)

`escrow-v3.handova.testnet` stays on-chain under the old rules (silence could release rent for a verified landlord; consent didn't name a buyer). Its lease #2 is still the only run where a lease was taken over and then closed, with the caution paid to the buyer: payer `nurse-wnjg8`, closing holder `tolu-wnjg8`, 138.59 USDC to the holder after an agreed 10 USDC split.

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

## Test deployment

Browser tests run on `escrow-v7.handova-3b5eb6e5.testnet`, which has the **same code hash** as `escrow-v4`. The difference is configuration: 20-second waiting periods instead of 7 days, and its own accounts.

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

These are the test titles as written in `e2e/`. All 29 have passed on the v4 code, across several runs rather than one clean run.

## Who holds power today

- Owner: `handova.testnet`. Verifier: `verifier.handova.testnet`.
- Arbiter for leases on `escrow-v4`: `handova-council.sputnikv2.testnet`, threshold 2. Members are `handova.testnet`, `verifier.handova.testnet` and `tester1604.testnet`. All three are team accounts, and the owner and verifier alone can reach the threshold.
