#!/usr/bin/env bash
# demo.sh — End-to-end StellarCred demo on testnet
# ==================================================
#
# Seeds a fresh testnet wallet, issues KYC + age + funds credentials in mock
# mode (no real KYC provider), generates UltraHonk proofs, submits them to the
# ProofRegistry, and prints the verified claims table — all in one command.
#
# Prerequisites (one-time):
#   brew install stellar-cli            # or your package manager
#   rustup target add wasm32v1-none
#   noirup -v 1.0.0-beta.9              # nargo
#   bbup -v 0.87.0                      # bb (Barretenberg)
#   cd frontend && pnpm install         # Node deps for credential issuance + witness gen
#
#   # Deploy contracts first (only needed once per testnet reset):
#   ISSUER_PRIVATE_KEY=<demo-key-hex> SOURCE=deployer ./scripts/deploy.sh
#
# Usage:
#   ./scripts/demo.sh
#
# The script is idempotent — re-running creates a fresh wallet and re-proves.
# Fails with a clear message if prerequisites or contract IDs are missing.
# ==================================================

set -euo pipefail

# ---- Colors ----
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

banner()  { echo -e "\n${BLUE}${BOLD}===${NC} ${BOLD}$1${NC}"; }
ok()      { echo -e "  ${GREEN}✓${NC} $1"; }
info()    { echo -e "  ${BLUE}→${NC} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail()    { echo -e "${RED}${BOLD}Error:${NC} $1" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- Prerequisites ----
banner "Checking prerequisites"

command -v stellar  >/dev/null || fail "stellar CLI not found — install: brew install stellar-cli"
ok "stellar CLI: $(stellar --version 2>&1 | head -1)"

command -v node     >/dev/null || fail "node not found — install Node.js 20+"
ok "node:     $(node --version)"

command -v bb       >/dev/null || fail "bb not found — run: bbup -v 0.87.0"
ok "bb:       $(bb --version 2>&1 | head -1)"

# Check that frontend deps are installed (needed for noir_js, noble/curves, etc.)
[ -d "$ROOT/frontend/node_modules/@noir-lang/noir_js" ] || \
  fail "@noir-lang/noir_js not found — run: cd frontend && pnpm install"
ok "noir_js installed"

for circuit in kyc age funds; do
  [ -f "$ROOT/frontend/public/circuits/${circuit}.json" ] || \
    fail "Circuit ${circuit}.json not found — run: ./circuits/scripts/build.sh"
done
ok "Circuit JSONs present"

# ---- Configuration ----
banner "Configuration"

NETWORK="${STELLAR_NETWORK:-testnet}"
RPC_URL="${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}"

# Contract IDs — read from the env (set by deploy.sh) or from .env files.
export NEXT_PUBLIC_PROOF_REGISTRY_ID="${NEXT_PUBLIC_PROOF_REGISTRY_ID:-}"
export NEXT_PUBLIC_ISSUER_REGISTRY_ID="${NEXT_PUBLIC_ISSUER_REGISTRY_ID:-}"
export NEXT_PUBLIC_CREDENTIAL_VERIFIER_ID="${NEXT_PUBLIC_CREDENTIAL_VERIFIER_ID:-}"

# Try sourcing .env.local if vars aren't already set
if [ -z "$NEXT_PUBLIC_PROOF_REGISTRY_ID" ] && [ -f "$ROOT/frontend/.env.local" ]; then
  set -a; source "$ROOT/frontend/.env.local"; set +a
fi

: "${NEXT_PUBLIC_PROOF_REGISTRY_ID:?Set NEXT_PUBLIC_PROOF_REGISTRY_ID (run deploy.sh first or set in frontend/.env.local)}"
: "${NEXT_PUBLIC_ISSUER_REGISTRY_ID:?Set NEXT_PUBLIC_ISSUER_REGISTRY_ID}"
: "${NEXT_PUBLIC_CREDENTIAL_VERIFIER_ID:?Set NEXT_PUBLIC_CREDENTIAL_VERIFIER_ID}"
: "${NEXT_PUBLIC_ISSUER_ADDRESS:?Set NEXT_PUBLIC_ISSUER_ADDRESS (run deploy.sh first or set in frontend/.env.local)}"

ok "ProofRegistry:       ${NEXT_PUBLIC_PROOF_REGISTRY_ID}"
ok "IssuerRegistry:      ${NEXT_PUBLIC_ISSUER_REGISTRY_ID}"
ok "CredentialVerifier:  ${NEXT_PUBLIC_CREDENTIAL_VERIFIER_ID}"
ok "Issuer (deployed):   ${NEXT_PUBLIC_ISSUER_ADDRESS}"

# ---- Step 1: Create and fund a fresh testnet wallet ----
banner "Creating demo wallet"

DEMO_NAME="stcreddemo-$(date +%s)"
info "Generating key and funding via friendbot..."
if ! stellar keys generate --global "$DEMO_NAME" --network "$NETWORK" --fund 2>/dev/null; then
  fail "Failed to create/fund wallet. Check that stellar CLI is configured for testnet and friendbot is reachable."
fi
DEMO_ADDRESS="$(stellar keys address "$DEMO_NAME")"

# Wait for friendbot funding to propagate
sleep 5
ok "Wallet:  $DEMO_ADDRESS"

# ---- Step 2: Issue mock credentials ----
banner "Issuing mock credentials (KYC + age + funds)"

info "Running demo-issue.mjs (issuer: $NEXT_PUBLIC_ISSUER_ADDRESS)..."
CREDS_JSON="$TMP/credentials.json"
node "$ROOT/scripts/demo-issue.mjs" "$DEMO_ADDRESS" "$NEXT_PUBLIC_ISSUER_ADDRESS" kyc age funds > "$CREDS_JSON" 2>"$TMP/issue.log"

ISSUER_PUBKEY_HEX="$(grep 'Issuer public key' "$TMP/issue.log" | sed 's/.*: //')"
ok "Issuer pubkey: ${ISSUER_PUBKEY_HEX:0:16}..."

CRED_COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CREDS_JSON','utf-8')).length)")
ok "Issued $CRED_COUNT mock credentials (kyc, age, funds)"

# ---- Step 3: Generate witnesses and proofs ----
banner "Generating UltraHonk proofs"

prove_one() {
  local type="$1"
  local witness_gz="$TMP/${type}.gz"

  info "  [$type] Generating witness via demo-witness.mjs..."
  node "$ROOT/scripts/demo-witness.mjs" "$CREDS_JSON" "$type" "$witness_gz" 2>&1 || \
    fail "Witness generation failed for $type"

  info "  [$type] Proving with bb..."
  bb prove --scheme ultra_honk --oracle_hash keccak \
    --bytecode_path "$ROOT/frontend/public/circuits/${type}.json" \
    --witness_path "$witness_gz" \
    --output_path "$TMP/${type}" --output_format bytes_and_fields 2>&1 || \
    fail "Proof generation failed for $type"

  ok "  [$type] Proof generated ($(wc -c < "$TMP/${type}/proof") bytes)"
}

prove_one "kyc"
prove_one "age"
prove_one "funds"

# ---- Step 4: Verify issuer pubkey matches the demo key ----
banner "Verifying issuer registration"

# Query the on-chain pubkey for the deployed issuer and compare with the demo key.
ONCHAIN_PUBKEY=$(stellar contract invoke \
  --id "$NEXT_PUBLIC_ISSUER_REGISTRY_ID" \
  --source "$DEMO_NAME" \
  --network "$NETWORK" \
  -- \
  get_issuer_pubkey \
  --issuer_id "$NEXT_PUBLIC_ISSUER_ADDRESS" 2>&1) || true

# The demo key hex is printed to stderr by demo-issue.mjs
DEMO_PUBKEY_HEX_LOWER=$(echo "$ISSUER_PUBKEY_HEX" | tr '[:upper:]' '[:lower:]')
if echo "$ONCHAIN_PUBKEY" | grep -qi "$DEMO_PUBKEY_HEX_LOWER"; then
  ok "Issuer pubkey matches demo key — proofs will be accepted"
else
  warn "Issuer pubkey may not match the demo key."
  warn "This means submit_proof will likely fail with IssuerKeyMismatch."
  warn "To fix: re-run deploy.sh with the demo key:"
  warn "  DEMO_SK_HEX=\$(node -e \"const{sha256}=require('@noble/hashes/sha2');console.log(Buffer.from(sha256(new TextEncoder().encode('stellarcred-demo-issuer'))).toString('hex'))\")"
  warn "  ISSUER_PRIVATE_KEY=\$DEMO_SK_HEX SOURCE=deployer ./scripts/deploy.sh"
fi

# ---- Step 5: Submit proofs to ProofRegistry ----
banner "Submitting proofs to ProofRegistry"

# Determine expiry (90 days from now in seconds since epoch)
EXPIRY=$(($(date +%s) + 90 * 86400))

submit_one() {
  local type="$1"
  local proof_hex
  local pi_hex
  proof_hex="$(xxd -p -c0 "$TMP/${type}/proof" | tr -d '\n')"
  pi_hex="$(xxd -p -c0 "$TMP/${type}/public_inputs" | tr -d '\n')"

  info "  [$type] Submitting proof (${#proof_hex} hex chars)..."
  stellar contract invoke \
    --id "$NEXT_PUBLIC_PROOF_REGISTRY_ID" \
    --source "$DEMO_NAME" \
    --network "$NETWORK" \
    --send yes \
    -- \
    submit_proof \
    --holder "$DEMO_ADDRESS" \
    --issuer_id "$NEXT_PUBLIC_ISSUER_ADDRESS" \
    --credential_type "$type" \
    --proof "$proof_hex" \
    --public_inputs "$pi_hex" \
    --expiry "$EXPIRY" 2>&1 | tail -3

  ok "  [$type] Submitted"
}

submit_one "kyc"
submit_one "age"
submit_one "funds"

# ---- Step 6: Query and print verified claims ----
banner "Verified claims"

echo ""
printf "  ${BOLD}%-20s %-10s %s${NC}\n" "Credential" "Verified" "Details"
printf "  %-20s %-10s %s\n" "--------------------" "----------" "-------"

query_one() {
  local type="$1"
  local label="$2"

  # is_verified returns (bool, u64, u64). We use a small Node.js helper to
  # parse the SCVal output reliably.
  local result
  result=$(stellar contract invoke \
    --id "$NEXT_PUBLIC_PROOF_REGISTRY_ID" \
    --source "$DEMO_NAME" \
    --network "$NETWORK" \
    -- \
    is_verified \
    --holder "$DEMO_ADDRESS" \
    --credential_type "$type" 2>&1) || true

  # Parse the XDR/JSON output — stellar CLI v26+ returns SCVal as JSON-like text.
  # Look for patterns like "[true," or "Bool(True)" in the output.
  if echo "$result" | grep -qiE '"True"|Bool\(True\)|^true|:\s*true'; then
    printf "  ${BOLD}%-20s${NC} ${GREEN}%-10s${NC} %s\n" "$label" "✅ Yes" "Proof accepted on-chain"
  elif echo "$result" | grep -qiE '"False"|Bool\(False\)|^false|:\s*false'; then
    printf "  ${BOLD}%-20s${NC} ${RED}%-10s${NC} %s\n" "$label" "❌ No"  "Verification failed"
  else
    # Couldn't parse — show raw status
    printf "  ${BOLD}%-20s${NC} ${YELLOW}%-10s${NC} %s\n" "$label" "?" "Could not parse output"
  fi
}

query_one "kyc" "KYC"
query_one "age" "Age"
query_one "funds" "Funds"

echo ""

# ---- Summary ----
banner "Demo complete!"
echo ""
echo -e "  ${GREEN}Wallet:${NC}  $DEMO_ADDRESS"
echo -e "  ${GREEN}Network:${NC} $NETWORK"
echo ""
echo -e "  View claims on-chain:"
echo -e "  ${BLUE}stellar contract invoke \\"
echo -e "    --id $NEXT_PUBLIC_PROOF_REGISTRY_ID \\"
echo -e "    --network $NETWORK \\"
echo -e "    -- is_verified --holder $DEMO_ADDRESS --credential_type kyc${NC}"
echo ""
echo -e "  ${BOLD}Credential data (preimages, signatures, commitments)${NC}"
echo -e "  ${BOLD}saved to:${NC} $CREDS_JSON"
echo ""
echo -e "  ${GREEN}Try the full app:${NC} cd frontend && pnpm dev"
echo ""
