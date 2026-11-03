# Handova — rent in Lagos straight from the landlord, with the rent in escrow on NEAR

Handova lets a tenant rent a home directly from the landlord, with no agent. The tenant (or family abroad) pays rent and the caution fee in USDC into a NEAR smart contract. The landlord is paid when the tenant confirms they moved in (or, only for an ID-verified landlord, if the tenant ignores a marked handover for 3 days). The tenant then holds a **lease NFT that holds the caution fee**, and that fee comes back at move-out unless the landlord proves damage. People pay no gas, and they can pay from any chain through NEAR Intents. A tenant leaving early can **sell the rest of their lease** (with the landlord's consent), finished leases form an on-chain **rental passport**, disputes are decided by a **Sputnik DAO council**, landlords can get an **ID-verified badge recorded on NEAR** (Didit), and the app speaks **English, Naijá, Yorùbá, Hausa and Igbo**.

> **Status, plainly:** everything runs on **NEAR testnet** (contract [`escrow-v2.handova.testnet`](https://testnet.nearblocks.io/address/escrow-v2.handova.testnet)). NEAR Intents has no testnet, so the app shows a live 1Click quote and then **simulates** the deposit arriving with test USDC; the escrow payment after that is a real testnet transaction. Two real Lagos homes are listed (Yaba, Ikorodu) with their own photos and video; nobody has rented through it yet.

**Built at NEAR HACKATHON (1–14 Nov 2026).** Tracks: `realworld`, `nfts`. Built on an earlier Arc version of Handova; only the NEAR work is the entry — see [Built before / during the hackathon](#built-before--during-the-hackathon).

- 🌍 **Try it live (testnet, phone or desktop):** https://handova-near.vercel.app — web app on Vercel, API (relayer, keeper, accounts, ID checks) on Railway
- 🎬 **Demo video (3 min, real testnet, four phones, Nigerian narrator):** YOUTUBE_LINK
- 🧪 **Reproduce it yourself:** [`REPRODUCE.md`](REPRODUCE.md) — three commands, your own testnet accounts, no keys from us
- 📜 **Contract:** [`contract/src/`](contract/src) · **Server:** [`server/near/`](server/near) · **Web app:** [`web/src/`](web/src) · **Browser tests:** [`e2e/`](e2e)

![Handova on desktop: homes with photos and a video that plays on hover](docs/screenshots/00-desktop-home.png)

| ![Home](docs/screenshots/01-home.png) | ![NEAR AI listing draft](docs/screenshots/02-ai-draft.png) | ![Pay from any chain](docs/screenshots/04-intents-quote.png) | ![Lease NFT](docs/screenshots/06-lease-nft.png) |
|---|---|---|---|
| Homes, priced in Naira | Voice note → listing (NEAR AI, verified TEE) | Pay from Base, Solana… (NEAR Intents) | Lease NFT holding the caution fee |
| ![Landlord consents to a takeover](docs/screenshots/10-landlord-consent.png) | ![Take over a lease](docs/screenshots/11-takeover-offers.png) | ![DAO arbiter](docs/screenshots/12-dao-arbiter.png) | ![Rental passport](docs/screenshots/13-passport.png) |
| Landlord sees the passport and consents to a takeover | Leases offered for takeover | Disputes go to a 2-of-3 DAO council | The tenant's rental passport |

**For tenants and landlords alike:** people choose at sign-up whether they're renting or letting (switchable on the Account page), and the menu follows: tenants get *My rentals*, landlords get their landlord page with the Didit ID check. On desktop the homes show in a grid with area tabs and page numbers, and the listing, lease, account and landlord pages split into two columns (details left, money and actions right); on phones everything is one column. A listing's walk-through video plays when you hover over it (or while it's on screen on a phone).

**New for landlords and leaving tenants:** landlords can **cash out to an exchange on any chain** (USDT on TRON or BNB Chain, USDC on Base or Solana…) through NEAR Intents; a tenant leaving early can also **list the lease on Mintbase's NFT market**, and the sale only completes if the landlord agreed (NEP-199 payouts); at move-out, either side can ask **NEAR AI to compare the listing photos with move-out photos** and suggest a fair caution split, with a verified TEE receipt (advice only).

---

## Contents
1. [The problem](#the-problem)
2. [The one moment](#the-one-moment)
3. [How NEAR is used](#how-near-is-used)
4. [The lease NFT](#the-lease-nft-that-holds-the-caution-fee)
5. [Escrow rules and lease states](#escrow-rules-and-lease-states)
6. [Architecture](#architecture)
7. [Contract reference](#contract-reference)
8. [API reference](#api-reference)
9. [Try it](#try-it)
10. [Testing](#testing)
11. [Landlord verification](#landlord-verification-didit--near)
12. [Security model and known limits](#security-model-and-known-limits)
13. [Independent AI review](#independent-ai-review-near-ai-cloud)
14. [Configuration and deployment](#configuration-and-deployment)
15. [Built vs planned](#built-vs-planned)
16. [Built before / during the hackathon](#built-before--during-the-hackathon)

---

## The problem

- **A year up front, to strangers.** Rent is usually paid for the whole year before moving in. Fake listings take the money and disappear.
- **Fees on top.** Agent and agreement fees are added to the rent.
- **The caution fee is a gamble.** Getting the security deposit back depends on the landlord's goodwill.
- **Family abroad often pays.** Transfers to Nigeria are slow and expensive, and the payer has no say over when the landlord gets the money.

(We quote no market percentages: we have no cited source yet.)

## The one moment

> A nurse in London pays her mum's Lagos rent from a wallet on another chain → it lands in the Handova escrow on NEAR → mum confirms she moved in → only then is the landlord paid → mum holds the lease NFT → at move-out the caution fee returns to her. No agent fee, no gas.

| | What happens | NEAR piece |
|---|---|---|
| 0 | Ade signs up as a landlord; he can verify his ID with Didit and the badge is written on NEAR | NEP-413 signed message · `set_verified` |
| 1 | Ade (landlord) describes his flat in Pidgin; NEAR AI drafts the listing; he adds photos, checks it and publishes | NEAR AI Cloud (TEE) · gasless `create_listing` |
| 2 | The nurse pays rent + caution **for mum** from Base USDC (or USDC on NEAR) | NEAR Intents 1Click → `ft_transfer_call` |
| 3 | The money is locked in the escrow, status `Pending` | `ft_on_transfer` |
| 4 | Ade marks the handover; mum confirms move-in | `mark_handover`, `confirm_move_in` |
| 5 | Rent is credited to Ade; mum receives lease NFT #N holding the caution | NEP-171 mint, live metadata |
| 6 | Ade withdraws the full rent | pull-based `withdraw` |
| 7 | Mum moves out; Ade approves; the caution goes to the NFT holder | `move_out`, `approve_move_out` |

Every step is in the [demo video](YOUTUBE_LINK) (four phones side by side — landlord, nurse abroad, mum, next tenant — recorded from the real app on testnet with [`scripts/record-demo.mjs`](scripts/record-demo.mjs)) and in [`bun run demo:testnet`](scripts/demo-testnet.ts).

## How NEAR is used

| Feature | NEAR technology | Where |
|---|---|---|
| Escrow that pays the landlord only after move-in; caution returned at move-out | Rust contract, near-sdk 5.30 | [`contract/src/escrow.rs`](contract/src/escrow.rs) |
| Pay rent + caution in **one transaction** | NEP-141 `ft_transfer_call` → `ft_on_transfer`; excess refunded | [`escrow.rs` `ft_on_transfer`](contract/src/escrow.rs) |
| Lease NFT that **holds** the caution fee | NEP-171 + enumeration + metadata in the same contract as the escrow | [`contract/src/nft.rs`](contract/src/nft.rs) |
| NFT that shows the live lease | Dynamic metadata: title, description, `extra` and an on-chain SVG built from the lease at view time | [`nft.rs` `live()`](contract/src/nft.rs), [`svg.rs`](contract/src/svg.rs) |
| No gas for users | NEP-366 meta transactions: the phone signs a delegate action; the relayer verifies it and pays gas | [`server/near/relayer.ts`](server/near/relayer.ts), [`shared/gasless.ts`](shared/gasless.ts) |
| Accounts for people without a wallet | Named sub-accounts `name.handova.testnet` created with the **device's own key**; 12-word recovery phrase | [`server/near/accounts.ts`](server/near/accounts.ts), [`web/src/lib/session.tsx`](web/src/lib/session.tsx) |
| Verified landlords | Didit ID + liveness + face check. The landlord first proves control of the account with a **NEP-413 signed message**; on approval Handova's verifier account calls `set_verified` on the escrow, which unlocks the badge, silence claims and more than 3 listings | [`server/near/verify.ts`](server/near/verify.ts), [`shared/nep413.ts`](shared/nep413.ts), [`VerifyIdentity.tsx`](web/src/components/VerifyIdentity.tsx) |
| Existing NEAR wallets | NEAR Connect (`@hot-labs/near-connect`): HOT, Meteor, MyNearWallet, Intear… | [`session.tsx`](web/src/lib/session.tsx) |
| Pay from any chain | NEAR Intents 1Click: `EXACT_OUTPUT` quote → deposit on the origin chain → USDC delivered to the payer's NEAR account → gasless `ft_transfer_call` into escrow | [`server/near/intents.ts`](server/near/intents.ts), [`IntentsPay.tsx`](web/src/components/IntentsPay.tsx) |
| Voice note or text → listing draft | NEAR AI Cloud, models in TEEs (`openai/whisper-large-v3`, `z-ai/glm-5.3-flash`); each answer has a receipt the server checks | [`server/near/ai.ts`](server/near/ai.ts) |
| Ownership document pre-check (admin, never approves) | NEAR AI Cloud vision model in a TEE (`z-ai/glm-5.3-flash`) | `POST /api/ai/document-check` |
| Hand a lease to the next tenant | In-contract takeover market (holder's price, landlord's consent, buyer pays with one `ft_transfer_call`) plus NEP-178 approvals for external marketplaces | [`contract/src/market.rs`](contract/src/market.rs), [`nft.rs`](contract/src/nft.rs) |
| Sell a lease on NEAR marketplaces | **NEP-199 payouts** (`nft_payout`, `nft_transfer_payout`): a marketplace sale completes only if the landlord agreed to the handover; the buyer becomes the tenant. Tested with Mintbase's open market contract on testnet (`market-v2-beta.mintspace2.testnet`), listed and bought from Handova's lease page | [`nft.rs`](contract/src/nft.rs), [`MintbaseListing.tsx`](web/src/components/MintbaseListing.tsx), [`scripts/mintbase-sale-testnet.ts`](scripts/mintbase-sale-testnet.ts) |
| Landlords cash out to any chain | NEAR Intents 1Click, the other way round: exact USDC from the landlord's NEAR account → USDT on TRON / BNB Chain, USDC on Base / Solana… at their exchange or wallet. The relayer only sends to a deposit address issued to that landlord | [`intents.ts`](server/near/intents.ts), [`CashOut.tsx`](web/src/components/CashOut.tsx) |
| AI move-out inspection | NEAR AI vision model in a TEE compares the listing's photos with move-out photos and suggests a share of the caution, with a checked receipt. Advice only; requested by the landlord or holder with a NEP-413 signature | [`inspect.ts`](server/near/inspect.ts), [`Inspection.tsx`](web/src/components/Inspection.tsx) |
| Rental passport | `rental_record` view computed from the finished lease NFTs an account held | [`market.rs`](contract/src/market.rs), [`Passport.tsx`](web/src/components/Passport.tsx) |
| Disputes decided by a council, not one key | Sputnik DAO (`sputnikv2.testnet`) as the arbiter: members propose a ruling and vote; the DAO calls the escrow | [`scripts/create-arbiter-dao.ts`](scripts/create-arbiter-dao.ts), [`web/src/lib/dao.ts`](web/src/lib/dao.ts), [`DaoRulings.tsx`](web/src/components/DaoRulings.tsx) |
| Timeouts nobody acted on | Keeper calls the contract's "anyone may trigger" methods | [`server/near/keeper.ts`](server/near/keeper.ts) |
| Following lease events | NEP-297 `EVENT_JSON` logs for every step | [`contract/src/events.rs`](contract/src/events.rs) |

Languages: the main screens are in English, Naijá (Pidgin), Yorùbá, Hausa and Igbo, using the wording the team wrote for the Arc version (new lines still need a native-speaker review). Listing drafts are tested on English and Pidgin text; voice goes through Whisper, which lists English, Yorùbá and Hausa (not Igbo).

## The lease NFT that holds the caution fee

An NFT on NEAR can't hold tokens by itself. So **one contract is both the escrow and the NEP-171 token contract**: the caution stays in the contract's USDC balance, and the right to get it back is bound to `nft_token(lease_id).owner_id` at payout time — not to a stored tenant address.

| Lease status | NFT | Caution |
|---|---|---|
| `Active` | Transferable (`nft_transfer`, `nft_transfer_call`). A new tenant takes over the lease; the caution right moves with it | Held |
| `Ending` (move-out review) / `Disputed` | **Locked** | Held |
| `Closed` | Locked; stays with the tenant as a record of a finished lease | Paid out (amounts recorded on the lease) |

The metadata is never stored: `nft_token`, `nft_tokens` and `nft_tokens_for_owner` compute the title (`Handova lease #2 · Active`), description, `extra` JSON (`status`, `caution_held`, `ends_at_ms`…) and an SVG picture from the current lease state.

NEP-171 transfers need exactly 1 yoctoNEAR, which the relayer never pays, so the holder signs a transfer directly (new accounts get 0.05 NEAR for this).

### Selling the rest of a lease (takeover)

A tenant who leaves early can hand the home — and the caution right — to the next tenant:

1. The holder calls `offer_takeover(lease_id, price)`.
2. The landlord calls `consent_takeover` (a lease never changes hands without the landlord).
3. The new tenant pays the price with one `usdc.ft_transfer_call(escrow, price, '{"take_over": <lease id>}')` — gasless in the app. The seller is credited the price, the NFT moves to the buyer (approvals cleared, NEP-171 `nft_transfer` event), and the buyer becomes the tenant.

Offers show on the home page under **Take over a lease**. An offer ends if the NFT moves another way. External marketplaces can also list an active lease through standard **NEP-178** approvals (`nft_approve`, `nft_revoke`, `nft_is_approved`).

### Rental passport

`rental_record(account_id)` turns the lease NFTs an account held into a record nobody can edit: leases finished, how many times the caution came back in full, caution kept for damage, homes lived in, months rented and the rent of those leases (after a takeover the buyer counts as the tenant, so the lease's rent is attributed to them). Tenants see it under **Account → My rental passport** (`#/passport/<account>`); a landlord sees a summary of the tenant's record on every lease waiting for a handover or a takeover.

## Escrow rules and lease states

| Situation | What happens on-chain |
|---|---|
| Tenant (or anyone for them) pays | Rent + caution locked, status `Pending`. Overpayment refunded; a bad `msg` refunds everything |
| Tenant confirms move-in | Rent credited to the landlord; lease NFT minted to the tenant (`Active`) |
| Landlord marked the handover, tenant silent 3 days | **Only for ID-verified landlords:** anyone can trigger `claim_move_in`. An unverified landlord always needs the tenant's confirmation, so a fake listing can't collect rent by silence |
| Holder offers the lease, landlord consents, a buyer pays | Seller paid the price; NFT and caution right move to the buyer, who becomes the tenant |
| Either side disputes the handover | `dispute_move_in` (once); the arbiter rules moved-in or full refund |
| Handover disputed, arbiter silent 7 days | Anyone can trigger `settle_move_in_timeout`: the payer is refunded in full |
| No handover within 7 days of payment | Tenant or payer cancels; the **payer** is refunded in full. The landlord can decline any time before move-in |
| Tenant moves out (or landlord, after the term ends) | 7-day landlord review (`Ending`): approve → full caution to the NFT holder; or dispute part of it |
| Landlord silent for the review window | Anyone can trigger `claim_caution`: full caution to the NFT holder |
| Caution dispute | Both propose the same split → settles; or the arbiter decides (never more than the landlord claimed); nobody settles in 7 days → 50/50, capped at the landlord's claim |
| Payouts | Pull-based `withdraw`; if the token transfer fails, the balance is restored |

```mermaid
stateDiagram-v2
    [*] --> Pending: ft_transfer_call (rent + caution)
    Pending --> Active: confirm_move_in / claim_move_in (verified) / arbiter rules moved in
    Pending --> Cancelled: cancel_lease / arbiter refund / settle_move_in_timeout
    Active --> Ending: move_out
    Ending --> Closed: approve_move_out / claim_caution
    Ending --> Disputed: dispute_caution
    Disputed --> Closed: propose_split agreed / resolve_dispute / settle_dispute_timeout
    Closed --> [*]
    Cancelled --> [*]
```

The owner can change the verifier and arbiter but **cannot move anyone's money**. There is no upgrade method. Waiting periods are fixed at deployment (3 days handover claim; 7 days cancel, review and dispute).

## Architecture

```mermaid
flowchart LR
    subgraph Phone["Phone · web app"]
        K["Key made on device · 12-word phrase"]
        W["NEAR Connect wallet"]
    end
    subgraph API["Handova API · Bun"]
        R["/api/relay · NEP-366 relayer"]
        A["/api/accounts · named accounts"]
        I["/api/intents · 1Click"]
        AI["/api/ai · NEAR AI + receipts"]
        P["/api/rpc · RPC failover"]
        KP["keeper"]
    end
    subgraph NEAR["NEAR testnet"]
        E[("escrow-v2.handova.testnet · escrow + NEP-171")]
        U[("USDC · NEP-141")]
        NI["NEAR Intents"]
        NA["NEAR AI Cloud · TEE"]
    end
    K -- "signed delegate action" --> R -- "pays gas" --> E
    K -- "public key only" --> A
    W -- "signs and pays gas" --> E
    I --> NI -- "USDC to payer" --> U
    U -- "ft_transfer_call" --> E
    AI --> NA
    KP -- "expired timeouts" --> E
    P --> NEAR
```

Paying rent gaslessly, in one transaction:

```mermaid
sequenceDiagram
    participant Phone as Nurse's phone
    participant Relayer as Handova relayer
    participant USDC as USDC (NEP-141)
    participant Escrow as Handova escrow
    Phone->>Phone: sign delegate: ft_transfer_call(escrow, total, listing_id, tenant = mum)
    Phone->>Relayer: POST /api/relay
    Relayer->>Relayer: allowlist, ed25519 signature, sender's key, gas, limits
    Relayer->>USDC: transaction carrying the delegate (relayer pays gas)
    USDC->>Escrow: ft_on_transfer(nurse, amount, msg)
    Escrow-->>USDC: unused amount (0, or the overpayment)
    Escrow-->>Phone: EVENT_JSON lease_paid (tenant mum, payer nurse)
```

| Folder | What |
|---|---|
| `contract/` | Rust escrow + lease NFT (`src/`), unit tests (`src/tests.rs`), sandbox tests (`tests/sandbox.rs`), test-only USDC (`mock-ft/`) |
| `server/near/` | NEAR API: relayer, accounts, Intents, NEAR AI, keeper, RPC proxy, FX rate |
| `server/index.ts` | API entry point (`bun run server`); `server/media.ts` handles photo uploads |
| `shared/` | Used by both browser and server: gasless client, transaction-outcome parsing, units |
| `web/` | The NEAR web app |
| `e2e/` | Playwright end-to-end suite against testnet |
| `deploy/<network>.json` | Contract IDs per network — nothing is hardcoded |
| `scripts/` | `setup-testnet.sh`, `deploy-testnet.sh`, `demo-testnet.ts`, `record-demo.mjs` + `compose-demo.mjs` (video), `ai-review.ts` |

## Contract reference

`escrow-v2.handova.testnet` — init: `new(owner, verifier, arbiter, token, token_decimals?, timeouts?)`. Amounts are USDC base units (1 USDC = `1000000`).

**Calls**

| Method | Who | Effect |
|---|---|---|
| `create_listing(rent, caution, term_months, property_ref)` | anyone (landlord) | New listing; rent ≥ 1 USDC; `property_ref` = listing details as JSON (≤1 KB); 3 listings until verified, 50 after |
| `update_listing(listing_id, rent?, caution?, term_months?, property_ref?, available?)` | landlord | Pause/resume; prices only while no lease is open |
| `ft_on_transfer` (via `usdc.ft_transfer_call`, `msg: {"listing_id":N,"tenant":"optional"}`) | USDC contract | Pay rent + caution; creates a `Pending` lease |
| `mark_handover(lease_id)` | landlord | Starts the 3-day silence window |
| `confirm_move_in(lease_id)` | tenant | Rent to landlord, NFT to tenant |
| `claim_move_in(lease_id)` | anyone | After the window, verified landlords only |
| `dispute_move_in(lease_id, reason)` | tenant or landlord, once | Sends the handover to the arbiter |
| `resolve_move_in(lease_id, moved_in)` | arbiter | Moved in, or full refund |
| `settle_move_in_timeout(lease_id)` | anyone | Arbiter silent 7 days → payer refunded |
| `cancel_lease(lease_id)` | landlord any time before move-in; tenant/payer after 7 days with no handover | Full refund to the payer |
| `move_out(lease_id)` | NFT holder; landlord after the term ends | Starts the 7-day review |
| `approve_move_out(lease_id)` | landlord | Full caution to the holder |
| `dispute_caution(lease_id, landlord_claim, reason)` | landlord, during review | Opens a caution dispute |
| `claim_caution(lease_id)` | anyone, after the review window | Full caution to the holder |
| `propose_split(lease_id, landlord_amount)` | landlord or holder | Equal proposals settle |
| `resolve_dispute(lease_id, landlord_amount)` | arbiter | ≤ the landlord's claim |
| `settle_dispute_timeout(lease_id)` | anyone, after the dispute window | 50/50, capped at the claim |
| `withdraw(amount?)` | anyone with a balance | Sends USDC; restored on failure |
| `nft_transfer`, `nft_transfer_call` | holder (or an approved marketplace), 1 yocto, `Active` only | Moves the lease and its caution right |
| `nft_approve`, `nft_revoke`, `nft_revoke_all` | holder, `Active` only for approve | NEP-178 approvals for marketplaces |
| `offer_takeover(lease_id, price)` / `cancel_takeover(lease_id)` | NFT holder, `Active` | Offer the rest of the lease for a USDC price |
| `consent_takeover(lease_id)` | landlord | Allow the offer to be bought |
| `ft_on_transfer` with `msg: {"take_over": <lease id>}` | USDC contract | Buy a consented takeover |
| `set_verified(account_id, verified)` | verifier | ID-verified badge |
| `set_verifier`, `set_arbiter`, `set_owner` | owner | Roles only — no access to money |

| `nft_payout(token_id, balance, max_len_payout?)` · `nft_transfer_payout(receiver_id, token_id, approval_id?, memo?, balance, max_len_payout?)` | marketplace | NEP-199: the whole price to the holder; only while Active and after `consent_takeover` |

**Views:** `get_config`, `get_listing`, `get_listings(from_index?, limit?, only_open?)`, `get_lease` (includes the current `nft_holder`), `get_leases(from_index?, limit?)`, `get_leases_for(account_id)`, `balance_of`, `is_verified`, `nft_token`, `nft_tokens`, `nft_tokens_for_owner`, `nft_supply_for_owner`, `nft_total_supply`, `nft_metadata`, `nft_is_approved`, `rental_record(account_id)`.

**Events** (`EVENT_JSON`, standard `handova` 1.0.0): `listing_created`, `listing_updated`, `landlord_verified`, `lease_paid`, `handover_marked`, `move_in_disputed`, `moved_in`, `lease_cancelled`, `move_out_started`, `caution_disputed`, `split_proposed`, `lease_closed`, `takeover_offered`, `takeover_consented`, `takeover_cancelled`, `lease_taken_over`, `withdrawn`, `withdraw_failed`; plus NEP-171 `nft_mint` / `nft_transfer`.

## API reference

| Route | What |
|---|---|
| `GET /api/near/config` | Network, contract IDs, which features are on |
| `GET /api/health` | Status plus relayer and account-creator NEAR balances (`low: true` when a top-up is needed) |
| `GET /api/accounts/check?name=` · `POST /api/accounts {name, publicKey}` | Name availability; create `name.<parent>` with the device's public key, 0.05 NEAR and USDC registration (resumes a half-finished attempt) |
| `POST /api/relay {signedDelegate}` | NEP-366 relay (base64 borsh `SignedDelegate`) |
| `GET /api/intents/tokens` · `POST /api/intents/quote` · `GET /api/intents/status` · `POST /api/intents/submit` | NEAR Intents 1Click; testnet answers dry quotes only |
| `POST /api/ai/listing-draft {text or audioBase64, mime}` · `POST /api/ai/document-check` | NEAR AI with a checked receipt |
| `GET /api/verify/challenge?accountId=` · `POST /api/verify/didit/session` · `POST /api/verify/didit/complete` · `POST /api/verify/didit/resume` · `GET /api/verify/status` | Landlord ID check: NEP-413 challenge, Didit session, result → `set_verified` on NEAR |
| `POST /api/intents/payout-quote {amountIn, destinationAsset, recipient, refundTo}` | Landlord cash-out quote (USDC on NEAR → any chain); dry on testnet |
| `GET /api/ai/inspect/challenge` · `POST /api/ai/inspect` · `GET /api/ai/inspections?leaseId=` | NEAR AI move-out inspection (NEP-413-signed request, TEE receipt) |
| `POST /api/faucet {accountId}` | Testnet only: 2,000 test USDC |
| `POST /api/rpc` | Same-origin JSON-RPC proxy (reads + sending signed transactions), failover across 5 providers |
| `POST /api/media` | Listing photo upload |
| `POST /api/near/verify-landlord` · `POST /api/near/keeper/run` | Admin (`Authorization: Bearer $ADMIN_SECRET`) |
| `GET /api/fx` | USD→NGN rate for Naira display |

## Try it

### A. Check the live testnet contract (no setup)
```sh
near contract call-function as-read-only escrow-v2.handova.testnet get_config json-args '{}' network-config testnet now
near contract call-function as-read-only escrow-v2.handova.testnet get_lease json-args '{"lease_id":1}' network-config testnet now
near contract call-function as-read-only escrow-v2.handova.testnet nft_token json-args '{"token_id":"1"}' network-config testnet now
```
You'll see the 3-day/7-day rules, lease #1 from the demo script (`"status": "Closed"`, `caution_to_holder: "150000000"`), and lease NFT #1 (`"title": "Handova lease #1 · Closed"`).

### B. Contract tests (Rust only)
```sh
cd contract && cargo test
```
**35 unit tests** + **3 sandbox tests** (a local NEAR node with a real NEP-141 token: family pays for mum; NFT transfer then a 50/50 timeout; a failed withdrawal keeps the money; the contract's USDC balance always equals what it owes).

### C. Your own Handova on testnet (about 3 minutes, no keys from us)
Needs [Bun](https://bun.sh), [near CLI](https://github.com/near/near-cli-rs) and [cargo-near](https://github.com/near/cargo-near).
```sh
bun install
bun run setup:testnet   # faucet accounts, test USDC, escrow, relayer → deploy/testnet.local.json + .env.local
bun run demo:testnet    # the whole story through the real API, gasless, with explorer links
```
Expected output is in [`REPRODUCE.md`](REPRODUCE.md).

### D. The web app
```sh
bun run server          # API on :3001
bun run dev             # http://localhost:5188
```
1. **Get started → Create an account** → pick a name. The recovery phrase is under **Account**.
2. **Landlord → List a home** → type "2 bedroom flat for Yaba, prepaid meter, rent 1.8m per year, caution 200k" → **Draft with NEAR AI** (needs `NEARAI_API_KEY`) → **Publish on NEAR — free**.
3. In another browser profile, create a second account → open the home → **Pay into escrow** → **Get 2,000 test USDC** → **Pay**, or **Any other chain** for a live NEAR Intents quote and a simulated arrival.
4. Landlord: **I've handed over the keys**. Tenant: **I have the keys — confirm move-in**. The lease NFT appears.
5. **Account → Withdraw**. Then move out, approve, and withdraw the caution.

### E. End-to-end suite
```sh
bun run setup:e2e && bunx playwright install chromium && bun run test:e2e
```

## Testing

| Suite | Count | What it proves |
|---|---|---|
| Contract unit (`contract/src/tests.rs`) | 37 | Every escrow rule, NFT locking, caution following the NFT, takeover with landlord consent, NEP-178 approvals, NEP-199 marketplace payouts (refused without the landlord's consent), rental passport, verified-only silence claims, arbiter timeout and caps, listing limits, 365-day terms, failed-withdraw restore |
| Sandbox (`contract/tests/sandbox.rs`) | 3 | Real `ft_transfer_call` with a real token on a local node; refunds; solvency invariant |
| Server (`server/near/*.test.ts`) | 17 | Relayer allowlist (incl. Mintbase and cash-out rules), offline signature check, gas cap; NEP-413 hashing checked against near-api-js; keeper rules; Intents quote shapes (pay-in and cash-out); AI inspection limits; NEAR AI signer recovery from a real saved receipt |
| End-to-end (`e2e/*.spec.ts`, Playwright) | 29 | A phone-sized browser drives the real app against a testnet deployment with 20-second waiting periods; balances checked on-chain after each step; any console error fails a test |

The end-to-end cases: happy path; recovery phrase and restore; taken name; family pays for someone else; payer cancel and landlord decline refunds; verified landlord claims after silence; unverified landlord can't, and a silent arbiter means a refund; tenant disputes a fake handover and the arbiter rules both ways; unverified landlord escalates and the arbiter rules moved in; every caution outcome (agreement, arbiter, 50/50, tenant claim, keeper); passing the lease NFT on; listing pause/reprice; Intents quotes (Base, Solana) and simulated arrival; NEAR AI draft with a verified receipt; relayer and admin guards; **lease takeover** (offer, landlord consent, buyer pays, caution goes to the buyer); **rental passport** (record after a finished lease, shown to the next landlord); **five languages** (switch and persist); **a real 2-of-3 Sputnik DAO** deciding a caution dispute through the app (one vote isn't enough; the second executes the ruling).

All 29 have passed on the current contract (v2), including roles, landlord cash-out, a lease sold through Mintbase's market, and the NEAR AI move-out inspection. A real sale through Mintbase's market contract also ran on testnet ([`scripts/mintbase-sale-testnet.ts`](scripts/mintbase-sale-testnet.ts)). The suite found real bugs that were then fixed: pages not refreshing when a deadline passed, the arbiter blocked by the relayer, NFT transfer running out of gas money, an AI draft cut off by reasoning tokens, and server errors that hid a drained wallet. It runs against public testnet RPCs, so Playwright retries a test once on a network blip and reports it as flaky.

## Landlord verification (Didit → NEAR)

Fake listings are the main rental scam in Lagos, so the contract treats **ID-verified landlords** differently: only they can collect rent when a tenant ignores a marked handover for 3 days, and only they can list more than 3 homes. Tenants see the badge on every listing.

How a landlord gets verified (Landlord page → *Verify my identity*):

1. **Prove the account.** The app asks the server for a one-time message and the landlord signs it with their NEAR key as a **NEP-413** signed message (no transaction, no gas). Handova accounts sign with the key on the phone; NEAR wallets sign through NEAR Connect. The server checks the ed25519 signature and that the key is a **full-access key of that account**, so nobody can verify someone else's account. Challenges are single use and expire after 10 minutes.
2. **Check the person.** The landlord takes a photo of their ID and a selfie on **Didit**'s page (document check, liveness, face match).
3. **Record it on NEAR.** When Didit approves, Handova's verifier account calls `set_verified(account, true)` on the escrow (`landlord_verified` event). The badge is public, on-chain, and readable by any app (`is_verified`).

Safeguards: one ID document can verify one account (kept only as a keyed hash of country + ID number, never the number itself); 5 attempts per account per day; Didit can only send people back to Handova's own address; a check finished on another phone or in a closed tab is collected next time the landlord opens the page; Handova never stores ID photos or names, Didit does. The verifier can only set the badge; like every other role it cannot move money.

## Security model and known limits

- **Relayer** ([`relayer.ts`](server/near/relayer.ts)): only function calls to the escrow (fixed method list, zero NEAR attached) or `ft_transfer_call` on USDC (exactly 1 yocto) whose `receiver_id` is the escrow; the ed25519 signature is verified offline and the key must be on the sender's account; arbiter rulings only for the arbiter; total gas ≤ 300 Tgas; per-sender, per-IP and daily limits; balance checks before spending.
- **Keys:** user keys are generated in the browser and never leave it. Server keys (relayer, account creator, verifier) are only in `.env` (git-ignored).
- **Contract:** pull payments; balance restored on failed `ft_transfer`; `total_held` always equals the contract's USDC balance (checked in sandbox tests); no upgrade method; every waiting state has a timeout.
- **Relayer additions:** `nft_approve` only for Mintbase's market (≤ 0.01 NEAR of the user's own balance), `deposit_storage` on that market (≤ 0.02 NEAR), USDC `ft_transfer_call` to the market only when it buys a Handova lease, and cash-out `ft_transfer` only to a NEAR Intents deposit address issued to that same sender within the hour.
- **Contract v2:** the escrow has no upgrade method, so NEP-199 meant deploying a new version at `escrow-v2.handova.testnet` (the two real homes moved over). The first deployment, `escrow.handova.testnet`, stays on-chain with the early test history.
- **Home-page moderation:** the operator can hide test or spam listings from Handova's own home page (`HIDDEN_LISTINGS`, e.g. leftovers from automated demo runs). They stay on-chain and visible to any other NEAR client, and hiding can't touch money, leases or the listing itself.
- **Known limits:** the contract pays storage for listings and leases so users never need NEAR — spam is limited by the 1 USDC minimum rent, 3 listings for unverified landlords, account-creation rate limits and the relayer budget, not by deposits. Relayer, keeper, account creator and verifier are one server. The arbiter of `escrow-v2.handova.testnet` is the Sputnik DAO `handova-council.sputnikv2.testnet` (2 of 3 council votes). Device keys live in browser storage: back up the phrase. `leases_by_account` is a vector per account.

## Independent AI review (NEAR AI Cloud)

Because AI screens submissions first, we ran a judging panel of models on NEAR AI Cloud ([`scripts/ai-review.ts`](scripts/ai-review.ts): Claude Fable 5.1, GPT-5.5, GLM-5.3, Gemini 3.8 Flash), told to be as harsh as the real judges. Both rounds said this does not place as it stands: the cross-chain payment is simulated, there are no real users, and there was no video or hosted demo yet. Overall scores were 6–6.5/10, with NEAR usage at 7–8/10. Their code findings were checked against the code; the real ones are fixed: the fraud path through silence claims, a possible deadlock for unverified landlords, disputes that could be extended, awards above the claim, the relayer paying for forged requests, and more.

## Configuration and deployment

Contract IDs come from `deploy/<network>.json` (or `deploy/<network>.local.json` written by `setup:testnet`). Secrets come from `.env` / `.env.local` — see [`.env.example`](.env.example):

| Variable | Purpose |
|---|---|
| `NEAR_NETWORK` | `testnet` (the only network used) |
| `RELAYER_ACCOUNT_ID` / `RELAYER_PRIVATE_KEY` | Pays users' gas; runs the keeper |
| `CREATOR_ACCOUNT_ID` / `CREATOR_PRIVATE_KEY` | Owns the account parent; creates user accounts |
| `VERIFIER_ACCOUNT_ID` / `VERIFIER_NEAR_PRIVATE_KEY` | Marks ID-verified landlords |
| `DIDIT_API_KEY` / `DIDIT_WORKFLOW_ID` | Didit identity checks (optional; the Verify button is hidden without them) |
| `ID_PEPPER` | Secret for hashing ID numbers (one ID, one account) |
| `VERIFICATION_DATA_FILE`, `VERIFY_RETURN_URLS` | Where pending checks are kept; where Didit may send people back |
| `ADMIN_SECRET` | Admin routes |
| `SPUTNIK_FACTORY` | DAO factory for `create-arbiter-dao.ts` (default `sputnikv2.testnet`) |
| `NEARAI_API_KEY` | NEAR AI Cloud (optional) |
| `ONECLICK_JWT` | NEAR Intents partner key (optional) |
| `MINTBASE_MARKET` | Mintbase market contract (default `market-v2-beta.mintspace2.testnet`, mainnet `simple.market.mintbase1.near`) |
| `INSPECTION_DATA_FILE` | Where inspections are kept (persistent disk in production) |
| `HIDDEN_LISTINGS` | Listing ids hidden from Handova's home page (comma-separated) |
| `RELAYER_DAILY_TX`, `RATE_LIMIT_SCALE`, `KEEPER`, `NEAR_RPC_FALLBACKS` | Limits and switches |

Deploy your own: `ROOT=you.testnet ./scripts/deploy-testnet.sh` (add `TIMEOUT_SECS=20` for short waiting periods). Build the contract: `bun run contract:build`.

## Built vs planned

| | Status |
|---|---|
| Rust escrow with every rule, lease NFT holding the caution, dynamic metadata, events | ✅ live on testnet, tested |
| Gasless relayer (NEP-366) with allowlist and signature checks | ✅ |
| Named accounts with device keys + recovery phrase; NEAR Connect | ✅ |
| Arbiter desk, listing controls, NFT hand-over, keeper | ✅ |
| Lease takeover market with landlord consent; NEP-178 approvals | ✅ |
| Rental passport | ✅ |
| Arbiter as a Sputnik DAO (2-of-3 council, proposals and votes in the app) | ✅ live: `handova-council.sputnikv2.testnet` |
| Interface in English, Naijá, Yorùbá, Hausa, Igbo | ✅ main screens (native-speaker review pending) |
| NEAR AI voice note → listing, with checked TEE receipt | ✅ |
| Pay from any chain (NEAR Intents 1Click) | ⚠️ built but **not run live**: quotes, deposit address, status polling and auto-pay are coded; on testnet the deposit is **simulated** |
| NEAR AI document pre-check | ⚠️ API only; no admin screen yet |
| Lease sale on Mintbase's market (NEP-199 payouts, landlord consent enforced) | ✅ proven on testnet with `scripts/mintbase-sale-testnet.ts` (refused before consent, completed after) |
| Landlord cash-out to any chain (NEAR Intents) | ⚠️ live quotes on testnet; sending runs on mainnet only (like the payment side) |
| AI move-out inspection (NEAR AI vision, TEE receipt) | ✅ advisory; landlord, tenant or council decide |
| Landlord ID verification (Didit → NEP-413 → `set_verified` on NEAR) | ✅ built; live checks need Didit credits on the team's account |
| Tenant / landlord roles chosen at sign-up, switchable | ✅ |
| Desktop layout: grid, area tabs, pages, animations | ✅ |
| Real landlords and tenants | ⏳ two real Lagos homes listed (Yaba, Ikorodu); no rentals yet |
| Hosted demo | ✅ https://handova-near.vercel.app (web on Vercel, API on Railway) |
| Full translation of every screen and message | ⏳ planned |

## Built before / during the hackathon

Handova first existed on **Arc** (Circle's L1) as a Solidity + USDC app: [`UseHandova/Handova`](https://github.com/UseHandova/Handova), commit `16fe0e4` (21 Oct 2026). It got little traction there, so we rebuilt it on NEAR during NEAR HACKATHON. **Only the NEAR work is the hackathon entry.**

- The first commit (tag **`baseline-arc`**) imports the Arc-era code unchanged, with no NEAR code and no Solidity. Later the EVM/Circle parts were **deleted** (no `@circle-fin`, wagmi, viem or ConnectKit remain); only the brand assets and `server/media.ts` (photo uploads) are still used.
- Everything after it is hackathon work: the Rust contract (written from scratch, not ported), `server/near/`, `shared/`, `web/`, `e2e/`, `scripts/`, `deploy/`. Diff: `git diff baseline-arc..hackathon-submission --stat` (on GitHub: `compare/baseline-arc...hackathon-submission`).

### Libraries and AI-written code
- Contract: `near-sdk` 5.30, `near-contract-standards` 5.30, `base64`; tests: `near-workspaces` 0.24, `tokio`.
- Server/web: `near-api-js` 7.4, `@hot-labs/near-connect` 0.12, `borsh`, `@noble/curves` + `@noble/hashes` (NEAR AI receipt signatures), `express`, `multer`, `react` 18, `vite`, `tailwindcss`, `lucide-react`, `qrcode`, `vite-plugin-node-polyfills`; tests: `@playwright/test`.
- External services: NEAR RPC (FastNEAR and others), NEAR Intents 1Click API, NEAR AI Cloud, Didit (identity checks), open.er-api.com (USD→NGN display rate).
- The Didit flow in [`server/near/verify.ts`](server/near/verify.ts) is adapted from the Arc version's `server/verification.ts` (same Didit calls and safeguards). What's new for NEAR: proving account control with a NEP-413 signed message instead of an EVM signature, and recording the result with the escrow's `set_verified` instead of a Solidity call.
- Video: recorded with Playwright, narrated with YarnGPT (Nigerian English voice), composed with `ffmpeg-static`.
- Most of the NEAR-edition code was written with **Claude Code** (Anthropic), directed and reviewed by the team.

### Other project
The team also submitted **PatchBond** (refundable bonds for pull requests), an independent project.

## License
MIT — see [LICENSE](LICENSE).
