#!/usr/bin/env bash
# Generate deterministic test vectors for all StellarCred circuits
# This script compiles circuits, generates proofs, and captures expected outputs
# Test vectors are used to detect regressions in circuit logic or toolchain changes

set -euo pipefail

NOIR_VERSION="1.0.0-beta.9"
BB_VERSION="0.87.0"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTVECTORS_DIR="$ROOT/testvectors"

export PATH="$HOME/.nargo/bin:$HOME/.bb/bin:$PATH"

# Check for required tools
echo "Checking toolchain..."
command -v nargo >/dev/null || {
  echo "Error: nargo not found. Please install: noirup -v $NOIR_VERSION"
  exit 1
}
command -v bb >/dev/null || {
  echo "Error: bb not found. Please install: bbup -v $BB_VERSION"
  exit 1
}

echo "Found: $(nargo --version)"
echo "Found: $(bb --version)"

# Ensure test vectors directory exists
mkdir -p "$TESTVECTORS_DIR"

# Parse TOML to JSON (simple key-value parser)
parse_prover_toml() {
  local toml_file="$1"
  local json="{"
  local first=true
  
  while IFS='=' read -r key value; do
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    
    # Skip empty lines and comments
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    
    # Add comma for non-first items
    [ "$first" = true ] && first=false || json+=","
    
    # Handle arrays vs strings
    if [[ "$value" =~ ^\[.*\]$ ]]; then
      json+="\"$key\":$value"
    else
      json+="\"$key\":$value"
    fi
  done < "$toml_file"
  
  json+="}"
  echo "$json"
}

generate_test_vector() {
  local circuit_name="$1"
  local circuit_dir="$ROOT/$circuit_name"
  local prover_toml="$circuit_dir/Prover.toml"
  
  [ -f "$circuit_dir/Nargo.toml" ] || {
    echo "Skipping $circuit_name (no Nargo.toml)"
    return
  }
  
  [ -f "$prover_toml" ] || {
    echo "Warning: Skipping $circuit_name (no Prover.toml - cannot generate proof)"
    return
  }
  
  echo ""
  echo "=== Generating test vector for $circuit_name ==="
  
  pushd "$circuit_dir" >/dev/null
  
  # Clean previous builds
  rm -rf target
  
  # Compile circuit
  echo "  Compiling..."
  nargo compile >/dev/null
  
  local bytecode="target/${circuit_name}.json"
  local witness_gz="target/${circuit_name}.gz"
  
  # Generate witness
  echo "  Generating witness..."
  nargo execute >/dev/null
  
  # Generate VK
  echo "  Generating verification key..."
  bb write_vk --scheme ultra_honk --oracle_hash keccak \
    --bytecode_path "$bytecode" \
    --output_path target --output_format bytes_and_fields >/dev/null
  
  # Normalize VK path (bb may create vk/vk subdirectory)
  [ -f target/vk/vk ] && mv target/vk/vk target/vk.tmp && rmdir target/vk && mv target/vk.tmp target/vk || true
  
  # Generate proof
  echo "  Generating proof..."
  bb prove --scheme ultra_honk --oracle_hash keccak \
    --bytecode_path "$bytecode" \
    --witness_path "$witness_gz" \
    --output_path target --output_format bytes_and_fields >/dev/null
  
  # Read witness from Prover.toml
  local witness_json
  witness_json=$(parse_prover_toml "$prover_toml")
  
  # Read public inputs
  local public_inputs
  public_inputs=$(jq -R . < target/public_inputs | jq -s .)
  
  # Hash the VK
  local vk_hash
  vk_hash=$(sha256sum target/vk | awk '{print $1}')
  
  # Create test vector JSON
  local output_path="$TESTVECTORS_DIR/${circuit_name}.json"
  cat > "$output_path" <<EOF
{
  "circuit_name": "$circuit_name",
  "toolchain_version": "$NOIR_VERSION",
  "bb_version": "$BB_VERSION",
  "witness": $witness_json,
  "expected_public_inputs": $public_inputs,
  "expected_vk_hash": "$vk_hash",
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  
  echo "  ✓ Test vector saved to testvectors/${circuit_name}.json"
  echo "    VK hash: $vk_hash"
  echo "    Public inputs: $(echo "$public_inputs" | jq 'length') values"
  
  popd >/dev/null
}

# Default circuits if none specified
CIRCUITS=(
  "kyc_proof"
  "age_proof"
  "income_proof"
  "jurisdiction_proof"
  "funds_proof"
  "accreditation_proof"
)

if [ "$#" -gt 0 ]; then
  CIRCUITS=("$@")
fi

echo "Generating test vectors for StellarCred circuits..."
echo "Toolchain: Noir $NOIR_VERSION, BB $BB_VERSION"

for circuit in "${CIRCUITS[@]}"; do
  generate_test_vector "$circuit"
done

echo ""
echo "Test vector generation complete!"
echo "Vectors saved to: $TESTVECTORS_DIR"
echo ""
echo "Next steps:"
echo "  1. Review the generated vectors"
echo "  2. Commit them to version control"
echo "  3. Run ./scripts/verify_testvectors.sh to verify"
