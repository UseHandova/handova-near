#!/usr/bin/env bash
# Your own Handova on NEAR testnet in one command — no keys from us needed.
#
#   ./scripts/setup-testnet.sh        then   bun run demo   (or: bun run server & bun run dev)
#
# 1. Creates a fresh account handova-<random>.testnet from the testnet faucet (free, 10 NEAR).
# 2. Deploys the test USDC and the Handova escrow under it (scripts/deploy-testnet.sh).
# 3. Creates a relayer sub-account that pays users' gas.
# 4. Writes deploy/testnet.local.json and .env.local (both git-ignored). Bun loads .env.local.
#
# Needs: near CLI (near-cli-rs), cargo-near, bun. Keys go to ~/.near-credentials/testnet.
set -euo pipefail
cd "$(dirname "$0")/.."

ROOT="${ROOT:-handova-$(openssl rand -hex 4).testnet}"
NET="network-config testnet"
CREDS="$HOME/.near-credentials/testnet"
OUT="${OUT:-deploy/testnet.local.json}"
ENV_OUT="${ENV_OUT:-.env.local}"

echo "▶ Creating $ROOT from the testnet faucet"
near account create-account sponsor-by-faucet-service "$ROOT" autogenerate-new-keypair save-to-legacy-keychain $NET create

echo "▶ Deploying contracts"
ROOT="$ROOT" OUT="$OUT" ./scripts/deploy-testnet.sh

RELAYER="relayer.$ROOT"
echo "▶ Creating the relayer $RELAYER"
near account create-account fund-myself "$RELAYER" '1 NEAR' autogenerate-new-keypair save-to-legacy-keychain \
  sign-as "$ROOT" $NET sign-with-legacy-keychain send

key() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['private_key'])" "$CREDS/$1.json"; }
{
  echo "NEAR_NETWORK=testnet"
  echo "RELAYER_ACCOUNT_ID=$RELAYER"
  echo "RELAYER_PRIVATE_KEY=$(key "$RELAYER")"
  echo "CREATOR_ACCOUNT_ID=$ROOT"
  echo "CREATOR_PRIVATE_KEY=$(key "$ROOT")"
  echo "VERIFIER_ACCOUNT_ID=verifier.$ROOT"
  echo "VERIFIER_NEAR_PRIVATE_KEY=$(key "verifier.$ROOT")"
  echo "ADMIN_SECRET=$(openssl rand -hex 16)"
  echo "# Optional: NEAR AI Cloud key for voice-note listings (https://cloud.near.ai)"
  echo "NEARAI_API_KEY=${NEARAI_API_KEY:-}"
} > "$ENV_OUT"
chmod 600 "$ENV_OUT"

echo
echo "✔ Your Handova is live on testnet:"
echo "    escrow  escrow.$ROOT"
echo "    token   usdc.$ROOT (anyone can mint — test money)"
echo "  Next:  bun run demo                      # the whole story in the terminal"
echo "         bun run server & bun run dev      # the web app at http://localhost:5188"
