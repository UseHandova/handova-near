# Reproduce Handova on NEAR testnet

Run Handova end to end on your own testnet accounts. Every step says what to run and what you should see. You need no keys from the Handova team, and no Twilio, Didit, Dojah or NEAR AI.

## 0. Tools
- Rust + [cargo-near](https://github.com/near/cargo-near) (`cargo near --version` → 0.22+)
- [near CLI](https://github.com/near/near-cli-rs) (`near --version` → near-cli-rs 0.30+)
- [Bun](https://bun.sh) 1.3+

## 1. Contract tests
```sh
cd contract
cargo test --lib          # about 15 minutes the first time (compiling), seconds after
cargo test --test sandbox # 2 to 7 minutes; prints nothing while the local node runs
```
Expect `test result: ok. 57 passed` (unit), then `test result: ok. 7 passed` (sandbox: a local NEAR node with a real NEP-141 token). Plain `cargo test` runs both.

The first build downloads a NEAR sandbox binary. If it stops with `failed to run custom build command for near-workspaces`, run the command again (this happened once in two clean builds).

## 2. Your own deployment (about 2 minutes)
```sh
bun install
bun run setup:testnet
```
Expect: `New account <handova-xxxxxxxx.testnet> created`, two `Contract code has been successfully deployed.` lines, then
```
✔ Your Handova is live on testnet:
    escrow  escrow.handova-xxxxxxxx.testnet
    token   usdc.handova-xxxxxxxx.testnet (anyone can mint — test money)
```
This writes `deploy/testnet.local.json` and `.env.local`. Both are git-ignored, and they point the server at your copy.

## 3. The whole story, end to end (about 1 minute)
```sh
bun run demo:testnet
```
Expect, with an explorer link after each ✓:
```
1) Accounts
  ✓ landlord-….handova-xxxxxxxx.testnet created
  ✓ nurse-….handova-xxxxxxxx.testnet created
  ✓ mum-….handova-xxxxxxxx.testnet created
  ✓ nurse-… got 2,000 test USDC
2) Landlord lists a 2-bed in Yaba: 1,200 USDC rent + 150 USDC caution, 12 months
  ✓ create_listing (signed by the landlord, 0.06 NEAR refundable deposit) [listing_created]
3) The nurse pays for mum from abroad (listing #1)
  ✓ ft_transfer_call → escrow (gasless) [lease_paid]
  → lease #1 Pending; 1,350.00 USDC held in escrow
4) Handover and move-in
  ✓ landlord mark_handover (gasless) [handover_marked]
  ✓ mum confirm_move_in (gasless) [nft_mint, moved_in]
  → lease NFT #1 owned by mum-…: "Handova lease #1 · Active"
    <the NFT's description>
5) Landlord withdraws the rent
  ✓ landlord withdraw (gasless) [withdrawn]
  → landlord USDC: 1,200.00 (no agent fee)
6) Move-out and caution refund
  ✓ mum move_out (gasless) [move_out_started]
  ✓ landlord approve_move_out (gasless) [lease_closed]
  ✓ mum withdraw (gasless) [withdrawn]
  → mum USDC: 150.00 — caution returned to the NFT holder
✔ Done. Lease NFT now reads: "Handova lease #1 · Closed"
  Gas: the relayer paid all of it. The nurse's NEAR balance changed by 0 yoctoNEAR.
  Lease: near contract call-function as-read-only … get_lease …
```
The landlord is the only one who spends NEAR: the listing's deposit (0.06 NEAR, kept as storage credit and returned by `remove_listing`) and a tiny fee, from the 0.15 NEAR the server gives a new landlord account. Everything else goes through the relayer.

## 4. Check it on-chain yourself
For Handova's own deployment (`escrow-v5.handova.testnet`), `bun run verify:live` checks every on-chain claim in the README in a few seconds: code hash, no keys, council and owner, balances, and leases #1, #3, #4 and #5. For your own deployment:
```sh
near contract call-function as-read-only escrow.handova-xxxxxxxx.testnet get_lease json-args '{"lease_id":1}' network-config testnet now
near contract call-function as-read-only escrow.handova-xxxxxxxx.testnet nft_token json-args '{"token_id":"1"}' network-config testnet now
```
Expect `"status": "Closed"`, `"caution_to_holder": "150000000"`, and the NFT's `metadata.title` `"Handova lease #1 · Closed"`.

## 5. Web app (optional)
```sh
bun run server    # :3001
bun run dev       # http://localhost:5188
```
See the README, section "D. The web app", for the click path.

## Server tests
```sh
bun run test:near
```
Expect `32 pass`: the relayer allowlist (refuses other contracts, other methods, NEAR deposits, token transfers not going to the escrow, bad signatures, too much gas), the keeper's timeout rules, the Intents quote shape, and NEAR AI receipt signature recovery (checked against a real saved receipt — no API key needed).

## End-to-end suite (optional, about 30 minutes)
```sh
bun run setup:e2e
bunx playwright install chromium
bun run test:e2e
```
Expect `30 passed`. Without `NEARAI_API_KEY` (with credit) in `.env.e2e`, the 2 NEAR AI tests are skipped, so expect `28 passed, 2 skipped`. Public-RPC rate limits can make a test pass only on Playwright's retry, reported as flaky. The suite creates many throwaway accounts: if a run fails with *New accounts are paused … needs a NEAR top-up*, refill your root account from the testnet faucet with `TREASURY=<your root account> TARGET=30 ./scripts/fund-testnet.sh` and run it again. Each test drives a phone-sized browser through the web app against your own testnet deployment with 20-second waiting periods, and checks balances on-chain.
