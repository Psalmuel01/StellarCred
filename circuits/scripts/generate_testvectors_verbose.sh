#!/usr/bin/env bash
# Verbose test vector generation to see all output

set -euo pipefail

NOIR_VERSION="1.0.0-beta.9"
BB_VERSION="0.87.0"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTVECTORS_DIR="$ROOT/testvectors"

export PATH="$HOME/.nargo/bin:$HOME/.bb/bin:$PATH"

echo "Root directory: $ROOT"
echo "Test vectors directory: $TESTVECTORS_DIR"
echo ""

mkdir -p "$TESTVECTORS_DIR"

echo "=== Generating test vector for kyc_proof (VERBOSE) ==="
echo ""

cd "$ROOT/kyc_proof"

echo "Current directory: $(pwd)"
echo ""

echo "Step 1: Cleaning target..."
rm -rf target
echo "Done"
echo ""

echo "Step 2: Compiling circuit..."
nargo compile
echo "Compilation done"
echo ""

echo "Step 3: Checking bytecode file..."
ls -lh target/
echo ""

echo "Step 4: Generating VK..."
bb write_vk --scheme ultra_honk --oracle_hash keccak \
  --bytecode_path target/kyc_proof.json \
  --output_path target --output_format bytes_and_fields
echo "VK generation done"
echo ""

echo "Step 5: Checking VK file..."
if [ -f target/vk/vk ]; then
    echo "Found target/vk/vk, moving..."
    mv target/vk/vk target/vk.tmp
    rmdir target/vk
    mv target/vk.tmp target/vk
fi
ls -lh target/vk
echo ""

echo "Step 6: Hashing VK..."
vk_hash=$(sha256sum target/vk | awk '{print $1}')
echo "VK hash: $vk_hash"
echo ""

echo "Step 7: Generating witness..."
nargo execute
echo "Witness done"
echo ""

echo "Step 8: Checking Prover.toml..."
cat Prover.toml
echo ""

echo "Step 9: Creating test vector JSON..."
cat > "$TESTVECTORS_DIR/kyc_proof.json" <<EOF
{
  "circuit_name": "kyc_proof",
  "toolchain_version": "$NOIR_VERSION",
  "bb_version": "$BB_VERSION",
  "expected_vk_hash": "$vk_hash",
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "Done! File created at: $TESTVECTORS_DIR/kyc_proof.json"
cat "$TESTVECTORS_DIR/kyc_proof.json"
