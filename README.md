# Handova — rent in Lagos, straight from the landlord, with the rent in escrow on NEAR

Handova lets a tenant rent a home directly from the landlord, with no agent. The tenant (or family abroad) pays rent and the caution fee in USDC into a NEAR smart contract. The landlord is paid only when the tenant confirms they moved in. The tenant then holds a **lease NFT that holds the caution fee**, and that fee comes back at move-out unless the landlord proves damage. People pay no gas, and they can pay from any chain through NEAR Intents.

> **The one moment:** a nurse in London pays her mum's Lagos rent from a wallet on another chain → it lands in the Handova escrow on NEAR → the landlord is paid only when mum confirms she moved in → no agent fee, no gas, and the caution fee comes back at move-out.

Built at **NEAR HACKATHON** (1–14 Nov 2026). Track: `realworld`, also `nfts`. See [Built before / during the hackathon](#built-before--during-the-hackathon).

---

## The problem

Renting in Lagos usually means paying a year of rent up front, plus agent and agreement fees on top, to people you have just met. Fake listings happen: the money is gone before anyone checks the keys work. When you leave, getting the caution (security) deposit back depends on the landlord's goodwill. Family abroad often pays the rent, and international transfers to Nigeria are slow and expensive.

## What Handova does

| Without Handova | With Handova on NEAR |
|---|---|
| Rent goes straight to the landlord or agent | Rent waits in a NEAR contract until the tenant confirms move-in |
| Agent and agreement fees | No agent. The landlord lists the home with a voice note |
| Caution deposit returned (or not) at the landlord's discretion | The tenant holds a lease NFT that holds the caution. At move-out it pays out automatically unless the landlord opens a dispute within 7 days |
| Family abroad wires money | They pay from Base, Solana, Ethereum, Arbitrum… via NEAR Intents, straight into escrow for the tenant |
| Crypto apps need gas and seed-phrase wallets | A named account (`ada.handova.near`) whose key is made on the phone; Handova's relayer pays gas |

## How NEAR is used

| Feature | NEAR technology | Where |
|---|---|---|
| Escrow that pays the landlord only after move-in; caution returned at move-out | Rust contract, near-sdk 5.30 | [`contract/src/escrow.rs`](contract/src/escrow.rs) |
| Pay rent + caution in **one transaction** | NEP-141 `ft_transfer_call` → `ft_on_transfer`; excess refunded | [`escrow.rs` `ft_on_transfer`](contract/src/escrow.rs) |
| Lease NFT that **holds** the caution fee | NEP-171 + enumeration + metadata in the same contract as the escrow. The fee belongs to whoever owns the token (`nft_token_owner`), not to a stored address | [`contract/src/nft.rs`](contract/src/nft.rs) |
| NFT that shows the live lease | Dynamic metadata: title, description, `extra` and an on-chain SVG are built from the lease state at view time | [`nft.rs` `live()`](contract/src/nft.rs), [`svg.rs`](contract/src/svg.rs) |
| No gas for users | NEP-366 meta transactions. The phone signs a delegate action; the relayer pays gas and only forwards calls to Handova's contracts | [`server/near/relayer.ts`](server/near/relayer.ts), [`shared/gasless.ts`](shared/gasless.ts) |
| Accounts for people without a wallet | Named sub-accounts `name.handova.testnet` created with the **device's own key** (the server never sees the private key); 12-word recovery phrase | [`server/near/accounts.ts`](server/near/accounts.ts), [`web/src/lib/session.tsx`](web/src/lib/session.tsx) |
| Pay from any chain | NEAR Intents 1Click: `EXACT_OUTPUT` quote → deposit on the origin chain → USDC delivered to the payer's NEAR account → gasless `ft_transfer_call` into escrow | [`server/near/intents.ts`](server/near/intents.ts), [`web/src/components/IntentsPay.tsx`](web/src/components/IntentsPay.tsx) |
| Existing NEAR wallets | NEAR Connect (`@hot-labs/near-connect`): HOT, Meteor, MyNearWallet, Intear… | [`session.tsx`](web/src/lib/session.tsx) |
| Voice note → listing draft (English, Pidgin, Yorùbá, Igbo, Hausa) | NEAR AI Cloud, private models in TEEs (`openai/whisper-large-v3`, `z-ai/glm-5.3-flash`). Every answer comes with a receipt the server checks: request/response hashes, ECDSA signature, and that the signer is in the model's attestation report | [`server/near/ai.ts`](server/near/ai.ts) |
| Ownership document pre-check for the admin (never approves) | NEAR AI Cloud vision model in a TEE (`Qwen/Qwen3-VL-30B-A3B-Instruct`) | `POST /api/ai/document-check` |
| Timeouts nobody acted on | Keeper calls the contract's "anyone may trigger" methods; it can only do what the rules already allow | [`server/near/keeper.ts`](server/near/keeper.ts) |
| Following lease events | NEP-297 `EVENT_JSON` logs for every step (`lease_paid`, `moved_in`, `lease_closed`…) | [`contract/src/events.rs`](contract/src/events.rs) |

**Why the caution lives "in" the NFT.** An NFT on NEAR can't hold tokens by itself. So one contract is both the escrow and the NEP-171 token contract. The caution stays in the contract's USDC balance, and the right to get it back is bound to `nft_token_owner(lease_id)`. Transfer the token while the lease is active (for example, a new tenant takes over the lease) and the caution right moves with it. During move-out review, a dispute, or after close, the token is locked. Once closed, it stays with the tenant as a record of a finished lease.

## Escrow rules (all enforced on-chain)

| Situation | What happens |
|---|---|
| Tenant (or anyone for them) pays | Rent + caution locked, status `Pending`. Overpayment is refunded; a bad `msg` refunds everything |
| Tenant confirms move-in | Rent credited to the landlord; lease NFT minted to the tenant, holding the caution (`Active`) |
| Landlord marked the handover, tenant silent 3 days | Anyone can trigger `claim_move_in` (same result as the tenant confirming) |
| Tenant says the handover never happened | `dispute_move_in` blocks the claim; the arbiter decides (move-in or full refund) |
| No handover within 7 days of payment | Tenant or payer cancels; the **payer** is refunded in full. The landlord can decline any time before move-in |
| Tenant moves out | 7-day landlord review (`Ending`): approve → full caution to the NFT holder; or dispute part of it |
| Landlord silent for the review window | Anyone can trigger `claim_caution`: full caution to the NFT holder |
| Dispute | Both propose the same split → settles; or the arbiter decides; nobody settles in 7 days → 50/50 |
| Payouts | Pull-based `withdraw`. If the token transfer fails, the balance is restored |

The owner can change the verifier and arbiter but **cannot move anyone's money**. There is no upgrade method. Waiting periods are fixed at deployment.

---

## Try it

### A. Check the live testnet contract (no setup)

```sh
near contract call-function as-read-only escrow.handova.testnet get_config json-args '{}' network-config testnet now
near contract call-function as-read-only escrow.handova.testnet get_lease json-args '{"lease_id":1}' network-config testnet now
near contract call-function as-read-only escrow.handova.testnet nft_token json-args '{"token_id":"1"}' network-config testnet now
```
You'll see: the 3-day/7-day rules, a lease run by the demo script (`"status": "Closed"`, `caution_to_holder: "150000000"`), and lease NFT #1 with live metadata (`"title": "Handova lease #1 · Closed"`). Explorer: https://testnet.nearblocks.io/address/escrow.handova.testnet

### B. Run the contract tests (Rust only)

Needs Rust and [cargo-near](https://github.com/near/cargo-near).
```sh
cd contract && cargo test
```
You'll see: **24 unit tests** (each escrow rule, NFT locking, the caution following the NFT, failed-withdraw restore) and **3 sandbox tests** on a real local NEAR node, using a real NEP-141 token. Those three cover the "family pays for mum" flow, NFT transfer followed by a 50/50 dispute timeout, and the check that the contract's USDC balance always equals what it owes.

### C. Your own Handova on testnet, end to end (about 3 minutes)

Needs: [Bun](https://bun.sh), [near CLI](https://github.com/near/near-cli-rs) (`near`), cargo-near. You need no keys from us.
```sh
bun install
bun run setup:testnet   # creates handova-<random>.testnet from the faucet, deploys test USDC + escrow + a relayer
bun run demo:testnet    # the whole story through the real API, on testnet
```
You'll see: three new named accounts (landlord, nurse, mum), then each step with its explorer link:
`create_listing` → nurse pays for mum with one gasless `ft_transfer_call` → `lease_paid` → handover → mum's `confirm_move_in` emits `nft_mint` + `moved_in` → landlord withdraws **1,200.00 USDC** → move-out → approve → mum withdraws **150.00 USDC**. It ends with `Lease NFT now reads: "Handova lease #1 · Closed"`. Nobody in the story pays gas.

### D. The web app

```sh
bun run server          # API on :3001 (uses .env.local from step C, or .env)
bun run dev             # web app on http://localhost:5188
```
On a phone-sized window:
1. **Get started → Create an account** → pick a name → you get `name.handova-<random>.testnet`. Your recovery phrase is under **Account**.
2. **Landlord → List a home** → type "2 bedroom flat for Yaba, prepaid meter, rent 1.8m per year, caution 200k" → **Draft with NEAR AI** (needs `NEARAI_API_KEY`) → check the fields → **Publish on NEAR — free**.
3. In another browser profile, create a second account → open the home → **Pay into escrow** → **Get 2,000 test USDC** → **Pay**. Or try **Any other chain** to see a live NEAR Intents quote. On testnet it's a preview, because Intents is mainnet-only.
4. As the landlord, open the lease → **I've handed over the keys**. As the tenant → **I have the keys — confirm move-in**. The lease NFT appears with its on-chain picture.
5. Landlord → **Account → Withdraw**.

A headless-browser run of exactly these steps (sign-up, AI draft, publish, Intents quote, pay, handover, move-in, NFT, withdraw) passes with no console errors.

---

## Architecture

```
 phone (web/)                          Handova API (server/)                    NEAR
 ───────────                           ─────────────────────                    ────
 key made on device ── public key ──▶  POST /api/accounts  ── creates ──▶  ada.handova.testnet
 signs delegate action ───────────▶    POST /api/relay (allowlist) ── pays gas ──▶  escrow.handova.testnet
 NEAR Connect wallet ── signs & pays gas itself ─────────────────────────────▶   (escrow + NEP-171 lease NFT)
                                       /api/intents/* ── 1Click ──▶ NEAR Intents ──▶ USDC to payer's account
 voice note ─────────────────────▶     /api/ai/* ── NEAR AI Cloud (TEE) + receipt check
                                       keeper ── claim_move_in / claim_caution / settle_dispute_timeout
```

| Folder | What |
|---|---|
| `contract/` | Rust escrow + lease NFT (`src/`), unit tests (`src/tests.rs`), sandbox tests (`tests/sandbox.rs`), test-only USDC (`mock-ft/`) |
| `server/near/` | NEAR API: relayer, accounts, Intents, NEAR AI, keeper, FX rate |
| `server/index.ts` | API entry point (`bun run server`) |
| `shared/` | Code used by both the browser and the server (gasless client, tx outcome parsing, units) |
| `web/` | The NEAR web app (React + Vite + Tailwind) |
| `deploy/<network>.json` | Contract IDs per network — nothing is hardcoded |
| `scripts/` | `setup-testnet.sh`, `deploy-testnet.sh`, `demo-testnet.ts` |
| `e2e/` | Playwright end-to-end suite against a testnet deployment with 20-second waiting periods |

### Security notes
- **Relayer allowlist** ([`relayer.ts`](server/near/relayer.ts), tests in `relayer.test.ts`): only function calls to the escrow (a fixed method list, zero deposit) or `ft_transfer_call` on USDC (exactly 1 yocto) whose `receiver_id` is the escrow; at most 2 actions; gas cap; per-sender and per-IP rate limits and a daily budget (`RELAYER_DAILY_TX`). The relayer is a separate low-balance account. A leaked endpoint can't make the relayer pay for anything else.
- **Keys**: user keys are generated in the browser and never leave it. Server keys (relayer, account creator, verifier) live only in `.env`, which is git-ignored.
- **Contract**: pull payments; balance restored on failed `ft_transfer`; the `total_held` invariant is checked against the real token balance in sandbox tests; minimum rent of 1 USDC limits storage spam; no upgrade method.
- **Known limits**: the contract pays storage for listings and leases so people never need NEAR. Spam is limited by the minimum rent, 50 listings per landlord, and relayer rate limits, not by deposits. The keeper and relayer are a single server. Device keys sit in browser storage, protected only by the device: back up the phrase.

---

## Built vs planned

| | Status |
|---|---|
| Rust escrow with every rule above, lease NFT holding the caution, dynamic metadata, events | ✅ built, tested (unit + sandbox), live on testnet |
| Gasless relayer (NEP-366) with allowlist | ✅ built, used by every step of the demo |
| Named accounts with device keys + recovery phrase; NEAR Connect for existing wallets | ✅ built |
| Pay from any chain (NEAR Intents 1Click) | ✅ quotes, deposit address, status polling, auto-pay into escrow. Live deposits need mainnet; on testnet the app shows a live dry quote and simulates arrival |
| NEAR AI voice note → listing, with checked TEE receipt | ✅ built |
| NEAR AI document pre-check | ✅ API built; admin screen planned |
| Timeout keeper | ✅ built |
| Mainnet deployment and a real (small) rent payment | ⏳ planned (needs the team's go-ahead and funds) |
| WhatsApp bot on NEAR AI (Arc version used Groq/OpenAI) | ⏳ planned |
| Arbiter as a Sputnik DAO; rent savings circles | ⏳ stretch |
| Inspections booking, chat, cash receipts, five-language UI (exist in the Arc app) | ⏳ not yet ported to the NEAR app |

---

## Built before / during the hackathon

Handova first existed on **Arc** (Circle's L1) as a Solidity + USDC app: [`UseHandova/Handova`](https://github.com/UseHandova/Handova), commit `16fe0e4` (21 Oct 2026). We moved to NEAR during NEAR HACKATHON. **Only the NEAR work is the hackathon entry.**

- The first commit (tag **`baseline-arc`**) imports the Arc-era code unchanged: the old web app, the old API modules, brand assets, tests and configs. It has **no NEAR code** and no Solidity. Later, the EVM/Circle parts were **deleted** (no `@circle-fin`, wagmi, viem or ConnectKit remain); only the brand assets and `server/media.ts` (photo uploads) are still used.
- Everything after it is hackathon work: the Rust contract (written from scratch, not ported), `server/near/`, `server/index.ts`, `shared/`, `web/`, `scripts/`, `deploy/`. See the diff:
  ```sh
  git diff baseline-arc..hackathon-submission --stat
  ```
  On GitHub: `compare/baseline-arc...hackathon-submission`.
- Reused from the Arc era: brand colours and logo, `server/media.ts` (photo uploads), Naira display idea, product rules (re-implemented in Rust).

### Libraries and AI-written code
- Contract: `near-sdk` 5.30, `near-contract-standards` 5.30, `base64`; tests: `near-workspaces` 0.24, `tokio`.
- Server/web: `near-api-js` 7.4, `@hot-labs/near-connect` 0.12, `borsh`, `express`, `react` 18, `vite`, `tailwindcss`, `lucide-react`, `qrcode`, `@noble/curves` + `@noble/hashes` (recover the ECDSA signer of NEAR AI receipts), `vite-plugin-node-polyfills`, `@playwright/test`.
- External services: NEAR RPC (FastNEAR), NEAR Intents 1Click API, NEAR AI Cloud, open.er-api.com (USD→NGN display rate).
- Most of the NEAR-edition code was written with **Claude Code** (Anthropic), directed and reviewed by the team.

### Other project
The team also submitted **PatchBond** (refundable bonds for pull requests), an independent project.

## License
MIT — see [LICENSE](LICENSE).
