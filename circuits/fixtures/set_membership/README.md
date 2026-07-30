# Set Membership Circuit

This directory contains fixtures for the set_membership circuit, which proves that a private attribute belongs to a public set without revealing which member it is.

## Circuit Overview

The set_membership circuit uses a Merkle inclusion proof to demonstrate membership in a public set (e.g., allowed jurisdictions, accredited investors list) while keeping the specific value private.

### Public Inputs
- `commitment`: The commitment hash binding the private value
- `issuer_x`, `issuer_y`: The issuer's public key (for signature verification)
- `merkle_root`: The root of the Merkle tree containing the allowed values

### Private Inputs
- `value`: The private attribute (e.g., country code)
- `salt`: Random salt for commitment hiding
- `sig`: ECDSA signature from the issuer
- `merkle_path`: Sibling nodes along the Merkle path
- `merkle_indices`: Direction indicators for the Merkle path

### Verification
1. Commitment binding: `hash_commitment(value, salt) == commitment`
2. Signature verification: ECDSA signature over the commitment (disabled in demo)
3. Merkle inclusion: The value is a leaf under the provided merkle_root

## Demo Tree

The demo tree contains 8 allowed country codes (ISO 3166-1 numeric):
- 840 (US)
- 124 (Canada)
- 36 (Australia)
- 250 (France)
- 276 (Germany)
- 380 (Italy)
- 566 (Nigeria)
- 643 (Russia)

The tree is padded with zeros to fill a depth-8 binary Merkle tree (256 leaves).

## Building the Tree

Use the helper script to build Merkle trees and generate proofs:

```bash
# Generate demo tree and proof
node circuits/scripts/merkle.js demo

# Build a custom tree from values
node circuits/scripts/merkle.js build values.json > tree.json

# Generate a proof for a specific value
node circuits/scripts/merkle.js proof tree.json 840
```

## Production Notes

**Important**: The current implementation uses placeholder hash functions for demo purposes. In production, these should be replaced with actual Poseidon2 hashes to match the credential_lib implementation:

- `hash_commitment`: Should use `Poseidon2::hash([value, salt], 2)`
- `hash_single`: Should use `Poseidon2::hash([input], 1)`
- `hash_pair`: Should use `Poseidon2::hash([left, right], 2)`

The signature verification is also disabled in the demo. In production, enable it with proper ECDSA signatures from the issuer.

## Building Circuit Artifacts

To build the UltraHonk artifacts (VK, proof, public_inputs):

```bash
# Install required toolchain versions
noirup -v 1.0.0-beta.9
bbup -v 0.87.0

# Build the circuit
cd circuits
bash scripts/build.sh set_membership
```

This will generate:
- `fixtures/set_membership/vk` - Verification key for on-chain deployment
- `fixtures/set_membership/proof` - Sample proof
- `fixtures/set_membership/public_inputs` - Public inputs for the sample proof
- `frontend/public/circuits/set_membership.json` - Circuit bytecode for frontend
