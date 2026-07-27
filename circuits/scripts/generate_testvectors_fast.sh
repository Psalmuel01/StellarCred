#!/usr/bin/env bash
# Fast test vector generation - skips slow proof generation
# This is sufficient for test vectors (we only need VK hash and witness data)

set -euo pipefail

NOIR_VERSION="1.0.0-beta.9"
BB_VERSION="0.87.0"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTVECTORS_DIR="$ROOT/testvectors"

export PATH="$HOME/.nargo/bin:$HOME/.bb/bin:$PATH"

echo "Generating test vectors for StellarCred circuits (FAST mode)..."
echo "Toolchain: Noir $NOIR_VERSION, BB $BB_VERSION"
echo ""
echo "Note: Skipping full proof generation for speed"
echo "      (VK and witness data are sufficient for test vectors)"
echo ""

mkdir -p "$TESTVECTORS_DIR"

parse_prover_toml() {
  local toml_file="$1"
  local json="{"
  local first=true
  
  while IFS='=' read -r key value; do
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    
    [ "$first" = true ] && first=false || json+=","
    
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
    echo "Warning: Skipping $circuit_name (no Prover.toml)"
    return
  }
  
  echo ""
  echo "=== Generating test vector for $circuit_name ==="
  
  pushd "$circuit_dir" >/dev/null
  
  rm -rf target
  
  echo "  Compiling..."
  nargo compile >/dev/null 2>&1
  
  local bytecode="target/${circuit_name}.json"
  
  echo "  Generating VK..."
  bb write_vk --scheme ultra_honk --oracle_hash keccak \
    --bytecode_path "$bytecode" \
    --output_path target --output_format bytes_and_fields >/dev/null 2>&1
  
  [ -f target/vk/vk ] && mv target/vk/vk target/vk.tmp && rmdir target/vk && mv target/vk.tmp target/vk || true
  
  echo "  Generating witness (without full proof for speed)..."
  nargo execute >/dev/null 2>&1
  
  # Instead of full proof, just get public inputs from Prover.toml
  local witness_json
  witness_json=$(parse_prover_toml "$prover_toml")
  
  # Extract public inputs from Prover.toml (the public values)
  local public_inputs='[]'
  if grep -q "^commitment" "$prover_toml"; then
    commitment=$(grep "^commitment" "$prover_toml" | cut -d'=' -f2 | xargs | tr -d '"')
    public_inputs="[\"$commitment\"]"
  fi
  
  local vk_hash
  vk_hash=$(sha256sum target/vk | awk '{print $1}')
  
  local output_path="$TESTVECTORS_DIR/${circuit_name}.json"
  cat > "$output_path" <<EOF
{
  "circuit_name": "$circuit_name",
  "toolchain_version": "$NOIR_VERSION",
  "bb_version": "$BB_VERSION",
  "witness": $witness_json,
  "expected_public_inputs": $public_inputs,
  "expected_vk_hash": "$vk_hash",
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "note": "Generated in fast mode - full proof generation skipped for speed"
}
EOF
  
  echo "  ✓ Test vector saved to testvectors/${circuit_name}.json"
  echo "    VK hash: $vk_hash"
  
  popd >/dev/null
}

CIRCUITS=(
  "kyc_proof"
  "age_proof"
  "income_proof"
  "jurisdiction_proof"
  "funds_proof"
  "accreditation_proof"
)

for circuit in "${CIRCUITS[@]}"; do
  generate_test_vector "$circuit"
done

echo ""
echo "Test vector generation complete (fast mode)!"
echo "Vectors saved to: $TESTVECTORS_DIR"
echo ""
echo "Note: These vectors contain VK hashes and witness data."
echo "      Full proof generation was skipped for speed."
echo "      This is sufficient for regression testing."
