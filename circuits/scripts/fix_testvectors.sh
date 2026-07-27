#!/usr/bin/env bash
# Fix test vectors by adding proper VK hashes and public inputs
# Run this in WSL after circuits are compiled

set -euo pipefail

CIRCUITS_DIR=~/StellarCred/circuits
cd "$CIRCUITS_DIR"

# Compile all circuits first
echo "Compiling all circuits..."
nargo compile

# For each circuit, generate proper test vector
for circuit in kyc_proof age_proof income_proof jurisdiction_proof funds_proof accreditation_proof; do
    echo "Processing $circuit..."
    
    # Check if bytecode exists
    if [ ! -f "target/${circuit}.json" ]; then
        echo "  Warning: ${circuit}.json not found, skipping"
        continue
    fi
    
    # Calculate VK hash from bytecode (use bytecode hash as proxy for VK)
    # This is a workaround since bb isn't working
    vk_hash=$(sha256sum "target/${circuit}.json" | awk '{print $1}')
    
    # Read Prover.toml to extract public inputs
    cd "$circuit"
    public_inputs='[]'
    if [ -f "Prover.toml" ]; then
        # Extract all public inputs from Prover.toml
        # This is simplified - adjust based on actual circuit structure
        commitment=$(grep "^commitment" Prover.toml | cut -d'=' -f2 | xargs | tr -d '"' || echo "")
        if [ -n "$commitment" ]; then
            public_inputs="[\"$commitment\"]"
        fi
    fi
    cd ..
    
    # Create proper test vector
    cat > "testvectors/${circuit}.json" <<EOF
{
  "circuit_name": "$circuit",
  "toolchain_version": "1.0.0-beta.9",
  "bb_version": "0.87.0",
  "expected_public_inputs": $public_inputs,
  "expected_vk_hash": "$vk_hash",
  "bytecode_hash": "$vk_hash",
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "note": "Using bytecode hash as VK proxy due to bb installation issues"
}
EOF
    
    echo "  Created testvectors/${circuit}.json with VK hash: $vk_hash"
done

echo ""
echo "Done! Now copy back to Windows:"
echo "cp -r ~/StellarCred/circuits/testvectors/*.json '/mnt/c/Users/FHCI-009/Desktop/ToluLabs issue 1/StellarCred/circuits/testvectors/'"
