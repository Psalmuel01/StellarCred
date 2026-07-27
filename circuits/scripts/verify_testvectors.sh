#!/usr/bin/env bash
# Verify that current circuit outputs match committed test vectors
# This catches regressions from circuit changes or toolchain updates

set -euo pipefail

NOIR_VERSION="1.0.0-beta.9"
BB_VERSION="0.87.0"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTVECTORS_DIR="$ROOT/testvectors"

export PATH="$HOME/.nargo/bin:$HOME/.bb/bin:$PATH"

VERBOSE=false
if [ "${1:-}" = "-v" ] || [ "${1:-}" = "--verbose" ]; then
  VERBOSE=true
fi

failures=0
successes=0

# Check for required tools
command -v nargo >/dev/null || {
  echo "Error: nargo not found. Please install: noirup -v $NOIR_VERSION"
  exit 1
}
command -v bb >/dev/null || {
  echo "Error: bb not found. Please install: bbup -v $BB_VERSION"
  exit 1
}
command -v jq >/dev/null || {
  echo "Error: jq not found. Please install jq for JSON parsing"
  exit 1
}

verify_test_vector() {
  local circuit_name="$1"
  local circuit_dir="$ROOT/$circuit_name"
  local vector_path="$TESTVECTORS_DIR/${circuit_name}.json"
  
  [ -f "$vector_path" ] || {
    echo "Warning: No test vector found for $circuit_name"
    return
  }
  
  [ -f "$circuit_dir/Nargo.toml" ] || {
    echo "Skipping $circuit_name (no circuit found)"
    return
  }
  
  [ -f "$circuit_dir/Prover.toml" ] || {
    echo "Skipping $circuit_name (no Prover.toml)"
    return
  }
  
  echo ""
  echo "=== Verifying $circuit_name ==="
  
  pushd "$circuit_dir" >/dev/null
  
  # Clean previous builds
  rm -rf target
  
  # Compile circuit
  [ "$VERBOSE" = true ] && echo "  Compiling..."
  nargo compile >/dev/null 2>&1
  
  local bytecode="target/${circuit_name}.json"
  local witness_gz="target/${circuit_name}.gz"
  
  # Generate witness
  [ "$VERBOSE" = true ] && echo "  Generating witness..."
  nargo execute >/dev/null 2>&1
  
  # Generate VK
  [ "$VERBOSE" = true ] && echo "  Generating VK..."
  bb write_vk --scheme ultra_honk --oracle_hash keccak \
    --bytecode_path "$bytecode" \
    --output_path target --output_format bytes_and_fields >/dev/null 2>&1
  
  # Normalize VK path
  [ -f target/vk/vk ] && mv target/vk/vk target/vk.tmp && rmdir target/vk && mv target/vk.tmp target/vk || true
  
  # Generate proof and public inputs
  [ "$VERBOSE" = true ] && echo "  Generating proof..."
  bb prove --scheme ultra_honk --oracle_hash keccak \
    --bytecode_path "$bytecode" \
    --witness_path "$witness_gz" \
    --output_path target --output_format bytes_and_fields >/dev/null 2>&1
  
  # Read actual values
  local actual_vk_hash
  actual_vk_hash=$(sha256sum target/vk | awk '{print $1}')
  
  local actual_public_inputs
  actual_public_inputs=$(jq -R . < target/public_inputs | jq -s .)
  
  # Load expected values
  local expected_vk_hash
  expected_vk_hash=$(jq -r '.expected_vk_hash' < "$vector_path")
  
  local expected_public_inputs
  expected_public_inputs=$(jq '.expected_public_inputs' < "$vector_path")
  
  # Compare results
  local vk_match=true
  local inputs_match=true
  
  if [ "$expected_vk_hash" != "$actual_vk_hash" ]; then
    vk_match=false
  fi
  
  if [ "$expected_public_inputs" != "$actual_public_inputs" ]; then
    inputs_match=false
  fi
  
  if [ "$vk_match" = true ] && [ "$inputs_match" = true ]; then
    echo "✓ PASS: $circuit_name"
    ((successes++))
  else
    echo "✗ FAIL: $circuit_name"
    ((failures++))
    
    if [ "$vk_match" = false ]; then
      echo "  VK hash mismatch:"
      echo "    Expected: $expected_vk_hash"
      echo "    Actual:   $actual_vk_hash"
    fi
    
    if [ "$inputs_match" = false ]; then
      echo "  Public inputs mismatch:"
      echo "    Expected: $(echo "$expected_public_inputs" | jq 'length') values"
      echo "    Actual:   $(echo "$actual_public_inputs" | jq 'length') values"
      
      if [ "$VERBOSE" = true ]; then
        echo "    Expected values:"
        echo "$expected_public_inputs" | jq -r '.[]' | sed 's/^/      /'
        echo "    Actual values:"
        echo "$actual_public_inputs" | jq -r '.[]' | sed 's/^/      /'
      fi
    fi
  fi
  
  popd >/dev/null
}

# Header
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║          StellarCred Test Vector Verification                 ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Toolchain: Noir $NOIR_VERSION, BB $BB_VERSION"
echo ""

# Default circuits
CIRCUITS=(
  "kyc_proof"
  "age_proof"
  "income_proof"
  "jurisdiction_proof"
  "funds_proof"
  "accreditation_proof"
)

# Verify each circuit
for circuit in "${CIRCUITS[@]}"; do
  verify_test_vector "$circuit"
done

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "SUMMARY"
echo "═══════════════════════════════════════════════════════════════"
echo "Passed: $successes"
echo "Failed: $failures"

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "This indicates that circuit output has changed!"
  echo ""
  echo "Possible causes:"
  echo "  1. Circuit logic was modified (check git diff)"
  echo "  2. Toolchain version changed (check nargo/bb versions)"
  echo "  3. Dependencies were updated"
  echo ""
  echo "If the change is intentional:"
  echo "  1. Review the changes carefully"
  echo "  2. Regenerate test vectors: ./scripts/generate_testvectors.sh"
  echo "  3. Update deployed contracts if VK changed"
  echo "  4. Commit the new test vectors"
  echo ""
  echo "Current toolchain: Noir $NOIR_VERSION, BB $BB_VERSION"
  
  exit 1
fi

echo ""
echo "All test vectors verified successfully! ✓"
exit 0
