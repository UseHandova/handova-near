#!/usr/bin/env bash
# Deploy Handova to NEAR testnet under your own account and write deploy/testnet.json.
#
#   ROOT=yourname.testnet ./scripts/deploy-testnet.sh
#
# Needs: near CLI (near-cli-rs), cargo-near, and ROOT's key in ~/.near-credentials (legacy keychain).
# ROOT needs about 9 NEAR (testnet faucet: `near account create-account sponsor-by-faucet-service ...`).
# Creates: usdc.$ROOT (open-mint test USDC), escrow.$ROOT (the Handova contract),
#          verifier.$ROOT (server key that marks verified landlords).
# Set TOKEN=3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af to use Circle's testnet USDC instead.
set -euo pipefail

ROOT="${ROOT:-handova.testnet}"
NET="network-config testnet"
SIGN="sign-with-legacy-keychain send"
ESCROW="escrow.$ROOT"
VERIFIER="verifier.$ROOT"
TOKEN="${TOKEN:-usdc.$ROOT}"
ARBITER="${ARBITER:-$ROOT}"
cd "$(dirname "$0")/.."

exists() {
  curl -s https://rpc.testnet.near.org -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" \
    | grep -q '"result"'
}

sub() { # name, NEAR amount
  if exists "$1"; then echo "• $1 exists"; return; fi
  near account create-account fund-myself "$1" "$2 NEAR" autogenerate-new-keypair save-to-legacy-keychain \
    sign-as "$ROOT" $NET $SIGN
}

call() { # contract, method, json, signer
  near contract call-function as-transaction "$1" "$2" json-args "$3" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    sign-as "$4" $NET $SIGN
}

echo "▶ Building contracts"
(cd contract && cargo near build non-reproducible-wasm)
(cd contract/mock-ft && cargo near build non-reproducible-wasm --no-abi)

if [ "$TOKEN" = "usdc.$ROOT" ]; then
  echo "▶ Test USDC at $TOKEN"
  if ! exists "$TOKEN"; then
    sub "$TOKEN" 2
    near contract deploy "$TOKEN" use-file contract/mock-ft/target/near/mock_ft.wasm \
      with-init-call new json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' $NET $SIGN
  fi
fi

echo "▶ Accounts"
sub "$VERIFIER" 0.5
sub "$ESCROW" 5

echo "▶ Deploying Handova to $ESCROW"
near contract deploy "$ESCROW" use-file contract/target/near/handova.wasm \
  with-init-call new json-args "{\"owner\":\"$ROOT\",\"verifier\":\"$VERIFIER\",\"arbiter\":\"$ARBITER\",\"token\":\"$TOKEN\"}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' $NET $SIGN

echo "▶ Registering the escrow with the token"
if [ "$TOKEN" = "usdc.$ROOT" ]; then
  call "$TOKEN" mint "{\"account_id\":\"$ESCROW\",\"amount\":\"0\"}" "$ROOT"
else
  near contract call-function as-transaction "$TOKEN" storage_deposit json-args "{\"account_id\":\"$ESCROW\"}" \
    prepaid-gas '30 Tgas' attached-deposit '0.0125 NEAR' sign-as "$ROOT" $NET $SIGN
fi

cat > deploy/testnet.json <<JSON
{
  "network": "testnet",
  "rpc": "https://test.rpc.fastnear.com",
  "explorer": "https://testnet.nearblocks.io",
  "escrow": "$ESCROW",
  "token": "$TOKEN",
  "tokenDecimals": 6,
  "tokenOpenMint": $([ "$TOKEN" = "usdc.$ROOT" ] && echo true || echo false),
  "accountParent": "$ROOT",
  "verifier": "$VERIFIER",
  "arbiter": "$ARBITER"
}
JSON
echo "✔ Done. deploy/testnet.json:"
cat deploy/testnet.json
