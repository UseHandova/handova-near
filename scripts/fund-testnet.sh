#!/usr/bin/env bash
# Top up a Handova testnet account (the "treasury") from NEAR's testnet faucet, until it holds TARGET NEAR.
# Each round creates a throwaway account funded by the faucet, then deletes it with the treasury as
# beneficiary, so its NEAR moves to the treasury. Testnet only: these tokens have no value.
#
#   ./scripts/fund-testnet.sh                       # handova.testnet up to 50 NEAR
#   TREASURY=handova-relayer.testnet TARGET=20 ./scripts/fund-testnet.sh
#
# Needs near CLI (near-cli-rs). The faucet rate-limits; the script stops after MAX_ROUNDS.
set -euo pipefail

TREASURY="${TREASURY:-handova.testnet}"
TARGET="${TARGET:-50}"
MAX_ROUNDS="${MAX_ROUNDS:-12}"
NET="network-config testnet"

balance() { # whole NEAR, rounded down
  curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$TREASURY\"}}" \
    | python3 -c "import sys,json; print(int(json.load(sys.stdin)['result']['amount']) // 10**24)"
}

echo "▶ $TREASURY has $(balance) NEAR; target $TARGET"
for i in $(seq 1 "$MAX_ROUNDS"); do
  [ "$(balance)" -ge "$TARGET" ] && break
  a="handova-f$i-$(date +%s).testnet"
  if ! near account create-account sponsor-by-faucet-service "$a" autogenerate-new-keypair \
      --signature-scheme ed25519 save-to-legacy-keychain $NET create; then
    echo "  faucet refused round $i (rate limit?); try again later"; break
  fi
  sleep 3
  near account delete-account "$a" beneficiary "$TREASURY" $NET sign-with-legacy-keychain send
  echo "  round $i: $TREASURY now has $(balance) NEAR"
done
echo "✔ $TREASURY has $(balance) NEAR"
