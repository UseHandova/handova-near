# Handova reference

Contract methods, API routes and configuration for the escrow at `escrow-v3.handova.testnet` (no access keys: the code can't be changed). The overview is in the [README](../README.md).

## Contract reference

`escrow-v3.handova.testnet` — init: `new(owner, verifier, arbiter, token, token_decimals?, timeouts?)`. Amounts are USDC base units (1 USDC = `1000000`).

**Calls**

| Method | Who | Effect |
|---|---|---|
| `create_listing(rent, caution, term_months, property_ref)` | anyone (landlord) | New listing; rent ≥ 1 USDC; `property_ref` = listing details as JSON (≤1 KB); 3 listings until verified, 50 after |
| `update_listing(listing_id, rent?, caution?, term_months?, property_ref?, available?)` | landlord | Pause/resume; prices only while no lease is open |
| `ft_on_transfer` (via `usdc.ft_transfer_call`, `msg: {"listing_id":N,"tenant":"optional"}`) | USDC contract | Pay rent + caution; creates a `Pending` lease |
| `mark_handover(lease_id)` | landlord | Starts the 3-day silence window |
| `confirm_move_in(lease_id)` | tenant | Rent to landlord, NFT to tenant |
| `claim_move_in(lease_id)` | anyone | After the window; only if the landlord was ID-verified when the tenant paid and still is |
| `dispute_move_in(lease_id, reason)` | tenant or landlord, once | Sends the handover to the arbiter |
| `resolve_move_in(lease_id, moved_in)` | that lease's arbiter (fixed at payment) | Moved in, or full refund |
| `settle_move_in_timeout(lease_id)` | anyone | Arbiter silent 7 days → payer refunded |
| `cancel_lease(lease_id)` | landlord any time before move-in; tenant/payer after 7 days with no handover | Full refund to the payer |
| `move_out(lease_id)` | NFT holder; landlord after the term ends | Starts the 7-day review |
| `approve_move_out(lease_id)` | landlord | Full caution to the holder |
| `dispute_caution(lease_id, landlord_claim, reason)` | landlord, during review | Opens a caution dispute |
| `claim_caution(lease_id)` | anyone, after the review window | Full caution to the holder |
| `propose_split(lease_id, landlord_amount)` | landlord or holder | Equal proposals settle |
| `resolve_dispute(lease_id, landlord_amount)` | that lease's arbiter (fixed at payment) | ≤ the landlord's claim |
| `settle_dispute_timeout(lease_id)` | anyone, after the dispute window | 50/50, capped at the claim |
| `withdraw(amount?)` | anyone with a balance | Sends USDC; restored on failure |
| `nft_transfer`, `nft_transfer_call` | holder (or an approved marketplace), 1 yocto, `Active` only | Only to the account the landlord agreed to (`consent_takeover`); the receiver becomes the tenant and the offer is cleared. If an `nft_transfer_call` receiver returns the NFT, nothing changes |
| `nft_approve`, `nft_revoke`, `nft_revoke_all` | holder, `Active` only for approve | NEP-178 approvals for marketplaces |
| `offer_takeover(lease_id, price)` / `cancel_takeover(lease_id)` | NFT holder, `Active` | Offer the rest of the lease for a USDC price (0 allowed); a new offer clears any requester and agreement |
| `request_takeover(lease_id)` | anyone but the holder and landlord, open offer, before the landlord agrees | Become the requester (`takeover.buyer`) |
| `consent_takeover(lease_id)` | landlord, after a request | Agree to that requester only |
| `ft_on_transfer` with `msg: {"take_over": <lease id>}` | USDC contract | Buy a takeover; the sender must be the agreed requester |
| `set_verified(account_id, verified)` | verifier | ID-verified badge |
| `set_verifier`, `set_arbiter`, `set_owner` | owner | Affect only leases paid afterwards: each lease stores its arbiter and the landlord's verified status at payment. No access to money |

| `nft_payout(token_id, balance, max_len_payout?)` · `nft_transfer_payout(receiver_id, token_id, approval_id?, memo?, balance, max_len_payout?)` | marketplace | NEP-199: the whole price to the holder; only while Active, after `consent_takeover`, and only to the agreed requester |

**Views:** `get_config`, `get_listing`, `get_listings(from_index?, limit?, only_open?)`, `get_lease` (includes the current `nft_holder`, the lease's `arbiter`, `landlord_verified` at payment, and `takeover.buyer`), `get_leases(from_index?, limit?)`, `get_leases_for(account_id)`, `balance_of`, `is_verified`, `nft_token`, `nft_tokens`, `nft_tokens_for_owner`, `nft_supply_for_owner`, `nft_total_supply`, `nft_metadata`, `nft_is_approved`, `rental_record(account_id)`.

**Events** (`EVENT_JSON`, standard `handova` 1.0.0): `listing_created`, `listing_updated`, `landlord_verified`, `lease_paid`, `handover_marked`, `move_in_disputed`, `moved_in`, `lease_cancelled`, `move_out_started`, `caution_disputed`, `split_proposed`, `lease_closed`, `takeover_offered`, `takeover_requested` (`buyer`), `takeover_consented` (`buyer`), `takeover_cancelled`, `lease_taken_over`, `withdrawn`, `withdraw_failed`; plus NEP-171 `nft_mint` / `nft_transfer`.

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
| `POST /api/near/verify-landlord` · `POST /api/near/keeper/run` · `GET /api/near/ip-check` | Admin (`Authorization: Bearer $ADMIN_SECRET`) |
| `GET /api/fx` | USD→NGN rate for Naira display |

## Configuration and deployment

Contract IDs come from `deploy/<network>.json` (or `deploy/<network>.local.json` written by `setup:testnet`). Secrets come from `.env` / `.env.local` — see [`.env.example`](../.env.example):

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
| `INSPECTION_DATA_FILE` | Where inspections are kept (persistent disk in production); `lease-baselines.json`, the listing recorded at the start of each lease, sits beside it |
| `HIDDEN_LISTINGS` | Listing ids hidden from Handova's home page (comma-separated) |
| `RELAYER_DAILY_TX`, `RATE_LIMIT_SCALE`, `KEEPER`, `NEAR_RPC_FALLBACKS` | Limits and switches |

Deploy your own: `ROOT=you.testnet ./scripts/deploy-testnet.sh` (add `TIMEOUT_SECS=20` for short waiting periods). Build the contract: `bun run contract:build`.
