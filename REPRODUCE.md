# Reproduce Handova on NEAR testnet

Run Handova end to end on your own testnet accounts. Every step says what to run and what you should see. You need no keys from the Handova team, and no Twilio, Didit, Dojah or NEAR AI.

## 0. Tools
- Rust + [cargo-near](https://github.com/near/cargo-near) (`cargo near --version` → 0.22+)
- [near CLI](https://github.com/near/near-cli-rs) (`near --version` → near-cli-rs 0.30+)
- [Bun](https://bun.sh) 1.3+

## 1. Contract tests (about 15 minutes the first time, 2 minutes after)
```sh
cd contract && cargo test
```
Expect `test result: ok. 42 passed` (unit) and `test result: ok. 3 passed` (sandbox: a local NEAR node with a real NEP-141 token).

The first build downloads a NEAR sandbox binary. If it stops with `failed to run custom build command for near-workspaces`, run `cargo test` again (this happened once in two clean builds).

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
  ✓ create_listing (gasless) [listing_created]
3) The nurse pays for mum from abroad (listing #1)
  ✓ ft_transfer_call → escrow (gasless) [lease_paid]
  → lease #1 Pending; 1,350.00 USDC held in escrow
4) Handover and move-in
  ✓ landlord mark_handover (gasless) [handover_marked]
  ✓ mum confirm_move_in (gasless) [nft_mint, moved_in]
  → lease NFT #1 owned by mum-…: "Handova lease #1 · Active"
5) Landlord withdraws the rent
  ✓ landlord withdraw (gasless) [withdrawn]
  → landlord USDC: 1,200.00 (no agent fee)
6) Move-out and caution refund
  ✓ mum move_out (gasless) [move_out_started]
  ✓ landlord approve_move_out (gasless) [lease_closed]
  ✓ mum withdraw (gasless) [withdrawn]
  → mum USDC: 150.00 — caution returned to the NFT holder
✔ Done. Lease NFT now reads: "Handova lease #1 · Closed"
```

## 4. Check it on-chain yourself
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
Expect `17 pass` (6 files): the relayer allowlist (refuses other contracts, other methods, NEAR deposits, token transfers not going to the escrow, bad signatures, too much gas), the keeper's timeout rules, the Intents quote shape, and NEAR AI receipt signature recovery (checked against a real saved receipt — no API key needed).

## End-to-end suite (optional, about 25 minutes)
```sh
bun run setup:e2e
bunx playwright install chromium
bun run test:e2e
```
Expect `29 passed`. Without `NEARAI_API_KEY` (with credit) in `.env.e2e`, the 2 NEAR AI tests are skipped, so expect `27 passed, 2 skipped`. Public-RPC rate limits can make a test pass only on Playwright's retry, reported as flaky. The suite creates many throwaway accounts: if a run fails with *New accounts are paused … needs a NEAR top-up*, refill your root account from the testnet faucet with `TREASURY=<your root account> TARGET=30 ./scripts/fund-testnet.sh` and run it again. Each test drives a phone-sized browser through the web app against your own testnet deployment with 20-second waiting periods, and checks balances on-chain.
